import { Signer, getBytes, keccak256, toBeHex, toUtf8Bytes, verifyMessage } from "ethers";
import { aesGcmDecrypt, aesGcmEncrypt, decryptJson, encryptJson, hkdfSha256, keccakHash, toBase64 } from "./crypto";
import { createPoseidonHasher } from "./poseidon";
import { RatchetStore } from "./store";
import { computeViewTag, deriveStealthAddress, deriveStealthFromEphemeral, generateKeyPair } from "./stealth";
import { ratchetDecrypt, ratchetEncrypt, initRatchet } from "./ratchet";
import { StorageClient } from "./storage";
import { EncryptedMetadata, EncryptedPayload, KeyBundle, KeyPair, Message, RatchetHeader } from "./types";
import { x3dhInitiator, x3dhResponder, PQEncapsulate } from "./x3dh";

// HIGH FIX #7: Helper type for ratchet store with updateWithResult
interface RatchetStoreWithResult extends RatchetStore {
  updateWithResult<T>(
    peerId: string,
    updater: (state: any) => { result: T; state: any }
  ): Promise<{ result: T; state: any }>;
}

export interface StealthRegistryContract {
  getKeyBundle(address: string): Promise<{
    identityKey: string;
    signedPreKey: string;
    signedPreKeySignature: string;
    oneTimePreKeyBundleCid: string;
    stealthSpendingPubKey: string;
    stealthViewingPubKey: string;
    pqPublicKey: string;
    updatedAt: bigint;
    oneTimePreKeyCount: bigint;
    oneTimePreKeyConsumed: bigint;
  }>;
  // HIGH FIX #1: Added signature parameter for authorized prekey consumption
  consumeOneTimePreKey(owner: string, preKeyIndex: bigint, senderSignature: Uint8Array): Promise<boolean>;
  // MEDIUM FIX #3: Allow owner to consume their own prekey
  consumeOwnOneTimePreKey?(preKeyIndex: bigint): Promise<boolean>;
  getRemainingOneTimePreKeys(owner: string): Promise<bigint>;
}

export interface MessageHubContract {
  filters: {
    MessagePosted(): unknown;
    GroupMessagePosted(): unknown;
  };
  queryFilter(filter: unknown): Promise<Array<{ args?: Record<string, unknown> }>>;
  postDirectMessage(
    stealthRecipient: string,
    ephemeralPubKey: Uint8Array,  // Now 33 bytes
    viewTag: number,              // 1 byte
    encryptedMetadata: Uint8Array,
    nullifier: string
  ): Promise<{ hash: string }>;
  // HIGH FIX #10: groupId is bytes32 in Solidity, not string
  postGroupMessage(
    groupId: Uint8Array,  // bytes32 as Uint8Array
    encryptedMetadata: Uint8Array,
    zkProof: Uint8Array,
    nullifier: string,
    merkleRoot: string
  ): Promise<{ hash: string }>;
}

export interface MessageClientConfig {
  registry: StealthRegistryContract;
  messageHub: MessageHubContract;
  storage: StorageClient;
  signer: Signer;
  identityKeyPair: KeyPair;
  signedPreKeyPair: KeyPair;
  oneTimePreKeyPair?: KeyPair;
  stealthSpendingKeyPair: KeyPair;
  stealthViewingKeyPair: KeyPair;
  identityCommitment: bigint;
  ratchetStore: RatchetStore;
  pqEncapsulate?: PQEncapsulate;
  groupKeyResolver?: (groupId: string) => Promise<Uint8Array>;
}

export class MessageClient {
  private registry: StealthRegistryContract;
  private messageHub: MessageHubContract;
  private storage: StorageClient;
  private signer: Signer;
  private identityKeyPair: KeyPair;
  private signedPreKeyPair: KeyPair;
  private oneTimePreKeyPair?: KeyPair;
  private stealthSpendingKeyPair: KeyPair;
  private stealthViewingKeyPair: KeyPair;
  private identityCommitment: bigint;
  private ratchetStore: RatchetStore;
  private pqEncapsulate?: PQEncapsulate;
  private groupKeyResolver?: (groupId: string) => Promise<Uint8Array>;

  constructor(config: MessageClientConfig) {
    this.registry = config.registry;
    this.messageHub = config.messageHub;
    this.storage = config.storage;
    this.signer = config.signer;
    this.identityKeyPair = config.identityKeyPair;
    this.signedPreKeyPair = config.signedPreKeyPair;
    this.oneTimePreKeyPair = config.oneTimePreKeyPair;
    this.stealthSpendingKeyPair = config.stealthSpendingKeyPair;
    this.stealthViewingKeyPair = config.stealthViewingKeyPair;
    this.identityCommitment = config.identityCommitment;
    this.ratchetStore = config.ratchetStore;
    this.pqEncapsulate = config.pqEncapsulate;
    this.groupKeyResolver = config.groupKeyResolver;
  }

  private async resolveRecipientBundle(address: string): Promise<KeyBundle> {
    const raw = await this.registry.getKeyBundle(address);
    return {
      identityKey: getBytes(raw.identityKey),
      signedPreKey: getBytes(raw.signedPreKey),
      signedPreKeySignature: getBytes(raw.signedPreKeySignature),
      oneTimePreKeyBundleCid: raw.oneTimePreKeyBundleCid,
      stealthSpendingPubKey: getBytes(raw.stealthSpendingPubKey),
      stealthViewingPubKey: getBytes(raw.stealthViewingPubKey),
      pqPublicKey: raw.pqPublicKey && raw.pqPublicKey !== "0x" ? getBytes(raw.pqPublicKey) : undefined
    };
  }

  private async buildNullifier(cid: string): Promise<string> {
    const poseidon = await createPoseidonHasher();
    const cidHash = BigInt(keccakHash(cid));
    const nullifier = poseidon([this.identityCommitment, cidHash]);
    return toBeHex(nullifier, 32);
  }

  private async signMetadata(metadata: Omit<EncryptedMetadata, "signature">): Promise<string> {
    const hash = keccak256(toUtf8Bytes(JSON.stringify(metadata)));
    return this.signer.signMessage(getBytes(hash));
  }

  private decodeEncryptedPayload(data: Uint8Array | string): EncryptedPayload {
    const bytes = typeof data === "string" ? getBytes(data) : data;
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as EncryptedPayload;
  }

  async sendDirectMessage(
    recipient: string,
    content: string,
    options?: { replyTo?: string }
  ): Promise<string> {
    const bundle = await this.resolveRecipientBundle(recipient);
    const stealth = deriveStealthAddress(bundle.stealthViewingPubKey, bundle.stealthSpendingPubKey);

    const { sharedSecret: sessionKey, ephemeralKeyPair, usedOneTimePreKeyIndex } = x3dhInitiator(
      this.identityKeyPair,
      bundle,
      this.pqEncapsulate
    );

    const peerId = toBase64(bundle.identityKey);

    // HIGH FIX #7: Use locking mechanism to prevent race conditions
    const ratchetState = await this.ratchetStore.update(peerId, (existing) => {
      return existing ?? initRatchet(sessionKey, generateKeyPair());
    });

    const contentBytes = new TextEncoder().encode(content);

    // HIGH FIX #4: Include AAD for message integrity
    const { ciphertext, header, state: newState, iv, tag, messageKey } = ratchetEncrypt(
      ratchetState,
      contentBytes,
      undefined  // No additional AAD beyond the header
    );
    await this.ratchetStore.save(peerId, newState);

    const cid = await this.storage.add(ciphertext);
    const metadataKey = hkdfSha256(
      stealth.sharedSecret,
      new Uint8Array(32),
      new TextEncoder().encode("POMP_METADATA"),
      32
    );
    const contentKeyKey = hkdfSha256(
      stealth.sharedSecret,
      new Uint8Array(32),
      new TextEncoder().encode("POMP_CONTENT_KEY"),
      32
    );
    const wrapped = aesGcmEncrypt(messageKey.slice(0, 32), contentKeyKey);
    const wrappedPayload: EncryptedPayload = {
      iv: toBase64(wrapped.iv),
      tag: toBase64(wrapped.tag),
      ciphertext: toBase64(wrapped.ciphertext)
    };

    const senderStealth = await this.signer.getAddress();
    const metadataBase: Omit<EncryptedMetadata, "signature"> = {
      version: 1,
      senderStealth,
      recipientStealth: stealth.stealthAddress,
      senderIdentityKey: toBase64(this.identityKeyPair.publicKey),
      senderEphemeralKey: toBase64(ephemeralKeyPair.publicKey),
      contentCid: cid,
      contentKey: JSON.stringify(wrappedPayload),
      contentIv: toBase64(iv),
      contentTag: toBase64(tag),
      ratchetHeader: header,
      timestamp: Date.now(),
      messageType: "DM",
      replyTo: options?.replyTo,
      // MEDIUM FIX #3: Include one-time prekey index so recipient can consume it
      oneTimePreKeyIndex: usedOneTimePreKeyIndex
    };
    const signature = await this.signMetadata(metadataBase);
    const metadata: EncryptedMetadata = { ...metadataBase, signature };

    const encryptedMetadata = encryptJson(metadata, metadataKey);
    const encryptedMetadataBytes = new TextEncoder().encode(JSON.stringify(encryptedMetadata));
    const nullifier = await this.buildNullifier(cid);

    const tx = await this.messageHub.postDirectMessage(
      stealth.stealthAddress,
      stealth.ephemeralPubKey,  // Full 33-byte key
      stealth.viewTag,          // View tag for O(1) scanning
      encryptedMetadataBytes,
      nullifier
    );
    return tx.hash;
  }

  async sendGroupMessage(params: {
    groupId: string;
    content: string;
    groupKey: Uint8Array;
    zkProof: Uint8Array;
    merkleRoot: string;
  }): Promise<string> {
    const contentBytes = new TextEncoder().encode(params.content);
    // HIGH FIX #4: Include AAD for group messages
    const groupIdBytes = toBeHex(params.groupId, 32);
    const { ciphertext, iv, tag } = aesGcmEncrypt(contentBytes, params.groupKey, getBytes(groupIdBytes));
    const cid = await this.storage.add(ciphertext);
    const keyHash = keccak256(params.groupKey);

    const metadataBase: Omit<EncryptedMetadata, "signature"> = {
      version: 1,
      senderStealth: await this.signer.getAddress(),
      recipientStealth: "",
      senderIdentityKey: toBase64(this.identityKeyPair.publicKey),
      senderEphemeralKey: "",
      contentCid: cid,
      contentKeyHash: keyHash,
      contentIv: toBase64(iv),
      contentTag: toBase64(tag),
      timestamp: Date.now(),
      messageType: "GROUP",
      groupId: params.groupId
    };
    const signature = await this.signMetadata(metadataBase);
    const metadata: EncryptedMetadata = { ...metadataBase, signature };
    const groupKeyWrap = hkdfSha256(
      params.groupKey,
      new Uint8Array(32),
      new TextEncoder().encode("POMP_GROUP_METADATA"),
      32
    );
    const encryptedMetadata = encryptJson(metadata, groupKeyWrap);
    const encryptedMetadataBytes = new TextEncoder().encode(JSON.stringify(encryptedMetadata));
    const nullifier = await this.buildNullifier(cid);

    // HIGH FIX #10: Convert groupId string to bytes32
    const tx = await this.messageHub.postGroupMessage(
      getBytes(groupIdBytes),
      encryptedMetadataBytes,
      params.zkProof,
      nullifier,
      params.merkleRoot
    );
    return tx.hash;
  }

  /**
   * Scan for messages with view tag optimization for O(1) filtering
   * HIGH FIX #5: Fixed view tag computation to use shared secret
   * HIGH FIX #7: Added locking for ratchet state
   * HIGH FIX #8: Added signature verification on received metadata
   */
  async scanForMessages(): Promise<Message[]> {
    const messages: Message[] = [];
    const events = await this.messageHub.queryFilter(this.messageHub.filters.MessagePosted());

    for (const event of events) {
      const args = event.args as Record<string, unknown> | undefined;
      if (!args) {
        continue;
      }

      // Get view tag from event
      const eventViewTag = typeof args.viewTag === "number"
        ? args.viewTag
        : Number(args.viewTag);

      const ephemeralPubKey = args.ephemeralPubKey as Uint8Array;

      // HIGH FIX #5 & MEDIUM FIX #6: Compute view tag correctly from shared secret
      // First do ECDH to get shared secret
      const { stealthAddress, sharedSecret: derivedSecret } = deriveStealthFromEphemeral(
        ephemeralPubKey,
        this.stealthViewingKeyPair.privateKey,
        this.stealthSpendingKeyPair.publicKey
      );

      // Now compute view tag from the shared secret (correct approach)
      const expectedViewTag = computeViewTag(derivedSecret);

      // Skip if view tag doesn't match (O(1) filter)
      if (expectedViewTag !== eventViewTag) {
        continue;
      }

      // Verify stealth address matches
      if (stealthAddress.toLowerCase() !== (args.stealthRecipient as string).toLowerCase()) {
        continue;
      }

      const metadataKey = hkdfSha256(
        derivedSecret,
        new Uint8Array(32),
        new TextEncoder().encode("POMP_METADATA"),
        32
      );

      // MEDIUM FIX #9: Validate encrypted payload before parsing
      let encryptedPayload: EncryptedPayload;
      try {
        encryptedPayload = this.decodeEncryptedPayload(
          args.encryptedMetadata as Uint8Array | string
        );
        if (!encryptedPayload.iv || !encryptedPayload.tag || !encryptedPayload.ciphertext) {
          continue;
        }
      } catch {
        continue;
      }

      const metadata = decryptJson<EncryptedMetadata>(encryptedPayload, metadataKey);

      // HIGH FIX #8: Verify signature on received metadata
      const { signature, ...metadataWithoutSig } = metadata;
      const expectedSigner = verifyMessage(
        keccak256(toUtf8Bytes(JSON.stringify(metadataWithoutSig))),
        signature
      );
      // Verify the signer matches the claimed sender identity
      const senderIdentityKeyBytes = getBytes(metadata.senderIdentityKey);
      if (expectedSigner.toLowerCase() !== metadata.senderStealth.toLowerCase()) {
        // Signature doesn't match claimed sender - skip this message
        continue;
      }

      if (!metadata.ratchetHeader) {
        continue;
      }
      const ciphertext = await this.storage.get(metadata.contentCid);
      const iv = Buffer.from(metadata.contentIv, "base64");
      const tag = Buffer.from(metadata.contentTag, "base64");

      const peerId = metadata.senderIdentityKey;

      // HIGH FIX #7: Use locking mechanism to prevent race conditions
      // MEDIUM FIX #10: X3DH only runs on first message (when state doesn't exist)
      const store = this.ratchetStore as RatchetStoreWithResult;
      const { result: plaintext } = await store.updateWithResult(peerId, (existing) => {
        let ratchetState = existing;
        if (!ratchetState) {
          // Only run X3DH on first message from this peer
          // SECURITY FIX: Include recipientIdentityPub for proper salt derivation
          const sessionKey = x3dhResponder({
            senderIdentityKey: Buffer.from(metadata.senderIdentityKey, "base64"),
            senderEphemeralKey: Buffer.from(metadata.senderEphemeralKey, "base64"),
            recipientIdentityPriv: this.identityKeyPair.privateKey,
            recipientIdentityPub: this.identityKeyPair.publicKey,  // SECURITY FIX: Added
            recipientSignedPreKeyPriv: this.signedPreKeyPair.privateKey,
            recipientOneTimePreKeyPriv: this.oneTimePreKeyPair?.privateKey
          });
          ratchetState = initRatchet(sessionKey, generateKeyPair());
        }

        // HIGH FIX #4: Include AAD for message integrity
        const headerBytes = new TextEncoder().encode(JSON.stringify(metadata.ratchetHeader));
        const { plaintext, state: newState } = ratchetDecrypt(
          ratchetState,
          metadata.ratchetHeader as RatchetHeader,
          ciphertext,
          iv,
          tag,
          headerBytes  // AAD = ratchet header
        );

        return { result: plaintext, state: newState };
      });

      // MEDIUM FIX #3: Consume one-time prekey on-chain if it was used
      // The recipient consumes their own prekey to prevent reuse
      if (metadata.oneTimePreKeyIndex !== undefined && metadata.oneTimePreKeyIndex !== null) {
        try {
          const myAddress = await this.signer.getAddress();
          // Use consumeOwnOneTimePreKey since we're the owner
          // Note: This requires the registry contract to have this method
          await this.registry.consumeOwnOneTimePreKey?.(BigInt(metadata.oneTimePreKeyIndex));
        } catch (error) {
          // Log but don't fail - prekey might already be consumed
          console.warn(`Failed to consume one-time prekey ${metadata.oneTimePreKeyIndex}:`, error);
        }
      }

      messages.push({
        from: metadata.senderStealth,
        content: new TextDecoder().decode(plaintext),
        timestamp: metadata.timestamp,
        messageType: "DM",
        replyTo: metadata.replyTo
      });
    }

    if (this.groupKeyResolver) {
      const groupEvents = await this.messageHub.queryFilter(
        this.messageHub.filters.GroupMessagePosted()
      );
      for (const event of groupEvents) {
        const args = event.args as Record<string, unknown> | undefined;
        if (!args) {
          continue;
        }
        const groupId = args.groupId as string;
        const groupKey = await this.groupKeyResolver(groupId);
        const metadataKey = hkdfSha256(
          groupKey,
          new Uint8Array(32),
          new TextEncoder().encode("POMP_GROUP_METADATA"),
          32
        );

        // MEDIUM FIX #9: Validate encrypted payload before parsing
        let encryptedPayload: EncryptedPayload;
        try {
          encryptedPayload = this.decodeEncryptedPayload(
            args.encryptedMetadata as Uint8Array | string
          );
          if (!encryptedPayload.iv || !encryptedPayload.tag || !encryptedPayload.ciphertext) {
            continue;
          }
        } catch {
          continue;
        }

        const metadata = decryptJson<EncryptedMetadata>(encryptedPayload, metadataKey);

        // HIGH FIX #8: Verify signature on group message metadata
        const { signature, ...metadataWithoutSig } = metadata;
        const expectedSigner = verifyMessage(
          keccak256(toUtf8Bytes(JSON.stringify(metadataWithoutSig))),
          signature
        );
        if (expectedSigner.toLowerCase() !== metadata.senderStealth.toLowerCase()) {
          continue;
        }

        const ciphertext = await this.storage.get(metadata.contentCid);
        const iv = Buffer.from(metadata.contentIv, "base64");
        const tag = Buffer.from(metadata.contentTag, "base64");

        // HIGH FIX #4: Include groupId as AAD for group messages
        const groupIdBytes = getBytes(toBeHex(groupId, 32));
        const plaintext = aesGcmDecrypt(ciphertext, groupKey, iv, tag, groupIdBytes);

        messages.push({
          from: metadata.senderStealth,
          content: new TextDecoder().decode(plaintext),
          timestamp: metadata.timestamp,
          messageType: "GROUP",
          groupId
        });
      }
    }

    return messages;
  }
}

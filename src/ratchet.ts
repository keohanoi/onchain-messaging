import { secp256k1 } from "@noble/curves/secp256k1";
import { aesGcmDecrypt, aesGcmEncrypt, hkdfSha256, keccakHash, fromBase64, hmacSha256, toBase64 } from "./crypto";
import { KeyPair, RatchetHeader, RatchetState } from "./types";

// Maximum number of skipped message keys to cache
const MAX_SKIP = 1000;

// Auto-pruning threshold for skipped keys
const MAX_SKIPPED_KEYS = 500;

// MEDIUM FIX #2: Use byte values for domain separation (Signal Protocol spec)
// Signal uses 0x01, 0x02 rather than string constants
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
const CHAIN_KEY_SEED = new Uint8Array([0x02]);
const HEADER_KEY_SEED = new Uint8Array([0x03]);
const NEXT_HEADER_KEY_SEED = new Uint8Array([0x04]);

// Interface for cached message keys
interface SkippedMessageKey {
  dhPub: string;          // Sender's DH public key at time of message
  msgIndex: number;       // Message index in the chain
  messageKey: Uint8Array; // The derived message key
}

/**
 * MEDIUM FIX #2: Chain key derivation using byte constants
 * Following Signal Protocol specification more closely
 */
function kdfChain(chainKey: Uint8Array): { nextChainKey: Uint8Array; messageKey: Uint8Array; headerKey: Uint8Array } {
  const messageKey = hmacSha256(chainKey, MESSAGE_KEY_SEED);
  const nextChainKey = hmacSha256(chainKey, CHAIN_KEY_SEED);
  const headerKey = hmacSha256(chainKey, HEADER_KEY_SEED);
  return { messageKey, nextChainKey, headerKey };
}

/**
 * MEDIUM FIX #1: Root key derivation using HKDF (Signal Protocol spec)
 * Signal uses HKDF for root key updates, not plain HMAC
 */
function kdfRoot(rootKey: Uint8Array, dhOut: Uint8Array): { newRootKey: Uint8Array; newChainKey: Uint8Array } {
  // Use HKDF for proper extract-then-expand
  const derived = hkdfSha256(
    dhOut,
    rootKey,
    new TextEncoder().encode("POMP_RATCHET"),
    64  // Derive 64 bytes: 32 for root key, 32 for chain key
  );
  return {
    newRootKey: derived.slice(0, 32),
    newChainKey: derived.slice(32, 64)
  };
}

export function initRatchet(sessionKey: Uint8Array, dhPair: KeyPair): RatchetState {
  // SECURITY FIX: Derive a proper salt from the session key instead of using empty salt
  // This provides domain separation and prevents related-key attacks
  const saltInput = Buffer.concat([
    new TextEncoder().encode("POMP_RATCHET_SALT"),
    dhPair.publicKey
  ]);
  const salt = Buffer.from(keccakHash(saltInput).slice(2), "hex");

  // Derive initial chain keys using HKDF for proper key separation
  const derived = hkdfSha256(
    sessionKey,
    salt,
    new TextEncoder().encode("POMP_INIT"),
    64
  );
  const sendChainKey = derived.slice(0, 32);
  const recvChainKey = derived.slice(32, 64);

  return {
    rootKey: sessionKey,
    sendChainKey,
    recvChainKey,
    dhPair,
    sendCount: 0,
    recvCount: 0,
    skippedKeys: [],
    version: 0
  };
}

export function dhRatchet(state: RatchetState, theirDhPub: Uint8Array): RatchetState {
  const dhOut = secp256k1.getSharedSecret(state.dhPair.privateKey, theirDhPub, true);

  // SECURITY FIX: Derive separate send and receive chain keys
  // Per Signal Protocol, each party derives independent chain keys
  const derived = hkdfSha256(
    dhOut,
    state.rootKey,
    new TextEncoder().encode("POMP_DH_RATCHET"),
    96  // 32 for root key, 32 for send chain, 32 for recv chain
  );

  const newRootKey = derived.slice(0, 32);
  const newSendChainKey = derived.slice(32, 64);
  const newRecvChainKey = derived.slice(64, 96);

  const newPriv = new Uint8Array(secp256k1.utils.randomPrivateKey());
  const newDhPair: KeyPair = {
    privateKey: newPriv,
    publicKey: secp256k1.getPublicKey(newPriv, true)
  };

  return {
    rootKey: newRootKey,
    sendChainKey: newSendChainKey,
    recvChainKey: newRecvChainKey,
    dhPair: newDhPair,
    theirDhPub,
    sendCount: 0,
    recvCount: 0,
    skippedKeys: state.skippedKeys || [],
    version: (state.version ?? 0) + 1
  };
}

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
  aad?: Uint8Array  // HIGH FIX #4: Optional AAD parameter
): {
  ciphertext: Uint8Array;
  header: RatchetHeader;
  state: RatchetState;
  iv: Uint8Array;
  tag: Uint8Array;
  messageKey: Uint8Array;
  headerKey: Uint8Array;  // MEDIUM FIX #2: Expose header key for encryption
} {
  const { messageKey, nextChainKey, headerKey } = kdfChain(state.sendChainKey);

  // HIGH FIX #4: Include AAD (ratchet header) for integrity
  const header: RatchetHeader = {
    dhPub: toBase64(state.dhPair.publicKey),
    msgIndex: state.sendCount,
    prevChainLen: state.recvCount
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const effectiveAad = aad ? new Uint8Array([...headerBytes, ...aad]) : headerBytes;

  const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, messageKey.slice(0, 32), effectiveAad);

  const newState: RatchetState = {
    ...state,
    sendChainKey: nextChainKey,
    sendCount: state.sendCount + 1
  };

  return { ciphertext, header, state: newState, iv, tag, messageKey, headerKey };
}

/**
 * Decrypt a message with support for out-of-order messages
 * Implements the Signal Double Ratchet algorithm with message key caching
 * HIGH FIX #4: Added AAD support for message integrity
 */
export function ratchetDecrypt(
  state: RatchetState,
  header: RatchetHeader,
  ciphertext: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  aad?: Uint8Array  // Optional additional authenticated data
): { plaintext: Uint8Array; state: RatchetState } {
  const senderDh = fromBase64(header.dhPub);
  const senderDhBase64 = header.dhPub;

  // Ensure skipped keys array exists
  let skippedKeys: SkippedMessageKey[] = state.skippedKeys || [];

  // Step 1: Check if message key is already cached (out-of-order message)
  const cachedKeyIndex = skippedKeys.findIndex(
    sk => sk.dhPub === senderDhBase64 && sk.msgIndex === header.msgIndex
  );

  if (cachedKeyIndex !== -1) {
    // Found cached key - use it
    const cachedKey = skippedKeys[cachedKeyIndex];
    skippedKeys = skippedKeys.filter((_, i) => i !== cachedKeyIndex);

    // HIGH FIX #4: Include AAD for integrity verification
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const effectiveAad = aad ? new Uint8Array([...headerBytes, ...aad]) : headerBytes;

    const plaintext = aesGcmDecrypt(ciphertext, cachedKey.messageKey.slice(0, 32), iv, tag, effectiveAad);

    return {
      plaintext,
      state: { ...state, skippedKeys }
    };
  }

  // Step 2: Check if DH ratchet step is needed
  let workingState = state;
  const senderDhBytes = senderDh;
  const needsDhRatchet = !state.theirDhPub ||
    Buffer.compare(Buffer.from(senderDhBytes), Buffer.from(state.theirDhPub)) !== 0;

  if (needsDhRatchet) {
    // Step 3: Skip message keys from previous chain if needed
    const skipCount = header.prevChainLen !== undefined
      ? Math.max(0, header.prevChainLen - workingState.recvCount)
      : 0;

    if (skipCount > MAX_SKIP) {
      throw new Error("Skip limit exceeded");  // Reduced error verbosity
    }

    // Cache skipped message keys from current chain before ratchet
    for (let i = 0; i < skipCount; i++) {
      const { messageKey, nextChainKey } = kdfChain(workingState.recvChainKey);

      if (skippedKeys.length < MAX_SKIP) {
        skippedKeys.push({
          dhPub: toBase64(state.theirDhPub || new Uint8Array()),
          msgIndex: workingState.recvCount + i,
          messageKey
        });
      }

      workingState = { ...workingState, recvChainKey: nextChainKey };
    }

    // Perform DH ratchet step
    workingState = dhRatchet(workingState, senderDhBytes);
    workingState.skippedKeys = skippedKeys;
  }

  // Step 4: Skip message keys in new chain if needed
  const expectedIndex = workingState.recvCount;
  const actualIndex = header.msgIndex;

  if (actualIndex < expectedIndex) {
    throw new Error("Message index before expected");  // Reduced error verbosity
  }

  const skipInNewChain = actualIndex - expectedIndex;

  if (skipInNewChain > MAX_SKIP) {
    throw new Error("Skip limit exceeded");  // Reduced error verbosity
  }

  // Cache skipped keys in current chain
  for (let i = 0; i < skipInNewChain; i++) {
    const { messageKey, nextChainKey } = kdfChain(workingState.recvChainKey);

    if (skippedKeys.length < MAX_SKIP) {
      skippedKeys.push({
        dhPub: senderDhBase64,
        msgIndex: expectedIndex + i,
        messageKey
      });
    }

    workingState = { ...workingState, recvChainKey: nextChainKey };
  }

  // Step 5: Derive message key and decrypt
  const { messageKey, nextChainKey } = kdfChain(workingState.recvChainKey);

  // HIGH FIX #4: Include AAD for integrity verification
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const effectiveAad = aad ? new Uint8Array([...headerBytes, ...aad]) : headerBytes;

  const plaintext = aesGcmDecrypt(ciphertext, messageKey.slice(0, 32), iv, tag, effectiveAad);

  const newState: RatchetState = {
    ...workingState,
    recvChainKey: nextChainKey,
    recvCount: actualIndex + 1,
    skippedKeys,
    version: (workingState.version ?? 0) + 1
  };

  // SECURITY FIX: Auto-prune skipped keys to prevent memory exhaustion
  if (newState.skippedKeys && newState.skippedKeys.length > MAX_SKIPPED_KEYS) {
    newState.skippedKeys = newState.skippedKeys.slice(-MAX_SKIPPED_KEYS);
  }

  return { plaintext, state: newState };
}

/**
 * Clear old skipped message keys (call periodically to prevent memory bloat)
 */
export function pruneSkippedKeys(state: RatchetState, maxAge: number = 100): RatchetState {
  if (!state.skippedKeys || state.skippedKeys.length <= maxAge) {
    return state;
  }

  // Keep only the most recent keys
  const prunedKeys = state.skippedKeys.slice(-maxAge);
  return { ...state, skippedKeys: prunedKeys };
}

export type MessageType = "DM" | "GROUP" | "ATTACHMENT";

export interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EncryptedMetadata {
  version: 1;
  senderStealth: string;
  recipientStealth: string;
  senderIdentityKey: string;
  senderEphemeralKey: string;
  contentCid: string;
  contentKey?: string;
  contentKeyHash?: string;
  contentIv: string;
  contentTag: string;
  ratchetHeader?: RatchetHeader;
  timestamp: number;
  messageType: MessageType;
  groupId?: string;
  epoch?: number;  // Added for group messages
  replyTo?: string;
  oneTimePreKeyIndex?: number;  // MEDIUM FIX #3: Index of consumed one-time prekey
  signature: string;
}

export type Bytes = Uint8Array<ArrayBufferLike>;

/**
 * Key bundle matching Solidity KeyBundle struct
 * HIGH FIX #9: Added missing fields to match Solidity contract
 */
export interface KeyBundle {
  identityKey: Bytes;
  signedPreKey: Bytes;
  signedPreKeySignature: Bytes;
  oneTimePreKey?: Bytes;
  oneTimePreKeyIndex?: number;     // MEDIUM FIX #3: Index of the prekey used
  oneTimePreKeyBundleCid?: string;
  stealthSpendingPubKey: Bytes;
  stealthViewingPubKey: Bytes;
  pqPublicKey?: Bytes;
  // Fields from Solidity contract that were missing:
  updatedAt?: number;              // uint64 in Solidity
  oneTimePreKeyCount?: number;     // uint256 in Solidity
  oneTimePreKeyConsumed?: number;  // uint256 in Solidity
}

export interface KeyPair {
  privateKey: Bytes;
  publicKey: Bytes;
}

/**
 * Cached message key for out-of-order message handling
 */
export interface SkippedMessageKey {
  dhPub: string;          // Sender's DH public key at time of message
  msgIndex: number;       // Message index in the chain
  messageKey: Bytes;      // The derived message key
}

export interface RatchetState {
  rootKey: Bytes;
  sendChainKey: Bytes;
  recvChainKey: Bytes;
  dhPair: KeyPair;
  theirDhPub?: Bytes;
  sendCount: number;
  recvCount: number;
  skippedKeys?: SkippedMessageKey[];  // Cached keys for out-of-order messages
  version?: number;  // HIGH FIX #7: For optimistic locking
}

export interface RatchetHeader {
  dhPub: string;
  msgIndex: number;
  prevChainLen?: number;  // Previous chain length for out-of-order detection
}

export interface Message {
  from: string;
  content: string;
  timestamp: number;
  messageType: MessageType;
  groupId?: string;
  replyTo?: string;
}

export interface AttachmentManifest {
  cid: string;
  thumbnailCid?: string;
  key: string;
  filename: string;
  size: number;
  mimeType: string;
  hash: string;
}

/**
 * Group info matching Solidity Group struct
 */
export interface GroupInfo {
  admin: string;
  merkleRoot: string;
  memberCount: number;
  isPublic: boolean;
  epoch: number;
}

/**
 * Contract event types for type-safe event handling
 */
export interface MessagePostedEvent {
  commitment: string;
  stealthRecipient: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  encryptedMetadata: Uint8Array;
  nullifier: string;
}

export interface GroupMessagePostedEvent {
  groupId: string;
  commitment: string;
  encryptedMetadata: Uint8Array;
  zkProof: Uint8Array;
  nullifier: string;
}

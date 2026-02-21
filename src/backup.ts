import { Signer, getBytes, keccak256, toUtf8Bytes, verifyMessage } from "ethers";
import { aesGcmDecrypt, aesGcmEncrypt, hkdfSha256, toBase64, fromBase64 } from "./crypto";
import { StorageClient } from "./storage";
import { KeyPair } from "./types";

// Backup data structure
export interface KeyBackup {
  version: number;
  timestamp: number;
  chainId: number;
  address: string;
  identityKeyPair: KeyPair;
  signedPreKeyPair: KeyPair;
  oneTimePreKeyPairs: KeyPair[];
  stealthSpendingKeyPair: KeyPair;
  stealthViewingKeyPair: KeyPair;
  identityCommitment: string; // bigint as string
}

// Encrypted backup stored on IPFS
export interface EncryptedBackup {
  version: number;
  timestamp: number;
  address: string;
  chainId: number;
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

// Backup metadata stored on-chain or locally
export interface BackupMetadata {
  cid: string;
  timestamp: number;
  address: string;
}

const BACKUP_VERSION = 1;

/**
 * Derive encryption key from wallet signature
 * Uses a domain-specific message to prevent cross-app replay
 */
export async function deriveBackupKey(
  signer: Signer,
  chainId: number,
  address: string
): Promise<Uint8Array> {
  const message = `POMP Key Backup\n\nChain: ${chainId}\nAddress: ${address}\n\nSign this message to encrypt your backup keys.\n\nWARNING: Never sign this message on a website you don't trust.`;

  const signature = await signer.signMessage(message);

  // Derive 32-byte key from signature using HKDF
  const sigBytes = getBytes(signature);
  const salt = new TextEncoder().encode("POMP_BACKUP_KEY_V1");

  return hkdfSha256(sigBytes, salt, new TextEncoder().encode("BACKUP_ENCRYPTION"), 32);
}

/**
 * Create encrypted backup of all keys
 */
export async function createBackup(
  signer: Signer,
  chainId: number,
  keys: KeyBackup,
  storage: StorageClient
): Promise<BackupMetadata> {
  // Derive encryption key from wallet
  const encryptionKey = await deriveBackupKey(signer, chainId, keys.address);

  // Serialize keys to JSON
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));

  // Encrypt with AES-GCM
  const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, encryptionKey);

  // Create encrypted backup structure
  const encryptedBackup: EncryptedBackup = {
    version: BACKUP_VERSION,
    timestamp: Date.now(),
    address: keys.address,
    chainId,
    iv: toBase64(iv),
    tag: toBase64(tag),
    ciphertext: toBase64(ciphertext),
  };

  // Upload to IPFS
  const backupBytes = new TextEncoder().encode(JSON.stringify(encryptedBackup));
  const cid = await storage.add(backupBytes);

  return {
    cid,
    timestamp: encryptedBackup.timestamp,
    address: keys.address,
  };
}

/**
 * Restore keys from encrypted backup
 */
export async function restoreBackup(
  signer: Signer,
  chainId: number,
  cid: string,
  storage: StorageClient
): Promise<KeyBackup> {
  // Download encrypted backup from IPFS
  const backupBytes = await storage.get(cid);
  const encryptedBackup: EncryptedBackup = JSON.parse(new TextDecoder().decode(backupBytes));

  // Validate version
  if (encryptedBackup.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${encryptedBackup.version}`);
  }

  // Validate address matches
  const signerAddress = await signer.getAddress();
  if (encryptedBackup.address.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error("Backup address does not match signer address");
  }

  // Validate chain ID (optional - might want to restore on different chain)
  if (encryptedBackup.chainId !== chainId) {
    console.warn(`Backup chain ID (${encryptedBackup.chainId}) differs from current (${chainId})`);
  }

  // Derive decryption key from wallet
  const decryptionKey = await deriveBackupKey(signer, encryptedBackup.chainId, encryptedBackup.address);

  // Decrypt
  const ciphertext = fromBase64(encryptedBackup.ciphertext);
  const iv = fromBase64(encryptedBackup.iv);
  const tag = fromBase64(encryptedBackup.tag);

  const plaintext = aesGcmDecrypt(ciphertext, decryptionKey, iv, tag);

  // Parse and return keys
  const keys: KeyBackup = JSON.parse(new TextDecoder().decode(plaintext));

  return keys;
}

/**
 * Serialize KeyPair for storage
 */
export function serializeKeyPair(kp: KeyPair): { privateKey: string; publicKey: string } {
  return {
    privateKey: toBase64(kp.privateKey),
    publicKey: toBase64(kp.publicKey),
  };
}

/**
 * Deserialize KeyPair from storage
 */
export function deserializeKeyPair(data: { privateKey: string; publicKey: string }): KeyPair {
  return {
    privateKey: fromBase64(data.privateKey),
    publicKey: fromBase64(data.publicKey),
  };
}

/**
 * Create a backup from the current key state
 */
export function createKeyBackupData(
  address: string,
  chainId: number,
  identityKeyPair: KeyPair,
  signedPreKeyPair: KeyPair,
  oneTimePreKeyPairs: KeyPair[],
  stealthSpendingKeyPair: KeyPair,
  stealthViewingKeyPair: KeyPair,
  identityCommitment: bigint
): KeyBackup {
  return {
    version: BACKUP_VERSION,
    timestamp: Date.now(),
    chainId,
    address,
    identityKeyPair,
    signedPreKeyPair,
    oneTimePreKeyPairs,
    stealthSpendingKeyPair,
    stealthViewingKeyPair,
    identityCommitment: identityCommitment.toString(),
  };
}

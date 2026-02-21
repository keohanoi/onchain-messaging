"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveBackupKey = deriveBackupKey;
exports.createBackup = createBackup;
exports.restoreBackup = restoreBackup;
exports.serializeKeyPair = serializeKeyPair;
exports.deserializeKeyPair = deserializeKeyPair;
exports.createKeyBackupData = createKeyBackupData;
const ethers_1 = require("ethers");
const crypto_1 = require("./crypto");
const BACKUP_VERSION = 1;
/**
 * Derive encryption key from wallet signature
 * Uses a domain-specific message to prevent cross-app replay
 */
async function deriveBackupKey(signer, chainId, address) {
    const message = `POMP Key Backup\n\nChain: ${chainId}\nAddress: ${address}\n\nSign this message to encrypt your backup keys.\n\nWARNING: Never sign this message on a website you don't trust.`;
    const signature = await signer.signMessage(message);
    // Derive 32-byte key from signature using HKDF
    const sigBytes = (0, ethers_1.getBytes)(signature);
    const salt = new TextEncoder().encode("POMP_BACKUP_KEY_V1");
    return (0, crypto_1.hkdfSha256)(sigBytes, salt, new TextEncoder().encode("BACKUP_ENCRYPTION"), 32);
}
/**
 * Create encrypted backup of all keys
 */
async function createBackup(signer, chainId, keys, storage) {
    // Derive encryption key from wallet
    const encryptionKey = await deriveBackupKey(signer, chainId, keys.address);
    // Serialize keys to JSON
    const plaintext = new TextEncoder().encode(JSON.stringify(keys));
    // Encrypt with AES-GCM
    const { ciphertext, iv, tag } = (0, crypto_1.aesGcmEncrypt)(plaintext, encryptionKey);
    // Create encrypted backup structure
    const encryptedBackup = {
        version: BACKUP_VERSION,
        timestamp: Date.now(),
        address: keys.address,
        chainId,
        iv: (0, crypto_1.toBase64)(iv),
        tag: (0, crypto_1.toBase64)(tag),
        ciphertext: (0, crypto_1.toBase64)(ciphertext),
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
async function restoreBackup(signer, chainId, cid, storage) {
    // Download encrypted backup from IPFS
    const backupBytes = await storage.get(cid);
    const encryptedBackup = JSON.parse(new TextDecoder().decode(backupBytes));
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
    const ciphertext = (0, crypto_1.fromBase64)(encryptedBackup.ciphertext);
    const iv = (0, crypto_1.fromBase64)(encryptedBackup.iv);
    const tag = (0, crypto_1.fromBase64)(encryptedBackup.tag);
    const plaintext = (0, crypto_1.aesGcmDecrypt)(ciphertext, decryptionKey, iv, tag);
    // Parse and return keys
    const keys = JSON.parse(new TextDecoder().decode(plaintext));
    return keys;
}
/**
 * Serialize KeyPair for storage
 */
function serializeKeyPair(kp) {
    return {
        privateKey: (0, crypto_1.toBase64)(kp.privateKey),
        publicKey: (0, crypto_1.toBase64)(kp.publicKey),
    };
}
/**
 * Deserialize KeyPair from storage
 */
function deserializeKeyPair(data) {
    return {
        privateKey: (0, crypto_1.fromBase64)(data.privateKey),
        publicKey: (0, crypto_1.fromBase64)(data.publicKey),
    };
}
/**
 * Create a backup from the current key state
 */
function createKeyBackupData(address, chainId, identityKeyPair, signedPreKeyPair, oneTimePreKeyPairs, stealthSpendingKeyPair, stealthViewingKeyPair, identityCommitment) {
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

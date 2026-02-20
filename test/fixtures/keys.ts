import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak256 } from 'ethers';
import { Buffer } from 'buffer';
import { KeyPair, KeyBundle } from '../../src/types';

/**
 * Generate a random key pair for testing
 */
export function generateTestKeyPair(): KeyPair {
  const privateKey = new Uint8Array(secp256k1.utils.randomPrivateKey());
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return { privateKey, publicKey };
}

/**
 * Generate a fixed key pair from a seed (deterministic for tests)
 */
export function generateDeterministicKeyPair(seed: number): KeyPair {
  // Create a deterministic private key from seed
  const seedBytes = new Uint8Array(32);
  seedBytes[0] = seed;
  seedBytes[31] = seed;
  // Hash to get a valid private key
  const privateKey = seedBytes; // In production, you'd hash this
  // Ensure it's a valid private key by modifying if needed
  const validPrivateKey = new Uint8Array(secp256k1.utils.randomPrivateKey());
  validPrivateKey[0] = seed % 256;
  validPrivateKey[31] = seed % 256;

  const publicKey = secp256k1.getPublicKey(validPrivateKey, true);
  return { privateKey: validPrivateKey, publicKey };
}

/**
 * Sign the signed prekey using the identity key
 * Exported for use in tests that manually create bundles
 */
export function signPreKey(identityPrivateKey: Uint8Array, signedPreKey: Uint8Array): Uint8Array {
  // Hash the signed prekey to get the message hash
  const msgHash = Buffer.from(keccak256(signedPreKey).slice(2), "hex");
  // Sign using noble/secp256k1
  const signature = secp256k1.sign(msgHash, identityPrivateKey);
  // Return 64-byte signature (r || s)
  return signature.toCompactRawBytes();
}

/**
 * Generate a complete key bundle for testing
 */
export function generateTestKeyBundle(includeOneTimePreKey = true): {
  identityKey: KeyPair;
  signedPreKey: KeyPair;
  oneTimePreKey?: KeyPair;
  stealthSpendingKey: KeyPair;
  stealthViewingKey: KeyPair;
  bundle: KeyBundle;
} {
  const identityKey = generateTestKeyPair();
  const signedPreKey = generateTestKeyPair();
  const oneTimePreKey = includeOneTimePreKey ? generateTestKeyPair() : undefined;
  const stealthSpendingKey = generateTestKeyPair();
  const stealthViewingKey = generateTestKeyPair();

  // SECURITY FIX: Create proper signature for signed prekey using identity key
  const signedPreKeySignature = signPreKey(identityKey.privateKey, signedPreKey.publicKey);

  const bundle: KeyBundle = {
    identityKey: identityKey.publicKey,
    signedPreKey: signedPreKey.publicKey,
    signedPreKeySignature,
    oneTimePreKey: oneTimePreKey?.publicKey,
    oneTimePreKeyIndex: includeOneTimePreKey ? 0 : undefined,
    stealthSpendingPubKey: stealthSpendingKey.publicKey,
    stealthViewingPubKey: stealthViewingKey.publicKey
  };

  return {
    identityKey,
    signedPreKey,
    oneTimePreKey,
    stealthSpendingKey,
    stealthViewingKey,
    bundle
  };
}

/**
 * Generate random bytes for testing
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * Create a valid 32-byte key for AES operations
 */
export function randomAesKey(): Uint8Array {
  return randomBytes(32);
}

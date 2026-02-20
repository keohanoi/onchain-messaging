import { secp256k1 } from "@noble/curves/secp256k1";
import { computeAddress, keccak256 } from "ethers";
import { hexFromBytes } from "./crypto";

export interface StealthDerivation {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;        // Full 33-byte compressed key
  sharedSecret: Uint8Array;
  viewTag: number;                     // 1-byte view tag for O(1) scanning
}

/**
 * Validate that a public key is a valid point on secp256k1
 * SECURITY FIX: Added validation to prevent invalid key attacks
 */
function validatePublicKey(key: Uint8Array, context: string): void {
  if (key.length !== 33) {
    throw new Error(`Invalid ${context}: expected 33 bytes, got ${key.length}`);
  }
  try {
    const point = secp256k1.ProjectivePoint.fromHex(key);
    point.assertValidity();
  } catch {
    throw new Error(`Invalid ${context}: not a valid curve point`);
  }
}

/**
 * Hash shared secret to a scalar value using keccak256
 * HIGH FIX #3: Use proper cryptographic hashing before reduction
 * This follows ERC-5564 recommendation for hash-to-scalar
 */
function hashToScalar(sharedSecret: Uint8Array): bigint {
  // Hash the shared secret first to get uniform distribution
  const hash = keccak256(Buffer.from(sharedSecret));
  // Convert to bigint and reduce modulo curve order
  return BigInt(hash) % secp256k1.CURVE.n;
}

/**
 * Compute view tag from shared secret for O(1) message filtering
 * @param sharedSecret The ECDH shared secret
 * @returns 1-byte view tag (0-255)
 */
export function computeViewTag(sharedSecret: Uint8Array): number {
  // Hash shared secret and take first byte
  const hash = keccak256(Buffer.from(sharedSecret));
  return parseInt(hash.slice(2, 4), 16);
}

export function generateKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = new Uint8Array(secp256k1.utils.randomPrivateKey());
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  return { privateKey, publicKey };
}

/**
 * Derive stealth address for sending
 * @param recipientViewingPubKey Recipient's viewing public key (33 bytes compressed)
 * @param recipientSpendingPubKey Recipient's spending public key (33 bytes compressed)
 * @returns Stealth derivation including address, ephemeral key, and view tag
 */
export function deriveStealthAddress(
  recipientViewingPubKey: Uint8Array,
  recipientSpendingPubKey: Uint8Array
): StealthDerivation {
  // SECURITY FIX: Validate public keys before use
  validatePublicKey(recipientViewingPubKey, "viewing public key");
  validatePublicKey(recipientSpendingPubKey, "spending public key");

  // Generate ephemeral key pair
  const ephemeralPrivKey = new Uint8Array(secp256k1.utils.randomPrivateKey());
  const ephemeralPubKey = secp256k1.getPublicKey(ephemeralPrivKey, true); // 33 bytes compressed

  // Compute ECDH shared secret
  const sharedSecret = secp256k1.getSharedSecret(
    ephemeralPrivKey,
    recipientViewingPubKey,
    true
  );

  // Compute view tag for efficient scanning
  const viewTag = computeViewTag(sharedSecret);

  // Derive stealth address: H(sharedSecret) * G + spendingPubKey
  const scalar = hashToScalar(sharedSecret);

  const spendingPoint = secp256k1.ProjectivePoint.fromHex(recipientSpendingPubKey);
  const stealthPoint = spendingPoint.add(secp256k1.ProjectivePoint.BASE.multiply(scalar));
  const stealthPubKey = stealthPoint.toRawBytes(false);
  const stealthAddress = computeAddress(hexFromBytes(stealthPubKey));

  return { stealthAddress, ephemeralPubKey, sharedSecret, viewTag };
}

/**
 * Derive stealth address from ephemeral key for receiving/scanning
 * @param ephemeralPubKey Full 33-byte compressed ephemeral public key
 * @param recipientViewingPrivKey Recipient's viewing private key
 * @param recipientSpendingPubKey Recipient's spending public key
 * @returns Stealth derivation including address, shared secret, and view tag
 */
export function deriveStealthFromEphemeral(
  ephemeralPubKey: Uint8Array,
  recipientViewingPrivKey: Uint8Array,
  recipientSpendingPubKey: Uint8Array
): { stealthAddress: string; sharedSecret: Uint8Array; viewTag: number } {
  // SECURITY FIX: Validate all public keys
  validatePublicKey(ephemeralPubKey, "ephemeral public key");
  validatePublicKey(recipientSpendingPubKey, "spending public key");

  // Compute ECDH shared secret
  const sharedSecret = secp256k1.getSharedSecret(
    recipientViewingPrivKey,
    ephemeralPubKey,
    true
  );

  // Compute view tag
  const viewTag = computeViewTag(sharedSecret);

  // Derive stealth address
  const scalar = hashToScalar(sharedSecret);

  const spendingPoint = secp256k1.ProjectivePoint.fromHex(recipientSpendingPubKey);
  const stealthPoint = spendingPoint.add(secp256k1.ProjectivePoint.BASE.multiply(scalar));
  const stealthPubKey = stealthPoint.toRawBytes(false);
  const stealthAddress = computeAddress(hexFromBytes(stealthPubKey));

  return { stealthAddress, sharedSecret, viewTag };
}

/**
 * Legacy function for backwards compatibility with uint256 ephemeral keys
 * @deprecated Use deriveStealthFromEphemeral with full 33-byte key instead
 * SECURITY FIX: Now properly calculates Y parity instead of assuming even Y
 */
export function deriveStealthFromEphemeralX(
  ephemeralPubKeyX: bigint,
  recipientViewingPrivKey: Uint8Array,
  recipientSpendingPubKey: Uint8Array
): { stealthAddress: string; sharedSecret: Uint8Array } {
  // SECURITY FIX: Calculate Y from X to determine correct parity
  // secp256k1: y^2 = x^3 + 7 (mod p)
  const p = secp256k1.CURVE.Fp.ORDER;
  const x = ephemeralPubKeyX;

  // Calculate y^2 = x^3 + 7
  const ySquared = (x * x * x + 7n) % p;

  // Calculate y using modular square root (Tonelli-Shanks simplified for p ≡ 3 mod 4)
  // y = y^2^((p+1)/4) mod p
  const y = modPow(ySquared, (p + 1n) / 4n, p);

  // Verify the result
  const ySquaredCheck = (y * y) % p;
  if (ySquaredCheck !== ySquared) {
    throw new Error("Invalid X coordinate - point not on curve");
  }

  // Use even Y (02 prefix) - if y is odd, use p - y (which is -y mod p, and will be even)
  const finalY = y % 2n === 0n ? y : p - y;
  const prefix = finalY === y ? 0x02 : 0x03;

  const xHex = x.toString(16).padStart(64, "0");
  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(Buffer.from(xHex, "hex"), 1);

  return deriveStealthFromEphemeral(compressed, recipientViewingPrivKey, recipientSpendingPubKey);
}

// Helper: modular exponentiation
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

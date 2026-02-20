import crypto from "crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { EncryptedPayload } from "./types";

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
  let prev = Buffer.alloc(0);
  const buffers: Buffer[] = [];
  let counter = 1;
  while (Buffer.concat(buffers).length < length) {
    const hmac = crypto.createHmac("sha256", prk);
    hmac.update(prev);
    hmac.update(info);
    hmac.update(Buffer.from([counter]));
    prev = hmac.digest();
    buffers.push(prev);
    counter += 1;
  }
  return new Uint8Array(Buffer.concat(buffers).subarray(0, length));
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(crypto.createHmac("sha256", key).update(data).digest());
}

/**
 * AES-GCM encryption with optional Additional Authenticated Data (AAD)
 * HIGH FIX #4: Added AAD support for message integrity
 * SECURITY FIX: Added key length validation
 */
export function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad?: Uint8Array
): { ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array } {
  // SECURITY FIX: Validate key length for AES-256
  if (key.length !== 32) {
    throw new Error("Invalid key length");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  // Set AAD if provided (for integrity of associated data)
  if (aad && aad.length > 0) {
    cipher.setAAD(Buffer.from(aad));
  }

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: new Uint8Array(ciphertext), iv, tag };
}

/**
 * AES-GCM decryption with optional Additional Authenticated Data (AAD)
 * HIGH FIX #4: Added AAD support for message integrity
 * SECURITY FIX: Added key length and tag validation
 */
export function aesGcmDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  aad?: Uint8Array
): Uint8Array {
  // SECURITY FIX: Validate key length for AES-256
  if (key.length !== 32) {
    throw new Error("Invalid key length");
  }

  // SECURITY FIX: Validate auth tag length (16 bytes for AES-GCM)
  if (tag.length !== 16) {
    throw new Error("Invalid authentication tag");
  }

  // SECURITY FIX: Validate IV length (12 bytes recommended for GCM)
  if (iv.length !== 12) {
    throw new Error("Invalid IV length");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

  // Set AAD if provided (must match what was used for encryption)
  if (aad && aad.length > 0) {
    decipher.setAAD(Buffer.from(aad));
  }

  decipher.setAuthTag(Buffer.from(tag));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext)),
    decipher.final()
  ]);
  return new Uint8Array(plaintext);
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

export function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

export function encryptJson(payload: unknown, key: Uint8Array): EncryptedPayload {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const { ciphertext, iv, tag } = aesGcmEncrypt(bytes, key);
  return {
    iv: toBase64(iv),
    tag: toBase64(tag),
    ciphertext: toBase64(ciphertext)
  };
}

export function decryptJson<T>(payload: EncryptedPayload, key: Uint8Array): T {
  const iv = fromBase64(payload.iv);
  const tag = fromBase64(payload.tag);
  const ciphertext = fromBase64(payload.ciphertext);
  const plaintext = aesGcmDecrypt(ciphertext, key, iv, tag);
  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text) as T;
}

export function keccakHash(data: Uint8Array | string): string {
  if (typeof data === "string") {
    return keccak256(toUtf8Bytes(data));
  }
  return keccak256(data);
}

export function bytesFromHex(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(normalized, "hex"));
}

export function hexFromBytes(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

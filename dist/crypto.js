"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hkdfSha256 = hkdfSha256;
exports.hmacSha256 = hmacSha256;
exports.aesGcmEncrypt = aesGcmEncrypt;
exports.aesGcmDecrypt = aesGcmDecrypt;
exports.toBase64 = toBase64;
exports.fromBase64 = fromBase64;
exports.encryptJson = encryptJson;
exports.decryptJson = decryptJson;
exports.keccakHash = keccakHash;
exports.bytesFromHex = bytesFromHex;
exports.hexFromBytes = hexFromBytes;
const crypto_1 = __importDefault(require("crypto"));
const ethers_1 = require("ethers");
function hkdfSha256(ikm, salt, info, length) {
    const prk = crypto_1.default.createHmac("sha256", salt).update(ikm).digest();
    let prev = Buffer.alloc(0);
    const buffers = [];
    let counter = 1;
    while (Buffer.concat(buffers).length < length) {
        const hmac = crypto_1.default.createHmac("sha256", prk);
        hmac.update(prev);
        hmac.update(info);
        hmac.update(Buffer.from([counter]));
        prev = hmac.digest();
        buffers.push(prev);
        counter += 1;
    }
    return new Uint8Array(Buffer.concat(buffers).subarray(0, length));
}
function hmacSha256(key, data) {
    return new Uint8Array(crypto_1.default.createHmac("sha256", key).update(data).digest());
}
/**
 * AES-GCM encryption with optional Additional Authenticated Data (AAD)
 * HIGH FIX #4: Added AAD support for message integrity
 * SECURITY FIX: Added key length validation
 */
function aesGcmEncrypt(plaintext, key, aad) {
    // SECURITY FIX: Validate key length for AES-256
    if (key.length !== 32) {
        throw new Error("Invalid key length");
    }
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
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
function aesGcmDecrypt(ciphertext, key, iv, tag, aad) {
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
    const decipher = crypto_1.default.createDecipheriv("aes-256-gcm", key, iv);
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
function toBase64(data) {
    return Buffer.from(data).toString("base64");
}
function fromBase64(data) {
    return new Uint8Array(Buffer.from(data, "base64"));
}
function encryptJson(payload, key) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const { ciphertext, iv, tag } = aesGcmEncrypt(bytes, key);
    return {
        iv: toBase64(iv),
        tag: toBase64(tag),
        ciphertext: toBase64(ciphertext)
    };
}
function decryptJson(payload, key) {
    const iv = fromBase64(payload.iv);
    const tag = fromBase64(payload.tag);
    const ciphertext = fromBase64(payload.ciphertext);
    const plaintext = aesGcmDecrypt(ciphertext, key, iv, tag);
    const text = new TextDecoder().decode(plaintext);
    return JSON.parse(text);
}
function keccakHash(data) {
    if (typeof data === "string") {
        return (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(data));
    }
    return (0, ethers_1.keccak256)(data);
}
function bytesFromHex(hex) {
    const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
    return new Uint8Array(Buffer.from(normalized, "hex"));
}
function hexFromBytes(bytes) {
    return `0x${Buffer.from(bytes).toString("hex")}`;
}

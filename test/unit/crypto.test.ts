import { describe, it, expect } from 'vitest';
import {
  hkdfSha256,
  hmacSha256,
  aesGcmEncrypt,
  aesGcmDecrypt,
  toBase64,
  fromBase64,
  encryptJson,
  decryptJson,
  keccakHash,
  bytesFromHex,
  hexFromBytes
} from '../../src/crypto';
import { randomAesKey, randomBytes } from '../fixtures/keys';

describe('crypto', () => {
  describe('hkdfSha256', () => {
    it('should produce deterministic output for same inputs', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(32);
      const info = new TextEncoder().encode('test info');
      const length = 32;

      const result1 = hkdfSha256(ikm, salt, info, length);
      const result2 = hkdfSha256(ikm, salt, info, length);

      expect(result1).toEqual(result2);
    });

    it('should produce different outputs for different salts', () => {
      const ikm = randomBytes(32);
      const info = new TextEncoder().encode('test info');
      const length = 32;

      const salt1 = randomBytes(32);
      const salt2 = randomBytes(32);

      const result1 = hkdfSha256(ikm, salt1, info, length);
      const result2 = hkdfSha256(ikm, salt2, info, length);

      expect(result1).not.toEqual(result2);
    });

    it('should produce different outputs for different info', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(32);
      const length = 32;

      const info1 = new TextEncoder().encode('info 1');
      const info2 = new TextEncoder().encode('info 2');

      const result1 = hkdfSha256(ikm, salt, info1, length);
      const result2 = hkdfSha256(ikm, salt, info2, length);

      expect(result1).not.toEqual(result2);
    });

    it('should produce output of requested length', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(32);
      const info = new TextEncoder().encode('test');

      expect(hkdfSha256(ikm, salt, info, 16).length).toBe(16);
      expect(hkdfSha256(ikm, salt, info, 32).length).toBe(32);
      expect(hkdfSha256(ikm, salt, info, 64).length).toBe(64);
    });

    it('should handle empty salt', () => {
      const ikm = randomBytes(32);
      const salt = new Uint8Array(0);
      const info = new TextEncoder().encode('test');

      const result = hkdfSha256(ikm, salt, info, 32);
      expect(result.length).toBe(32);
    });
  });

  describe('hmacSha256', () => {
    it('should produce deterministic output', () => {
      const key = randomBytes(32);
      const data = randomBytes(64);

      const result1 = hmacSha256(key, data);
      const result2 = hmacSha256(key, data);

      expect(result1).toEqual(result2);
    });

    it('should produce different outputs for different keys', () => {
      const data = randomBytes(64);
      const key1 = randomBytes(32);
      const key2 = randomBytes(32);

      const result1 = hmacSha256(key1, data);
      const result2 = hmacSha256(key2, data);

      expect(result1).not.toEqual(result2);
    });

    it('should produce 32-byte output', () => {
      const key = randomBytes(32);
      const data = randomBytes(64);

      const result = hmacSha256(key, data);
      expect(result.length).toBe(32);
    });
  });

  describe('aesGcmEncrypt/Decrypt', () => {
    it('should encrypt and decrypt successfully (roundtrip)', () => {
      const plaintext = new TextEncoder().encode('Hello, World!');
      const key = randomAesKey();

      const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, key);
      const decrypted = aesGcmDecrypt(ciphertext, key, iv, tag);

      expect(decrypted).toEqual(plaintext);
    });

    it('should support AAD (Additional Authenticated Data)', () => {
      const plaintext = new TextEncoder().encode('Secret message');
      const key = randomAesKey();
      const aad = new TextEncoder().encode('header data');

      const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, key, aad);
      const decrypted = aesGcmDecrypt(ciphertext, key, iv, tag, aad);

      expect(decrypted).toEqual(plaintext);
    });

    it('should fail decryption with wrong AAD', () => {
      const plaintext = new TextEncoder().encode('Secret message');
      const key = randomAesKey();
      const aad = new TextEncoder().encode('correct aad');
      const wrongAad = new TextEncoder().encode('wrong aad');

      const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, key, aad);

      expect(() => aesGcmDecrypt(ciphertext, key, iv, tag, wrongAad)).toThrow();
    });

    it('should fail decryption with wrong key', () => {
      const plaintext = new TextEncoder().encode('Secret message');
      const key = randomAesKey();
      const wrongKey = randomAesKey();

      const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, key);

      expect(() => aesGcmDecrypt(ciphertext, wrongKey, iv, tag)).toThrow();
    });

    it('should fail decryption with wrong tag', () => {
      const plaintext = new TextEncoder().encode('Secret message');
      const key = randomAesKey();

      const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, key);
      const wrongTag = new Uint8Array([...tag]);
      wrongTag[0] ^= 0xff; // Flip bits

      expect(() => aesGcmDecrypt(ciphertext, key, iv, wrongTag)).toThrow();
    });

    it('should fail decryption with wrong IV', () => {
      const plaintext = new TextEncoder().encode('Secret message');
      const key = randomAesKey();

      const { ciphertext, iv, tag } = aesGcmEncrypt(plaintext, key);
      const wrongIv = new Uint8Array([...iv]);
      wrongIv[0] ^= 0xff;

      expect(() => aesGcmDecrypt(ciphertext, key, wrongIv, tag)).toThrow();
    });

    it('should throw on invalid key length (too short)', () => {
      const plaintext = new TextEncoder().encode('test');
      const shortKey = randomBytes(16);

      expect(() => aesGcmEncrypt(plaintext, shortKey)).toThrow(
        'AES-256-GCM requires 32-byte key'
      );
    });

    it('should throw on invalid key length (too long)', () => {
      const plaintext = new TextEncoder().encode('test');
      const longKey = randomBytes(64);

      expect(() => aesGcmEncrypt(plaintext, longKey)).toThrow(
        'AES-256-GCM requires 32-byte key'
      );
    });

    it('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = new TextEncoder().encode('Same message');
      const key = randomAesKey();

      const result1 = aesGcmEncrypt(plaintext, key);
      const result2 = aesGcmEncrypt(plaintext, key);

      expect(result1.ciphertext).not.toEqual(result2.ciphertext);
      expect(result1.iv).not.toEqual(result2.iv);
    });

    it('should produce 12-byte IV and 16-byte tag', () => {
      const plaintext = new TextEncoder().encode('test');
      const key = randomAesKey();

      const { iv, tag } = aesGcmEncrypt(plaintext, key);

      expect(iv.length).toBe(12);
      expect(tag.length).toBe(16);
    });
  });

  describe('toBase64/fromBase64', () => {
    it('should roundtrip data correctly', () => {
      const data = randomBytes(64);

      const base64 = toBase64(data);
      const decoded = fromBase64(base64);

      expect(decoded).toEqual(data);
    });

    it('should handle empty data', () => {
      const data = new Uint8Array(0);

      const base64 = toBase64(data);
      const decoded = fromBase64(base64);

      expect(decoded).toEqual(data);
    });

    it('should handle various data sizes', () => {
      for (const size of [1, 7, 16, 32, 100, 255]) {
        const data = randomBytes(size);
        const base64 = toBase64(data);
        const decoded = fromBase64(base64);
        expect(decoded).toEqual(data);
      }
    });
  });

  describe('encryptJson/decryptJson', () => {
    it('should encrypt and decrypt JSON objects', () => {
      const payload = { message: 'Hello', count: 42, nested: { key: 'value' } };
      const key = randomAesKey();

      const encrypted = encryptJson(payload, key);
      const decrypted = decryptJson(encrypted, key);

      expect(decrypted).toEqual(payload);
    });

    it('should encrypt and decrypt JSON arrays', () => {
      const payload = [1, 2, 3, 'four', { five: 5 }];
      const key = randomAesKey();

      const encrypted = encryptJson(payload, key);
      const decrypted = decryptJson<typeof payload>(encrypted, key);

      expect(decrypted).toEqual(payload);
    });

    it('should produce valid EncryptedPayload structure', () => {
      const payload = { test: 'data' };
      const key = randomAesKey();

      const encrypted = encryptJson(payload, key);

      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('ciphertext');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.tag).toBe('string');
      expect(typeof encrypted.ciphertext).toBe('string');
    });

    it('should fail with wrong key', () => {
      const payload = { secret: 'data' };
      const key = randomAesKey();
      const wrongKey = randomAesKey();

      const encrypted = encryptJson(payload, key);

      expect(() => decryptJson(encrypted, wrongKey)).toThrow();
    });
  });

  describe('keccakHash', () => {
    it('should produce consistent hash for string input', () => {
      const result1 = keccakHash('test string');
      const result2 = keccakHash('test string');

      expect(result1).toBe(result2);
    });

    it('should produce consistent hash for bytes input', () => {
      const data = new TextEncoder().encode('test bytes');

      const result1 = keccakHash(data);
      const result2 = keccakHash(data);

      expect(result1).toBe(result2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = keccakHash('input1');
      const hash2 = keccakHash('input2');

      expect(hash1).not.toBe(hash2);
    });

    it('should return hex string with 0x prefix', () => {
      const hash = keccakHash('test');

      expect(hash.startsWith('0x')).toBe(true);
      expect(hash.length).toBe(66); // 0x + 64 hex chars
    });
  });

  describe('bytesFromHex/hexFromBytes', () => {
    it('should convert bytes to hex and back', () => {
      const bytes = randomBytes(32);

      const hex = hexFromBytes(bytes);
      const decoded = bytesFromHex(hex);

      expect(decoded).toEqual(bytes);
    });

    it('should handle hex with 0x prefix', () => {
      const hex = '0xdeadbeef';
      const bytes = bytesFromHex(hex);

      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('should handle hex without 0x prefix', () => {
      const hex = 'deadbeef';
      const bytes = bytesFromHex(hex);

      expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('should produce hex with 0x prefix', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const hex = hexFromBytes(bytes);

      expect(hex).toBe('0xdeadbeef');
    });
  });
});

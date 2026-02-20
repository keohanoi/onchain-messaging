import { describe, it, expect, beforeEach } from 'vitest';
import { encryptAttachment } from '../../src/attachments';
import { MockStorageClient } from '../fixtures/mocks';
import { randomAesKey } from '../fixtures/keys';

describe('attachments', () => {
  let storage: MockStorageClient;
  let messageKey: Uint8Array;

  beforeEach(() => {
    storage = new MockStorageClient();
    messageKey = randomAesKey();
  });

  describe('encryptAttachment', () => {
    it('should return manifest and encrypted file CID', async () => {
      const file = new TextEncoder().encode('Hello, World!');
      const filename = 'test.txt';
      const mimeType = 'text/plain';

      const result = await encryptAttachment(
        file,
        filename,
        mimeType,
        storage,
        messageKey
      );

      expect(result.manifest).toBeDefined();
      expect(result.encryptedFileCid).toBeDefined();
      expect(result.encryptedThumbnailCid).toBeUndefined();
    });

    it('should return correct manifest structure', async () => {
      const file = new TextEncoder().encode('Test content');
      const filename = 'document.txt';
      const mimeType = 'text/plain';

      const { manifest } = await encryptAttachment(
        file,
        filename,
        mimeType,
        storage,
        messageKey
      );

      expect(manifest.cid).toBeDefined();
      expect(manifest.filename).toBe(filename);
      expect(manifest.size).toBe(file.length);
      expect(manifest.mimeType).toBe(mimeType);
      expect(manifest.hash).toBeDefined();
      expect(manifest.key).toBeDefined();
    });

    it('should store encrypted file in storage', async () => {
      const file = new TextEncoder().encode('Content to encrypt');

      const { encryptedFileCid, manifest } = await encryptAttachment(
        file,
        'test.bin',
        'application/octet-stream',
        storage,
        messageKey
      );

      expect(manifest.cid).toBe(encryptedFileCid);
      expect(storage.has(encryptedFileCid)).toBe(true);

      // Stored data should be different from original (encrypted)
      const stored = await storage.get(encryptedFileCid);
      expect(stored).not.toEqual(file);
    });

    it('should handle thumbnail', async () => {
      const file = new TextEncoder().encode('Full size image');
      const thumbnail = new TextEncoder().encode('Thumbnail');

      const result = await encryptAttachment(
        file,
        'image.jpg',
        'image/jpeg',
        storage,
        messageKey,
        thumbnail
      );

      expect(result.encryptedThumbnailCid).toBeDefined();
      expect(result.manifest.thumbnailCid).toBe(result.encryptedThumbnailCid);
      expect(storage.has(result.encryptedThumbnailCid!)).toBe(true);
    });

    it('should compute correct SHA-256 hash', async () => {
      const file = new TextEncoder().encode('Hash this content');

      const { manifest } = await encryptAttachment(
        file,
        'test.txt',
        'text/plain',
        storage,
        messageKey
      );

      // Hash should be 64 hex characters (256 bits)
      expect(manifest.hash).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(manifest.hash)).toBe(true);
    });

    it('should wrap file key with message key', async () => {
      const file = new TextEncoder().encode('Secret file content');

      const { manifest } = await encryptAttachment(
        file,
        'secret.txt',
        'text/plain',
        storage,
        messageKey
      );

      // Key should be a JSON string containing encrypted key data
      expect(manifest.key).toBeDefined();

      const keyPayload = JSON.parse(manifest.key);
      expect(keyPayload.iv).toBeDefined();
      expect(keyPayload.tag).toBeDefined();
      expect(keyPayload.ciphertext).toBeDefined();
    });

    it('should produce different CIDs for different files', async () => {
      const file1 = new TextEncoder().encode('File 1 content');
      const file2 = new TextEncoder().encode('File 2 content');

      const result1 = await encryptAttachment(
        file1,
        'file1.txt',
        'text/plain',
        storage,
        messageKey
      );
      const result2 = await encryptAttachment(
        file2,
        'file2.txt',
        'text/plain',
        storage,
        messageKey
      );

      expect(result1.encryptedFileCid).not.toBe(result2.encryptedFileCid);
    });

    it('should produce different encrypted data for same file', async () => {
      const file = new TextEncoder().encode('Same content');

      const result1 = await encryptAttachment(
        file,
        'file.txt',
        'text/plain',
        storage,
        messageKey
      );
      const result2 = await encryptAttachment(
        file,
        'file.txt',
        'text/plain',
        storage,
        messageKey
      );

      // Different random key = different encrypted data
      const encrypted1 = await storage.get(result1.encryptedFileCid);
      const encrypted2 = await storage.get(result2.encryptedFileCid);
      expect(encrypted1).not.toEqual(encrypted2);

      // But hash should be same (same original content)
      expect(result1.manifest.hash).toBe(result2.manifest.hash);
    });

    it('should handle various file sizes', async () => {
      const sizes = [0, 1, 100, 1024, 10000];

      for (const size of sizes) {
        const file = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
          file[i] = i % 256;
        }

        const result = await encryptAttachment(
          file,
          `file_${size}.bin`,
          'application/octet-stream',
          storage,
          messageKey
        );

        expect(result.manifest.size).toBe(size);
        expect(result.encryptedFileCid).toBeDefined();
      }
    });

    it('should handle empty file', async () => {
      const file = new Uint8Array(0);

      const result = await encryptAttachment(
        file,
        'empty.txt',
        'text/plain',
        storage,
        messageKey
      );

      expect(result.manifest.size).toBe(0);
      expect(result.encryptedFileCid).toBeDefined();
    });
  });
});

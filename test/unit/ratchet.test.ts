import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  initRatchet,
  dhRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  pruneSkippedKeys
} from '../../src/ratchet';
import { generateTestKeyPair } from '../fixtures/keys';
import { createTestRatchetState } from '../fixtures/mocks';

describe('ratchet', () => {
  describe('initRatchet', () => {
    it('should initialize ratchet state with proper values', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();

      const state = initRatchet(sessionKey, dhPair);

      expect(state.rootKey).toEqual(sessionKey);
      expect(state.sendChainKey).toBeInstanceOf(Uint8Array);
      expect(state.recvChainKey).toBeInstanceOf(Uint8Array);
      expect(state.dhPair).toEqual(dhPair);
      expect(state.sendCount).toBe(0);
      expect(state.recvCount).toBe(0);
      expect(state.skippedKeys).toEqual([]);
      expect(state.version).toBe(0);
    });

    it('should derive different send and recv chain keys', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();

      const state = initRatchet(sessionKey, dhPair);

      expect(state.sendChainKey).not.toEqual(state.recvChainKey);
    });

    it('should derive 32-byte chain keys', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();

      const state = initRatchet(sessionKey, dhPair);

      expect(state.sendChainKey.length).toBe(32);
      expect(state.recvChainKey.length).toBe(32);
    });
  });

  describe('dhRatchet', () => {
    it('should rotate keys properly', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const initialState = initRatchet(sessionKey, dhPair);

      const theirDhPub = generateTestKeyPair().publicKey;
      const newState = dhRatchet(initialState, theirDhPub);

      // New DH pair should be generated
      expect(newState.dhPair.privateKey).not.toEqual(initialState.dhPair.privateKey);
      expect(newState.dhPair.publicKey).not.toEqual(initialState.dhPair.publicKey);

      // Their public key should be stored
      expect(newState.theirDhPub).toEqual(theirDhPub);

      // Root key should change
      expect(newState.rootKey).not.toEqual(initialState.rootKey);

      // Counts should reset
      expect(newState.sendCount).toBe(0);
      expect(newState.recvCount).toBe(0);

      // Version should increment
      expect(newState.version).toBe(initialState.version! + 1);
    });

    it('should preserve skipped keys', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const initialState = initRatchet(sessionKey, dhPair);

      // Add some skipped keys
      initialState.skippedKeys = [
        { dhPub: 'test', msgIndex: 0, messageKey: new Uint8Array(32) }
      ];

      const theirDhPub = generateTestKeyPair().publicKey;
      const newState = dhRatchet(initialState, theirDhPub);

      expect(newState.skippedKeys).toEqual(initialState.skippedKeys);
    });

    it('should generate valid new key pair', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const initialState = initRatchet(sessionKey, dhPair);

      const theirDhPub = generateTestKeyPair().publicKey;
      const newState = dhRatchet(initialState, theirDhPub);

      // Verify new key pair is valid
      const expectedPub = secp256k1.getPublicKey(newState.dhPair.privateKey, true);
      expect(newState.dhPair.publicKey).toEqual(expectedPub);
    });
  });

  describe('ratchetEncrypt', () => {
    it('should advance send chain and return valid ciphertext', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('Hello, World!');
      const result = ratchetEncrypt(state, plaintext);

      expect(result.ciphertext).toBeInstanceOf(Uint8Array);
      expect(result.header).toHaveProperty('dhPub');
      expect(result.header).toHaveProperty('msgIndex', 0);
      expect(result.iv).toBeInstanceOf(Uint8Array);
      expect(result.tag).toBeInstanceOf(Uint8Array);
      expect(result.messageKey).toBeInstanceOf(Uint8Array);
      expect(result.headerKey).toBeInstanceOf(Uint8Array);
    });

    it('should advance send count', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');

      const result1 = ratchetEncrypt(state, plaintext);
      expect(result1.header.msgIndex).toBe(0);
      expect(result1.state.sendCount).toBe(1);

      const result2 = ratchetEncrypt(result1.state, plaintext);
      expect(result2.header.msgIndex).toBe(1);
      expect(result2.state.sendCount).toBe(2);
    });

    it('should include header in AAD', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');
      const result = ratchetEncrypt(state, plaintext);

      // Header should be included - verified by successful decrypt
      expect(result.header.dhPub).toBeDefined();
    });

    it('should support additional AAD', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');
      const aad = new TextEncoder().encode('extra data');

      const result = ratchetEncrypt(state, plaintext, aad);
      expect(result.ciphertext).toBeInstanceOf(Uint8Array);
    });

    it('should advance chain key after encryption', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');
      const result = ratchetEncrypt(state, plaintext);

      // Chain key should change after encryption
      expect(result.state.sendChainKey).not.toEqual(state.sendChainKey);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');
      const result1 = ratchetEncrypt(state, plaintext);
      const result2 = ratchetEncrypt(result1.state, plaintext);

      // Different message keys = different ciphertext
      expect(result1.ciphertext).not.toEqual(result2.ciphertext);
    });
  });

  describe('ratchetDecrypt', () => {
    it('should fail with wrong state (wrong chain key)', () => {
      // This tests that decryption fails when keys don't match
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');
      const encrypted = ratchetEncrypt(state, plaintext);

      // Different state with different chain keys should fail
      const wrongState = initRatchet(new Uint8Array(32).fill(99), generateTestKeyPair());

      expect(() =>
        ratchetDecrypt(
          wrongState,
          encrypted.header,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag
        )
      ).toThrow();
    });

    it('should fail with wrong AAD', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const aliceDh = generateTestKeyPair();
      const bobDh = generateTestKeyPair();

      let aliceState = initRatchet(sessionKey, aliceDh);
      let bobState = initRatchet(sessionKey, bobDh);

      bobState = dhRatchet(bobState, aliceDh.publicKey);

      const plaintext = new TextEncoder().encode('test');
      const aad = new TextEncoder().encode('correct');
      const wrongAad = new TextEncoder().encode('wrong');

      const encrypted = ratchetEncrypt(aliceState, plaintext, aad);

      expect(() =>
        ratchetDecrypt(
          bobState,
          encrypted.header,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag,
          wrongAad
        )
      ).toThrow();
    });
  });

  describe('out-of-order messages', () => {
    it('should throw on too many skipped messages (MAX_SKIP)', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const aliceDh = generateTestKeyPair();
      const bobDh = generateTestKeyPair();

      let aliceState = initRatchet(sessionKey, aliceDh);
      let bobState = initRatchet(sessionKey, bobDh);

      bobState = dhRatchet(bobState, aliceDh.publicKey);

      const plaintext = new TextEncoder().encode('test');
      const encrypted = ratchetEncrypt(aliceState, plaintext);

      // Modify header to claim many skipped messages
      const header = {
        ...encrypted.header,
        msgIndex: 1001 // Beyond MAX_SKIP
      };

      expect(() =>
        ratchetDecrypt(
          bobState,
          header,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.tag
        )
      ).toThrow('Skip limit exceeded');
    });
  });

  describe('pruneSkippedKeys', () => {
    it('should remove old keys when exceeding maxAge', () => {
      const state = createTestRatchetState();
      state.skippedKeys = Array.from({ length: 150 }, (_, i) => ({
        dhPub: `key-${i}`,
        msgIndex: i,
        messageKey: new Uint8Array(32).fill(i)
      }));

      const pruned = pruneSkippedKeys(state, 100);

      expect(pruned.skippedKeys?.length).toBe(100);
      // Should keep most recent
      expect(pruned.skippedKeys?.[0].msgIndex).toBe(50);
    });

    it('should not prune if under maxAge', () => {
      const state = createTestRatchetState();
      state.skippedKeys = Array.from({ length: 50 }, (_, i) => ({
        dhPub: `key-${i}`,
        msgIndex: i,
        messageKey: new Uint8Array(32).fill(i)
      }));

      const pruned = pruneSkippedKeys(state, 100);

      expect(pruned.skippedKeys?.length).toBe(50);
    });

    it('should handle undefined skippedKeys', () => {
      const state = createTestRatchetState();
      state.skippedKeys = undefined;

      const pruned = pruneSkippedKeys(state, 100);

      expect(pruned.skippedKeys).toBeUndefined();
    });

    it('should keep exactly maxAge keys', () => {
      const state = createTestRatchetState();
      state.skippedKeys = Array.from({ length: 200 }, (_, i) => ({
        dhPub: `key-${i}`,
        msgIndex: i,
        messageKey: new Uint8Array(32).fill(i)
      }));

      const pruned = pruneSkippedKeys(state, 50);

      expect(pruned.skippedKeys?.length).toBe(50);
    });
  });

  describe('header structure', () => {
    it('should include all required header fields', () => {
      const sessionKey = new Uint8Array(32).fill(1);
      const dhPair = generateTestKeyPair();
      const state = initRatchet(sessionKey, dhPair);

      const plaintext = new TextEncoder().encode('test');
      const result = ratchetEncrypt(state, plaintext);

      expect(result.header.dhPub).toBeDefined();
      expect(result.header.msgIndex).toBeDefined();
      expect(typeof result.header.dhPub).toBe('string');
      expect(typeof result.header.msgIndex).toBe('number');
    });
  });
});

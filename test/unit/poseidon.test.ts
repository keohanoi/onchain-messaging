import { describe, it, expect, beforeAll } from 'vitest';
import { createPoseidonHasher } from '../../src/poseidon';

describe('poseidon', () => {
  let poseidon: (inputs: Array<bigint | number | string>) => bigint;

  beforeAll(async () => {
    poseidon = await createPoseidonHasher();
  });

  describe('createPoseidonHasher', () => {
    it('should return a function', async () => {
      const hasher = await createPoseidonHasher();
      expect(typeof hasher).toBe('function');
    });
  });

  describe('poseidon hash', () => {
    it('should produce consistent output for same inputs', () => {
      const inputs = [1n, 2n, 3n];

      const hash1 = poseidon(inputs);
      const hash2 = poseidon(inputs);

      expect(hash1).toBe(hash2);
    });

    it('should produce different outputs for different inputs', () => {
      const hash1 = poseidon([1n, 2n]);
      const hash2 = poseidon([2n, 1n]);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle single input', () => {
      const hash = poseidon([123n]);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should handle number inputs', () => {
      const hash = poseidon([1, 2, 3]);

      expect(typeof hash).toBe('bigint');
    });

    it('should handle hex string inputs', () => {
      const hash = poseidon(['0x1', '0x2', '0x3']);

      expect(typeof hash).toBe('bigint');
    });

    it('should produce valid bigint output', () => {
      const hash = poseidon([1n, 2n, 3n]);

      expect(typeof hash).toBe('bigint');
      // Should be within field modulus (babyjubjub)
      expect(hash).toBeLessThan(
        BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000')
      );
    });

    it('should handle large inputs', () => {
      const largeInput =
        BigInt('0x1000000000000000000000000000000000000000000000000000000000000000');
      const hash = poseidon([largeInput]);

      expect(typeof hash).toBe('bigint');
    });

    it('should handle multiple inputs consistently', () => {
      const inputs: bigint[] = [];
      for (let i = 0; i < 10; i++) {
        inputs.push(BigInt(i));
      }

      const hash1 = poseidon(inputs);
      const hash2 = poseidon(inputs);

      expect(hash1).toBe(hash2);
    });
  });

  describe('hash properties', () => {
    it('should be deterministic across multiple calls', async () => {
      const hasher1 = await createPoseidonHasher();
      const hasher2 = await createPoseidonHasher();

      const inputs = [42n, 99n, 123n];

      expect(hasher1(inputs)).toBe(hasher2(inputs));
    });

    it('should have avalanche effect (small change = different hash)', () => {
      const hash1 = poseidon([1n]);
      const hash2 = poseidon([2n]);

      expect(hash1).not.toBe(hash2);
    });
  });
});

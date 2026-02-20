import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateZKIdentity,
  computeIdentityCommitment,
  computeSenderNullifier,
  computeGroupNullifier,
  SimpleMerkleTree,
  computeMessageHash,
  formatProofForContract,
  ZKProof
} from '../../src/zkProof';

describe('zkProof', () => {
  describe('generateZKIdentity', () => {
    it('should generate identity with unique nullifier and trapdoor', async () => {
      const identity = await generateZKIdentity();

      expect(identity.nullifier).toBeDefined();
      expect(identity.trapdoor).toBeDefined();
      expect(identity.commitment).toBeDefined();

      // Nullifier and trapdoor should be different
      expect(identity.nullifier).not.toBe(identity.trapdoor);
    });

    it('should generate unique identities', async () => {
      const identity1 = await generateZKIdentity();
      const identity2 = await generateZKIdentity();

      expect(identity1.nullifier).not.toBe(identity2.nullifier);
      expect(identity1.trapdoor).not.toBe(identity2.trapdoor);
      expect(identity1.commitment).not.toBe(identity2.commitment);
    });

    it('should generate valid commitment', async () => {
      const identity = await generateZKIdentity();

      // Commitment should be a valid bigint
      expect(typeof identity.commitment).toBe('bigint');
      expect(identity.commitment).toBeGreaterThan(0n);
    });

    it('should generate identities with valid-sized nullifiers', async () => {
      const identity = await generateZKIdentity();

      // Nullifier should be within reasonable range (31 bytes = 248 bits)
      expect(identity.nullifier).toBeGreaterThan(0n);
      expect(identity.nullifier).toBeLessThan(
        BigInt('0x' + 'ff'.repeat(31))
      );
    });
  });

  describe('computeIdentityCommitment', () => {
    it('should be deterministic', async () => {
      const nullifier = 12345n;
      const trapdoor = 67890n;

      const commitment1 = await computeIdentityCommitment(nullifier, trapdoor);
      const commitment2 = await computeIdentityCommitment(nullifier, trapdoor);

      expect(commitment1).toBe(commitment2);
    });

    it('should produce same commitment as generateZKIdentity', async () => {
      const identity = await generateZKIdentity();

      const computed = await computeIdentityCommitment(
        identity.nullifier,
        identity.trapdoor
      );

      expect(computed).toBe(identity.commitment);
    });

    it('should produce different commitments for different inputs', async () => {
      const commitment1 = await computeIdentityCommitment(1n, 2n);
      const commitment2 = await computeIdentityCommitment(2n, 1n);

      expect(commitment1).not.toBe(commitment2);
    });

    it('should return a valid bigint', async () => {
      const commitment = await computeIdentityCommitment(100n, 200n);

      expect(typeof commitment).toBe('bigint');
      expect(commitment).toBeGreaterThan(0n);
    });
  });

  describe('computeSenderNullifier', () => {
    it('should produce correct format (bigint)', async () => {
      const identityNullifier = 123n;
      const merkleRoot = 456n;

      const nullifier = await computeSenderNullifier(identityNullifier, merkleRoot);

      expect(typeof nullifier).toBe('bigint');
      expect(nullifier).toBeGreaterThan(0n);
    });

    it('should be deterministic', async () => {
      const identityNullifier = 111n;
      const merkleRoot = 222n;

      const nullifier1 = await computeSenderNullifier(identityNullifier, merkleRoot);
      const nullifier2 = await computeSenderNullifier(identityNullifier, merkleRoot);

      expect(nullifier1).toBe(nullifier2);
    });

    it('should produce different nullifiers for different roots', async () => {
      const identityNullifier = 333n;

      const nullifier1 = await computeSenderNullifier(identityNullifier, 1n);
      const nullifier2 = await computeSenderNullifier(identityNullifier, 2n);

      expect(nullifier1).not.toBe(nullifier2);
    });

    it('should produce different nullifiers for different identity nullifiers', async () => {
      const merkleRoot = 123n;

      const nullifier1 = await computeSenderNullifier(1n, merkleRoot);
      const nullifier2 = await computeSenderNullifier(2n, merkleRoot);

      expect(nullifier1).not.toBe(nullifier2);
    });
  });

  describe('computeGroupNullifier', () => {
    it('should produce correct format (bigint)', async () => {
      const identityNullifier = 123n;
      const groupId = 456n;
      const epoch = 789n;

      const nullifier = await computeGroupNullifier(
        identityNullifier,
        groupId,
        epoch
      );

      expect(typeof nullifier).toBe('bigint');
      expect(nullifier).toBeGreaterThan(0n);
    });

    it('should be deterministic', async () => {
      const identityNullifier = 111n;
      const groupId = 222n;
      const epoch = 333n;

      const nullifier1 = await computeGroupNullifier(
        identityNullifier,
        groupId,
        epoch
      );
      const nullifier2 = await computeGroupNullifier(
        identityNullifier,
        groupId,
        epoch
      );

      expect(nullifier1).toBe(nullifier2);
    });

    it('should produce different nullifiers for different epochs', async () => {
      const identityNullifier = 444n;
      const groupId = 555n;

      const nullifier1 = await computeGroupNullifier(identityNullifier, groupId, 1n);
      const nullifier2 = await computeGroupNullifier(identityNullifier, groupId, 2n);

      expect(nullifier1).not.toBe(nullifier2);
    });

    it('should produce different nullifiers for different groups', async () => {
      const identityNullifier = 666n;
      const epoch = 777n;

      const nullifier1 = await computeGroupNullifier(identityNullifier, 1n, epoch);
      const nullifier2 = await computeGroupNullifier(identityNullifier, 2n, epoch);

      expect(nullifier1).not.toBe(nullifier2);
    });

    it('should produce different nullifiers for different identity nullifiers', async () => {
      const groupId = 123n;
      const epoch = 456n;

      const nullifier1 = await computeGroupNullifier(1n, groupId, epoch);
      const nullifier2 = await computeGroupNullifier(2n, groupId, epoch);

      expect(nullifier1).not.toBe(nullifier2);
    });
  });

  describe('SimpleMerkleTree', () => {
    it('should insert leaves and return index', async () => {
      const tree = new SimpleMerkleTree(5);

      const index = await tree.insert(123n);

      expect(index).toBe(0);
    });

    it('should return correct root for empty tree', async () => {
      const tree = new SimpleMerkleTree(5);

      const root = await tree.getRoot();

      expect(typeof root).toBe('bigint');
      expect(root).toBeDefined();
    });

    it('should return different roots after insertions', async () => {
      const tree = new SimpleMerkleTree(5);

      const root1 = await tree.getRoot();
      await tree.insert(111n);
      const root2 = await tree.getRoot();
      await tree.insert(222n);
      const root3 = await tree.getRoot();

      expect(root1).not.toBe(root2);
      expect(root2).not.toBe(root3);
    });

    it('should generate valid proof', async () => {
      const tree = new SimpleMerkleTree(5);
      await tree.insert(111n);

      const proof = await tree.getProof(0);

      expect(proof.pathElements).toHaveLength(5);
      expect(proof.pathIndices).toHaveLength(5);
      expect(typeof proof.root).toBe('bigint');
    });

    it('should generate consistent proof root and getRoot', async () => {
      const tree = new SimpleMerkleTree(5);
      await tree.insert(111n);
      await tree.insert(222n);

      const root = await tree.getRoot();
      const proof = await tree.getProof(0);

      expect(proof.root).toBe(root);
    });

    it('should handle multiple insertions', async () => {
      const tree = new SimpleMerkleTree(5);

      for (let i = 0; i < 10; i++) {
        await tree.insert(BigInt(i * 100));
      }

      const root = await tree.getRoot();
      expect(typeof root).toBe('bigint');

      // Should be able to generate proofs for all leaves
      for (let i = 0; i < 10; i++) {
        const proof = await tree.getProof(i);
        expect(proof.pathElements).toHaveLength(5);
      }
    });

    it('should cache zero hashes', async () => {
      const tree = new SimpleMerkleTree(5);

      // Multiple calls should use cached zero hashes
      const root1 = await tree.getRoot();
      const root2 = await tree.getRoot();

      expect(root1).toBe(root2);
    });

    it('should generate correct proof for first leaf', async () => {
      const tree = new SimpleMerkleTree(5);
      await tree.insert(100n);
      await tree.insert(200n);

      const proof = await tree.getProof(0);

      expect(proof.pathIndices[0]).toBe(0); // First leaf is at even index
    });

    it('should generate correct proof for second leaf', async () => {
      const tree = new SimpleMerkleTree(5);
      await tree.insert(100n);
      await tree.insert(200n);

      const proof = await tree.getProof(1);

      expect(proof.pathIndices[0]).toBe(1); // Second leaf is at odd index
    });
  });

  describe('computeMessageHash', () => {
    it('should be deterministic', async () => {
      const contentCid = 'QmTest123';
      const recipientStealth = '0x1234567890123456789012345678901234567890';
      const timestamp = 1234567890;

      const hash1 = await computeMessageHash(contentCid, recipientStealth, timestamp);
      const hash2 = await computeMessageHash(contentCid, recipientStealth, timestamp);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', async () => {
      const recipientStealth = '0x1234567890123456789012345678901234567890';
      const timestamp = 1234567890;

      const hash1 = await computeMessageHash('cid1', recipientStealth, timestamp);
      const hash2 = await computeMessageHash('cid2', recipientStealth, timestamp);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different timestamps', async () => {
      const contentCid = 'QmTest123';
      const recipientStealth = '0x1234567890123456789012345678901234567890';

      const hash1 = await computeMessageHash(contentCid, recipientStealth, 1000);
      const hash2 = await computeMessageHash(contentCid, recipientStealth, 2000);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different recipients', async () => {
      const contentCid = 'QmTest123';
      const timestamp = 1234567890;

      const hash1 = await computeMessageHash(contentCid, '0x1111111111111111111111111111111111111111', timestamp);
      const hash2 = await computeMessageHash(contentCid, '0x2222222222222222222222222222222222222222', timestamp);

      expect(hash1).not.toBe(hash2);
    });

    it('should return a valid bigint', async () => {
      const hash = await computeMessageHash(
        'QmTest',
        '0x1234567890123456789012345678901234567890',
        123
      );

      expect(typeof hash).toBe('bigint');
    });
  });

  describe('formatProofForContract', () => {
    it('should format proof correctly for contract use', () => {
      const proof: ZKProof = {
        proofA: [1n, 2n],
        proofB: [
          [3n, 4n],
          [5n, 6n]
        ],
        proofC: [7n, 8n],
        publicInputs: [9n, 10n, 11n]
      };

      const formatted = formatProofForContract(proof);

      expect(formatted.a.x).toBe(1n);
      expect(formatted.a.y).toBe(2n);
      // Note: proofB has reversed coordinates
      expect(formatted.b.x).toEqual([4n, 3n]);
      expect(formatted.b.y).toEqual([6n, 5n]);
      expect(formatted.c.x).toBe(7n);
      expect(formatted.c.y).toBe(8n);
      expect(formatted.publicInputs).toEqual([9n, 10n, 11n]);
    });

    it('should handle zero values', () => {
      const proof: ZKProof = {
        proofA: [0n, 0n],
        proofB: [
          [0n, 0n],
          [0n, 0n]
        ],
        proofC: [0n, 0n],
        publicInputs: []
      };

      const formatted = formatProofForContract(proof);

      expect(formatted.a.x).toBe(0n);
      expect(formatted.a.y).toBe(0n);
      expect(formatted.publicInputs).toEqual([]);
    });

    it('should handle large values', () => {
      const largeValue = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');

      const proof: ZKProof = {
        proofA: [largeValue, largeValue],
        proofB: [
          [largeValue, largeValue],
          [largeValue, largeValue]
        ],
        proofC: [largeValue, largeValue],
        publicInputs: [largeValue]
      };

      const formatted = formatProofForContract(proof);

      expect(formatted.a.x).toBe(largeValue);
      expect(formatted.publicInputs[0]).toBe(largeValue);
    });
  });

  describe('identity consistency', () => {
    it('should generate identities where commitment can be recomputed', async () => {
      // Generate multiple identities and verify commitment computation
      for (let i = 0; i < 5; i++) {
        const identity = await generateZKIdentity();
        const recomputedCommitment = await computeIdentityCommitment(
          identity.nullifier,
          identity.trapdoor
        );

        expect(recomputedCommitment).toBe(identity.commitment);
      }
    });
  });

  describe('full ZK flow', () => {
    it('should support anonymous sender proof generation flow', async () => {
      // Generate identity
      const identity = await generateZKIdentity();

      // Create merkle tree and insert commitment
      const tree = new SimpleMerkleTree(5);
      await tree.insert(identity.commitment);

      const root = await tree.getRoot();
      const proof = await tree.getProof(0);

      // Compute nullifier
      const nullifier = await computeSenderNullifier(identity.nullifier, root);

      // Compute message hash
      const messageHash = await computeMessageHash(
        'QmContentCid',
        '0x1234567890123456789012345678901234567890',
        Date.now()
      );

      // All values should be valid bigints
      expect(typeof identity.nullifier).toBe('bigint');
      expect(typeof identity.trapdoor).toBe('bigint');
      expect(typeof identity.commitment).toBe('bigint');
      expect(typeof root).toBe('bigint');
      expect(typeof nullifier).toBe('bigint');
      expect(typeof messageHash).toBe('bigint');

      // Proof should have correct structure
      expect(proof.pathElements.length).toBe(5);
      expect(proof.pathIndices.length).toBe(5);
    });
  });
});

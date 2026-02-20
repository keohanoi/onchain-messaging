/**
 * ZK Proof Generation Utilities
 *
 * CRITICAL FIX #2: Helper functions for generating ZK proofs
 * for anonymous messaging and group membership verification
 */

import { createPoseidonHasher } from "./poseidon";
import { keccakHash } from "./crypto";

// Tree height for merkle proofs
export const TREE_HEIGHT = 20;

// Interface for identity
export interface ZKIdentity {
  nullifier: bigint;
  trapdoor: bigint;
  commitment: bigint;
}

// Interface for merkle proof
export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
}

// Interface for anonymous sender proof inputs
export interface AnonymousSenderInputs {
  identityNullifier: bigint;
  identityTrapdoor: bigint;
  merklePath: bigint[];
  merklePathIndices: number[];
  merkleRoot: bigint;
  messageHash: bigint;
}

// Interface for group member proof inputs
export interface GroupMemberInputs extends AnonymousSenderInputs {
  groupId: bigint;
  epoch: bigint;
}

// Interface for generated proof
export interface ZKProof {
  proofA: [bigint, bigint];
  proofB: [[bigint, bigint], [bigint, bigint]];
  proofC: [bigint, bigint];
  publicInputs: bigint[];
}

/**
 * Generate a new ZK identity
 * @returns A new identity with nullifier, trapdoor, and commitment
 */
export async function generateZKIdentity(): Promise<ZKIdentity> {
  const crypto = await import("crypto");

  // Generate random nullifier and trapdoor
  const nullifier = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const trapdoor = BigInt("0x" + crypto.randomBytes(31).toString("hex"));

  // Compute commitment: poseidon(nullifier, trapdoor)
  const poseidon = await createPoseidonHasher();
  const commitment = await poseidon([nullifier, trapdoor]);

  return { nullifier, trapdoor, commitment };
}

/**
 * Generate identity commitment from existing nullifier and trapdoor
 */
export async function computeIdentityCommitment(
  nullifier: bigint,
  trapdoor: bigint
): Promise<bigint> {
  const poseidon = await createPoseidonHasher();
  return await poseidon([nullifier, trapdoor]);
}

/**
 * Compute nullifier for anonymous sending
 * nullifier = poseidon(identityNullifier, merkleRoot)
 */
export async function computeSenderNullifier(
  identityNullifier: bigint,
  merkleRoot: bigint
): Promise<bigint> {
  const poseidon = await createPoseidonHasher();
  return await poseidon([identityNullifier, merkleRoot]);
}

/**
 * Compute nullifier for group membership
 * nullifier = poseidon(poseidon(identityNullifier, groupId), epoch)
 */
export async function computeGroupNullifier(
  identityNullifier: bigint,
  groupId: bigint,
  epoch: bigint
): Promise<bigint> {
  const poseidon = await createPoseidonHasher();
  const hash1 = await poseidon([identityNullifier, groupId]);
  return await poseidon([hash1, epoch]);
}

/**
 * Simple in-memory merkle tree for testing
 * Production should use a persistent tree (e.g., in IPFS or database)
 */
export class SimpleMerkleTree {
  private leaves: bigint[] = [];
  private height: number;
  private _zeroHashes: bigint[] | null = null;

  constructor(height: number = TREE_HEIGHT) {
    this.height = height;
  }

  /**
   * Lazily compute zero hashes on first access
   */
  private async getZeroHashes(): Promise<bigint[]> {
    if (this._zeroHashes !== null) {
      return this._zeroHashes;
    }

    const poseidon = await createPoseidonHasher();
    const zeros: bigint[] = [BigInt(0)];

    for (let i = 0; i < this.height; i++) {
      zeros.push(await poseidon([zeros[i], zeros[i]]));
    }

    this._zeroHashes = zeros;
    return zeros;
  }

  async insert(leaf: bigint): Promise<number> {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }

  async getRoot(): Promise<bigint> {
    const zeroHashes = await this.getZeroHashes();

    if (this.leaves.length === 0) {
      return zeroHashes[this.height];
    }

    const poseidon = await createPoseidonHasher();
    let currentLevel = [...this.leaves];

    for (let i = 0; i < this.height; i++) {
      const nextLevel: bigint[] = [];

      for (let j = 0; j < currentLevel.length; j += 2) {
        const left = currentLevel[j];
        const right = currentLevel[j + 1] ?? zeroHashes[i];
        nextLevel.push(await poseidon([left, right]));
      }

      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  async getProof(index: number): Promise<MerkleProof> {
    const zeroHashes = await this.getZeroHashes();
    const poseidon = await createPoseidonHasher();
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let currentLevel = [...this.leaves];
    let currentIndex = index;

    for (let i = 0; i < this.height; i++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const sibling = currentLevel[siblingIndex] ?? zeroHashes[i];

      pathElements.push(sibling);
      pathIndices.push(currentIndex % 2);

      // Build next level
      const nextLevel: bigint[] = [];
      for (let j = 0; j < currentLevel.length; j += 2) {
        const left = currentLevel[j];
        const right = currentLevel[j + 1] ?? zeroHashes[i];
        nextLevel.push(await poseidon([left, right]));
      }
      currentLevel = nextLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: await this.getRoot()
    };
  }
}

/**
 * Generate a ZK proof for anonymous sender
 *
 * NOTE: This is a placeholder. In production, use snarkjs to generate
 * actual Groth16 proofs from the compiled circuits.
 *
 * @param inputs The proof inputs
 * @param wasmPath Path to the compiled circuit WASM
 * @param zkeyPath Path to the proving key
 */
export async function generateAnonymousSenderProof(
  inputs: AnonymousSenderInputs,
  _wasmPath?: string,
  _zkeyPath?: string
): Promise<ZKProof> {
  // In production, use snarkjs:
  // const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  //   {
  //     identity_nullifier: inputs.identityNullifier,
  //     identity_trapdoor: inputs.identityTrapdoor,
  //     merkle_path: inputs.merklePath,
  //     merkle_path_indices: inputs.merklePathIndices,
  //     merkle_root: inputs.merkleRoot,
  //     message_hash: inputs.messageHash
  //   },
  //   wasmPath,
  //   zkeyPath
  // );

  // Placeholder: return dummy proof
  // This should be replaced with actual proof generation
  const poseidon = await createPoseidonHasher();
  const nullifier = await poseidon([inputs.identityNullifier, inputs.merkleRoot]);

  return {
    proofA: [BigInt(0), BigInt(0)],
    proofB: [[BigInt(0), BigInt(0)], [BigInt(0), BigInt(0)]],
    proofC: [BigInt(0), BigInt(0)],
    publicInputs: [nullifier, inputs.merkleRoot, inputs.messageHash]
  };
}

/**
 * Generate a ZK proof for group membership
 *
 * NOTE: This is a placeholder. In production, use snarkjs.
 */
export async function generateGroupMemberProof(
  inputs: GroupMemberInputs,
  _wasmPath?: string,
  _zkeyPath?: string
): Promise<ZKProof> {
  const poseidon = await createPoseidonHasher();
  const nullifier = await computeGroupNullifier(
    inputs.identityNullifier,
    inputs.groupId,
    inputs.epoch
  );

  return {
    proofA: [BigInt(0), BigInt(0)],
    proofB: [[BigInt(0), BigInt(0)], [BigInt(0), BigInt(0)]],
    proofC: [BigInt(0), BigInt(0)],
    publicInputs: [nullifier, inputs.groupId, inputs.merkleRoot, inputs.epoch]
  };
}

/**
 * Verify a ZK proof on-chain (helper for contract interaction)
 */
export function formatProofForContract(proof: ZKProof): {
  a: { x: bigint; y: bigint };
  b: { x: [bigint, bigint]; y: [bigint, bigint] };
  c: { x: bigint; y: bigint };
  publicInputs: bigint[];
} {
  return {
    a: { x: proof.proofA[0], y: proof.proofA[1] },
    b: {
      x: [proof.proofB[0][1], proof.proofB[0][0]],
      y: [proof.proofB[1][1], proof.proofB[1][0]]
    },
    c: { x: proof.proofC[0], y: proof.proofC[1] },
    publicInputs: proof.publicInputs
  };
}

/**
 * Compute message hash for ZK proof
 */
export async function computeMessageHash(
  contentCid: string,
  recipientStealth: string,
  timestamp: number
): Promise<bigint> {
  const hash = keccakHash(`${contentCid}:${recipientStealth}:${timestamp}`);
  return BigInt(hash);
}

/**
 * ZK Proof Generation Utilities
 *
 * CRITICAL FIX #2: Helper functions for generating ZK proofs
 * for anonymous messaging and group membership verification
 */

import { createPoseidonHasher } from "./poseidon";
import { keccakHash, hexFromBytes } from "./crypto";
import { AbiCoder } from "ethers";

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
 * SECURITY: This function requires snarkjs and compiled circuits.
 * The wasmPath and zkeyPath parameters are required for proof generation.
 *
 * @param inputs The proof inputs
 * @param wasmPath Path to the compiled circuit WASM (required)
 * @param zkeyPath Path to the proving key (required)
 * @throws Error if wasmPath or zkeyPath are not provided
 */
export async function generateAnonymousSenderProof(
  inputs: AnonymousSenderInputs,
  wasmPath?: string,
  zkeyPath?: string
): Promise<ZKProof> {
  if (!wasmPath || !zkeyPath) {
    throw new Error(
      "ZK proof generation requires wasmPath and zkeyPath. " +
      "Install snarkjs and provide paths to compiled circuits."
    );
  }

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

  // For now, throw error - proof generation requires snarkjs integration
  throw new Error(
    "ZK proof generation not implemented. Integrate snarkjs for production use."
  );
}

/**
 * Generate a ZK proof for group membership
 *
 * SECURITY: This function requires snarkjs and compiled circuits.
 * The wasmPath and zkeyPath parameters are required for proof generation.
 *
 * @param inputs The proof inputs
 * @param wasmPath Path to the compiled circuit WASM (required)
 * @param zkeyPath Path to the proving key (required)
 * @throws Error if wasmPath or zkeyPath are not provided
 */
export async function generateGroupMemberProof(
  inputs: GroupMemberInputs,
  wasmPath?: string,
  zkeyPath?: string
): Promise<ZKProof> {
  if (!wasmPath || !zkeyPath) {
    throw new Error(
      "ZK proof generation requires wasmPath and zkeyPath. " +
      "Install snarkjs and provide paths to compiled circuits."
    );
  }

  // For now, throw error - proof generation requires snarkjs integration
  throw new Error(
    "ZK proof generation not implemented. Integrate snarkjs for production use."
  );
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
 * Uses ABI encoding to prevent collision attacks from simple string concatenation
 */
export async function computeMessageHash(
  contentCid: string,
  recipientStealth: string,
  timestamp: number
): Promise<bigint> {
  // Use ABI encoding for proper domain separation and collision resistance
  // This ensures "a:b:c" cannot collide with parsed components
  const abiCoder = AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    ["string", "address", "uint256"],
    [contentCid, recipientStealth, timestamp]
  );
  const hash = keccakHash(Buffer.from(encoded.slice(2), "hex"));
  return BigInt(hash);
}

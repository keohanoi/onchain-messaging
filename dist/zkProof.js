"use strict";
/**
 * ZK Proof Generation Utilities
 *
 * CRITICAL FIX #2: Helper functions for generating ZK proofs
 * for anonymous messaging and group membership verification
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleMerkleTree = exports.TREE_HEIGHT = void 0;
exports.generateZKIdentity = generateZKIdentity;
exports.computeIdentityCommitment = computeIdentityCommitment;
exports.computeSenderNullifier = computeSenderNullifier;
exports.computeGroupNullifier = computeGroupNullifier;
exports.generateAnonymousSenderProof = generateAnonymousSenderProof;
exports.generateGroupMemberProof = generateGroupMemberProof;
exports.formatProofForContract = formatProofForContract;
exports.computeMessageHash = computeMessageHash;
const poseidon_1 = require("./poseidon");
const crypto_1 = require("./crypto");
const ethers_1 = require("ethers");
// Tree height for merkle proofs
exports.TREE_HEIGHT = 20;
/**
 * Generate a new ZK identity
 * @returns A new identity with nullifier, trapdoor, and commitment
 */
async function generateZKIdentity() {
    const crypto = await Promise.resolve().then(() => __importStar(require("crypto")));
    // Generate random nullifier and trapdoor
    const nullifier = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
    const trapdoor = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
    // Compute commitment: poseidon(nullifier, trapdoor)
    const poseidon = await (0, poseidon_1.createPoseidonHasher)();
    const commitment = await poseidon([nullifier, trapdoor]);
    return { nullifier, trapdoor, commitment };
}
/**
 * Generate identity commitment from existing nullifier and trapdoor
 */
async function computeIdentityCommitment(nullifier, trapdoor) {
    const poseidon = await (0, poseidon_1.createPoseidonHasher)();
    return await poseidon([nullifier, trapdoor]);
}
/**
 * Compute nullifier for anonymous sending
 * nullifier = poseidon(identityNullifier, merkleRoot)
 */
async function computeSenderNullifier(identityNullifier, merkleRoot) {
    const poseidon = await (0, poseidon_1.createPoseidonHasher)();
    return await poseidon([identityNullifier, merkleRoot]);
}
/**
 * Compute nullifier for group membership
 * nullifier = poseidon(poseidon(identityNullifier, groupId), epoch)
 */
async function computeGroupNullifier(identityNullifier, groupId, epoch) {
    const poseidon = await (0, poseidon_1.createPoseidonHasher)();
    const hash1 = await poseidon([identityNullifier, groupId]);
    return await poseidon([hash1, epoch]);
}
/**
 * Simple in-memory merkle tree for testing
 * Production should use a persistent tree (e.g., in IPFS or database)
 */
class SimpleMerkleTree {
    constructor(height = exports.TREE_HEIGHT) {
        this.leaves = [];
        this._zeroHashes = null;
        this.height = height;
    }
    /**
     * Lazily compute zero hashes on first access
     */
    async getZeroHashes() {
        if (this._zeroHashes !== null) {
            return this._zeroHashes;
        }
        const poseidon = await (0, poseidon_1.createPoseidonHasher)();
        const zeros = [BigInt(0)];
        for (let i = 0; i < this.height; i++) {
            zeros.push(await poseidon([zeros[i], zeros[i]]));
        }
        this._zeroHashes = zeros;
        return zeros;
    }
    async insert(leaf) {
        this.leaves.push(leaf);
        return this.leaves.length - 1;
    }
    async getRoot() {
        const zeroHashes = await this.getZeroHashes();
        if (this.leaves.length === 0) {
            return zeroHashes[this.height];
        }
        const poseidon = await (0, poseidon_1.createPoseidonHasher)();
        let currentLevel = [...this.leaves];
        for (let i = 0; i < this.height; i++) {
            const nextLevel = [];
            for (let j = 0; j < currentLevel.length; j += 2) {
                const left = currentLevel[j];
                const right = currentLevel[j + 1] ?? zeroHashes[i];
                nextLevel.push(await poseidon([left, right]));
            }
            currentLevel = nextLevel;
        }
        return currentLevel[0];
    }
    async getProof(index) {
        const zeroHashes = await this.getZeroHashes();
        const poseidon = await (0, poseidon_1.createPoseidonHasher)();
        const pathElements = [];
        const pathIndices = [];
        let currentLevel = [...this.leaves];
        let currentIndex = index;
        for (let i = 0; i < this.height; i++) {
            const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
            const sibling = currentLevel[siblingIndex] ?? zeroHashes[i];
            pathElements.push(sibling);
            pathIndices.push(currentIndex % 2);
            // Build next level
            const nextLevel = [];
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
exports.SimpleMerkleTree = SimpleMerkleTree;
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
async function generateAnonymousSenderProof(inputs, wasmPath, zkeyPath) {
    if (!wasmPath || !zkeyPath) {
        throw new Error("ZK proof generation requires wasmPath and zkeyPath. " +
            "Install snarkjs and provide paths to compiled circuits.");
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
    throw new Error("ZK proof generation not implemented. Integrate snarkjs for production use.");
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
async function generateGroupMemberProof(inputs, wasmPath, zkeyPath) {
    if (!wasmPath || !zkeyPath) {
        throw new Error("ZK proof generation requires wasmPath and zkeyPath. " +
            "Install snarkjs and provide paths to compiled circuits.");
    }
    // For now, throw error - proof generation requires snarkjs integration
    throw new Error("ZK proof generation not implemented. Integrate snarkjs for production use.");
}
/**
 * Verify a ZK proof on-chain (helper for contract interaction)
 */
function formatProofForContract(proof) {
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
async function computeMessageHash(contentCid, recipientStealth, timestamp) {
    // Use ABI encoding for proper domain separation and collision resistance
    // This ensures "a:b:c" cannot collide with parsed components
    const abiCoder = ethers_1.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(["string", "address", "uint256"], [contentCid, recipientStealth, timestamp]);
    const hash = (0, crypto_1.keccakHash)(Buffer.from(encoded.slice(2), "hex"));
    return BigInt(hash);
}

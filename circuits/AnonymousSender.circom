/**
 * AnonymousSender Circuit
 *
 * CRITICAL FIX #2: ZK circuit for anonymous message posting
 *
 * This circuit proves that a sender is a registered user (has an identity commitment
 * in the global merkle tree) without revealing which user they are.
 *
 * Inputs:
 * - identity_commitment: User's public identity commitment (private)
 * - identity_nullifier: Random value for nullifier derivation (private)
 * - identity_trapdoor: Random value for identity (private)
 * - merkle_root: Root of the identity merkle tree (public)
 * - merkle_path: Path from leaf to root (private)
 * - merkle_path_indices: Left/right indices for path (private)
 * - message_hash: Hash of the message being sent (public)
 *
 * Outputs:
 * - nullifier: Unique identifier to prevent double-sending (public)
 * - commitment_hash: Hash of identity for verification (public)
 */
pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mimcsponge.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// Merkle tree verifier component
template MerkleInclusionProof(nLevels) {
    signal input leaf;
    signal input root;
    signal input pathIndices[nLevels];
    signal input pathElements[nLevels];

    signal output out;

    component hashers[nLevels];

    signal currentHash;
    currentHash <== leaf;

    for (var i = 0; i < nLevels; i++) {
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== pathIndices[i] * pathElements[i] + (1 - pathIndices[i]) * currentHash;
        hashers[i].inputs[1] <== pathIndices[i] * currentHash + (1 - pathIndices[i]) * pathElements[i];
        currentHash <== hashers[i].out;
    }

    out <== currentHash;
    out === root;
}

// Main AnonymousSender circuit
template AnonymousSender(nLevels) {
    // Private inputs
    signal input identity_nullifier;
    signal input identity_trapdoor;
    signal input merkle_path[nLevels];
    signal input merkle_path_indices[nLevels];

    // Public inputs
    signal input merkle_root;
    signal input message_hash;

    // Public outputs
    signal output nullifier;
    signal output identity_commitment;

    // Compute identity commitment: poseidon(nullifier, trapdoor)
    component poseidonCommitment = Poseidon(2);
    poseidonCommitment.inputs[0] <== identity_nullifier;
    poseidonCommitment.inputs[1] <== identity_trapdoor;
    identity_commitment <== poseidonCommitment.out;

    // Verify merkle proof that identity_commitment is in the tree
    component merkleProof = MerkleInclusionProof(nLevels);
    merkleProof.leaf <== identity_commitment;
    merkleProof.root <== merkle_root;

    for (var i = 0; i < nLevels; i++) {
        merkleProof.pathIndices[i] <== merkle_path_indices[i];
        merkleProof.pathElements[i] <== merkle_path[i];
    }

    // Compute nullifier: poseidon(identity_nullifier, merkle_root)
    // This ensures uniqueness per sender per tree
    component poseidonNullifier = Poseidon(2);
    poseidonNullifier.inputs[0] <== identity_nullifier;
    poseidonNullifier.inputs[1] <== merkle_root;
    nullifier <== poseidonNullifier.out;
}

// Alternative simpler version for smaller proof sizes
template AnonymousSenderLite(nLevels) {
    signal input identity_nullifier;
    signal input identity_trapdoor;
    signal input merkle_path[nLevels];
    signal input merkle_path_indices[nLevels];
    signal input merkle_root;
    signal input message_hash;

    signal output nullifier;

    // Compute identity commitment
    component poseidonId = Poseidon(2);
    poseidonId.inputs[0] <== identity_nullifier;
    poseidonId.inputs[1] <== identity_trapdoor;
    signal identity_commitment;
    identity_commitment <== poseidonId.out;

    // Merkle proof verification
    component hashers[nLevels];
    signal currentLevel;
    currentLevel <== identity_commitment;

    for (var i = 0; i < nLevels; i++) {
        hashers[i] = Poseidon(2);

        // Conditionally swap based on path index
        signal left;
        signal right;

        left <== merkle_path_indices[i] * merkle_path[i] + (1 - merkle_path_indices[i]) * currentLevel;
        right <== merkle_path_indices[i] * currentLevel + (1 - merkle_path_indices[i]) * merkle_path[i];

        hashers[i].inputs[0] <== left;
        hashers[i].inputs[1] <== right;
        currentLevel <== hashers[i].out;
    }

    // Assert computed root matches public root
    currentLevel === merkle_root;

    // Output nullifier
    component poseidonNull = Poseidon(2);
    poseidonNull.inputs[0] <== identity_nullifier;
    poseidonNull.inputs[1] <== merkle_root;
    nullifier <== poseidonNull.out;
}

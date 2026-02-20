/**
 * GroupMember Circuit
 *
 * CRITICAL FIX #2: ZK circuit for group membership verification
 *
 * This circuit proves that a sender is a member of a specific group
 * without revealing which member they are.
 *
 * Inputs:
 * - identity_nullifier: User's nullifier (private)
 * - identity_trapdoor: User's trapdoor (private)
 * - group_id: The group identifier (public)
 * - merkle_root: Root of the group's merkle tree (public)
 * - merkle_path: Path from leaf to root (private)
 * - merkle_path_indices: Left/right indices for path (private)
 * - message_hash: Hash of message being sent (public)
 * - epoch: Current group epoch for key rotation (public)
 *
 * Outputs:
 * - nullifier: Unique identifier per sender per group (public)
 */
pragma circom 2.1.0;

include "node_modules/circomlib/circuits/poseidon.circom";

// Tree height for group membership
constant TREE_HEIGHT = 20;

// Merkle tree checker using Poseidon
template MerkleTreeChecker(nLevels) {
    signal input leaf;
    signal input root;
    signal input pathElements[nLevels];
    signal input pathIndex[nLevels];

    component poseidon[nLevels];
    signal computedRoot;

    computedRoot <== leaf;

    for (var i = 0; i < nLevels; i++) {
        poseidon[i] = Poseidon(2);

        // pathIndex[i] == 0 means leaf is on left
        // pathIndex[i] == 1 means leaf is on right
        signal isRight;
        isRight <== pathIndex[i];

        poseidon[i].inputs[0] <== isRight * pathElements[i] + (1 - isRight) * computedRoot;
        poseidon[i].inputs[1] <== isRight * computedRoot + (1 - isRight) * pathElements[i];

        computedRoot <== poseidon[i].out;
    }

    // Verify the computed root matches the provided root
    computedRoot === root;
}

// Main GroupMember circuit
template GroupMember(nLevels) {
    // Private inputs
    signal input identity_nullifier;
    signal input identity_trapdoor;
    signal input merkle_path[nLevels];
    signal input merkle_path_indices[nLevels];

    // Public inputs
    signal input group_id;
    signal input merkle_root;
    signal input message_hash;
    signal input epoch;

    // Public outputs
    signal output nullifier;
    signal output commitment;

    // Step 1: Compute identity commitment
    // commitment = poseidon(nullifier, trapdoor)
    component idCommitment = Poseidon(2);
    idCommitment.inputs[0] <== identity_nullifier;
    idCommitment.inputs[1] <== identity_trapdoor;
    commitment <== idCommitment.out;

    // Step 2: Verify merkle proof of membership
    component merkleChecker = MerkleTreeChecker(nLevels);
    merkleChecker.leaf <== commitment;
    merkleChecker.root <== merkle_root;

    for (var i = 0; i < nLevels; i++) {
        merkleChecker.pathElements[i] <== merkle_path[i];
        merkleChecker.pathIndex[i] <== merkle_path_indices[i];
    }

    // Step 3: Compute nullifier (unique per group, per epoch)
    // nullifier = poseidon(identity_nullifier, group_id, epoch)
    component nullifierHash1 = Poseidon(2);
    component nullifierHash2 = Poseidon(2);

    nullifierHash1.inputs[0] <== identity_nullifier;
    nullifierHash1.inputs[1] <== group_id;

    nullifierHash2.inputs[0] <== nullifierHash1.out;
    nullifierHash2.inputs[1] <== epoch;

    nullifier <== nullifierHash2.out;
}

// Circuit for group admin operations (add/remove members)
template GroupAdmin(nLevels) {
    // Admin's identity
    signal input admin_nullifier;
    signal input admin_trapdoor;
    signal input admin_merkle_path[nLevels];
    signal input admin_merkle_indices[nLevels];

    // Operation details
    signal input group_id;
    signal input merkle_root;
    signal input new_merkle_root;
    signal input operation_type; // 0 = add, 1 = remove
    signal input target_commitment;

    // Public outputs
    signal output admin_nullifier_out;

    // Verify admin is in tree
    component adminCommitment = Poseidon(2);
    adminCommitment.inputs[0] <== admin_nullifier;
    adminCommitment.inputs[1] <== admin_trapdoor;
    signal commitment;
    commitment <== adminCommitment.out;

    component merkleChecker = MerkleTreeChecker(nLevels);
    merkleChecker.leaf <== commitment;
    merkleChecker.root <== merkle_root;

    for (var i = 0; i < nLevels; i++) {
        merkleChecker.pathElements[i] <== admin_merkle_path[i];
        merkleChecker.pathIndex[i] <== admin_merkle_indices[i];
    }

    // Output admin's group nullifier for verification
    component nullifierHash = Poseidon(2);
    nullifierHash.inputs[0] <== admin_nullifier;
    nullifierHash.inputs[1] <== group_id;
    admin_nullifier_out <== nullifierHash.out;
}

// Simplified group membership for smaller proofs
template GroupMemberSimple(nLevels) {
    signal input identity_nullifier;
    signal input identity_trapdoor;
    signal input merkle_path[nLevels];
    signal input merkle_path_indices[nLevels];
    signal input group_id;
    signal input merkle_root;
    signal input epoch;

    signal output nullifier;

    // Compute commitment
    component poseidon1 = Poseidon(2);
    poseidon1.inputs[0] <== identity_nullifier;
    poseidon1.inputs[1] <== identity_trapdoor;
    signal commitment;
    commitment <== poseidon1.out;

    // Merkle verification
    component poseidonLevels[nLevels];
    signal hash;
    hash <== commitment;

    for (var i = 0; i < nLevels; i++) {
        poseidonLevels[i] = Poseidon(2);

        signal idx;
        idx <== merkle_path_indices[i];

        poseidonLevels[i].inputs[0] <== idx * merkle_path[i] + (1 - idx) * hash;
        poseidonLevels[i].inputs[1] <== idx * hash + (1 - idx) * merkle_path[i];

        hash <== poseidonLevels[i].out;
    }

    hash === merkle_root;

    // Compute nullifier
    component poseidon2 = Poseidon(2);
    component poseidon3 = Poseidon(2);

    poseidon2.inputs[0] <== identity_nullifier;
    poseidon2.inputs[1] <== group_id;

    poseidon3.inputs[0] <== poseidon2.out;
    poseidon3.inputs[1] <== epoch;

    nullifier <== poseidon3.out;
}

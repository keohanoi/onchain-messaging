// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Poseidon} from "./Poseidon.sol";

/**
 * @title Merkle Tree Library
 * @notice ZK-friendly Merkle tree using Poseidon hash
 * @dev CRITICAL FIX #3: Changed from keccak256 to Poseidon for ZK compatibility
 *      This allows merkle proofs to be efficiently verified in ZK circuits
 */
library MerkleTree {
    /**
     * @notice Compute merkle root from leaf and proof using Poseidon hash
     * @param leaf The leaf node (field element)
     * @param proof Array of sibling hashes
     * @param index Position of leaf in tree (0-indexed)
     * @return The computed merkle root
     */
    function computeRoot(
        uint256 leaf,
        uint256[] memory proof,
        uint256 index
    ) internal pure returns (uint256) {
        uint256 hash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            uint256 sibling = proof[i];
            // CRITICAL FIX #3: Use Poseidon instead of keccak256
            if ((index & 1) == 1) {
                // Leaf is on the right
                hash = uint256(Poseidon.hash2(sibling, hash));
            } else {
                // Leaf is on the left
                hash = uint256(Poseidon.hash2(hash, sibling));
            }
            index >>= 1;
        }
        return hash;
    }

    /**
     * @notice Verify a merkle proof using Poseidon hash
     * @param leaf The leaf node
     * @param proof Array of sibling hashes
     * @param index Position of leaf in tree
     * @param root Expected merkle root
     * @return True if proof is valid
     */
    function verify(
        uint256 leaf,
        uint256[] memory proof,
        uint256 index,
        uint256 root
    ) internal pure returns (bool) {
        return computeRoot(leaf, proof, index) == root;
    }

    /**
     * @notice Legacy interface for bytes32 compatibility
     * @dev Converts bytes32 to uint256 for Poseidon hashing
     */
    function computeRootBytes32(
        bytes32 leaf,
        bytes32[] memory proof,
        uint256 index
    ) internal pure returns (bytes32) {
        uint256 hash = uint256(leaf);
        for (uint256 i = 0; i < proof.length; i++) {
            uint256 sibling = uint256(proof[i]);
            // CRITICAL FIX #3: Use Poseidon instead of keccak256
            if ((index & 1) == 1) {
                hash = uint256(Poseidon.hash2(sibling, hash));
            } else {
                hash = uint256(Poseidon.hash2(hash, sibling));
            }
            index >>= 1;
        }
        return bytes32(hash);
    }

    /**
     * @notice Legacy verify for bytes32
     */
    function verifyBytes32(
        bytes32 leaf,
        bytes32[] memory proof,
        uint256 index,
        bytes32 root
    ) internal pure returns (bool) {
        return computeRootBytes32(leaf, proof, index) == root;
    }
}

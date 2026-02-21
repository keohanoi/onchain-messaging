// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/**
 * @title Poseidon Hash Library
 * @notice Wrapper around poseidon-solidity for ZK-friendly hashing
 * @dev Uses poseidon-solidity npm package which provides verified constants
 *      matching circomlibjs exactly.
 */
library Poseidon {
    /**
     * @notice Poseidon hash for 2 inputs
     * @param left First field element
     * @param right Second field element
     * @return The Poseidon hash output as bytes32
     */
    function hash2(uint256 left, uint256 right) internal pure returns (bytes32) {
        return bytes32(PoseidonT3.hash([left, right]));
    }

    /**
     * @notice Legacy interface for backwards compatibility
     */
    function hash(bytes32[2] memory inputs) internal pure returns (bytes32) {
        return hash2(uint256(inputs[0]), uint256(inputs[1]));
    }

    /**
     * @notice Poseidon hash for a single input
     */
    function hashSingle(bytes32 input) internal pure returns (bytes32) {
        return hash2(uint256(input), 0);
    }

    /**
     * @notice Poseidon hash for 3 inputs
     * @dev Uses 2-input hash twice for compatibility
     */
    function hash3(bytes32[3] memory inputs) internal pure returns (bytes32) {
        bytes32 h1 = hash([inputs[0], inputs[1]]);
        return hash([h1, inputs[2]]);
    }
}

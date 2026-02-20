// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ZKVerifier.sol";

/**
 * @title MessageHub
 * @notice Central contract for posting private message commitments
 * @dev Uses 33-byte compressed ephemeral keys to preserve Y-parity
 *      MEDIUM FIX #11: Added bounds to view tag arrays to prevent DoS
 */
contract MessageHub {
    event MessagePosted(
        bytes32 indexed commitment,
        address indexed stealthRecipient,
        bytes ephemeralPubKey,        // 33 bytes compressed
        bytes1 viewTag,               // 1 byte for O(1) scanning
        bytes encryptedMetadata,
        bytes32 nullifier
    );

    event GroupMessagePosted(
        bytes32 indexed groupId,
        bytes32 indexed commitment,
        bytes encryptedMetadata,
        bytes zkProof,
        bytes32 nullifier
    );

    // MEDIUM FIX #11: Maximum messages per view tag to prevent unbounded arrays
    uint256 public constant MAX_MESSAGES_PER_VIEW_TAG = 10000;

    // Maximum batch size for batch operations
    uint256 public constant MAX_BATCH_SIZE = 100;

    // Nullifier tracking (prevents replay)
    mapping(bytes32 => bool) public usedNullifiers;

    // Message commitments (for proof of existence)
    mapping(bytes32 => uint256) public commitmentTimestamp;

    // View tag index for efficient scanning
    // Maps viewTag -> commitment indices (allows O(1) filtering)
    // MEDIUM FIX #11: Now bounded by MAX_MESSAGES_PER_VIEW_TAG
    mapping(bytes1 => uint256[]) public messagesByViewTag;

    // Track array lengths to enforce bounds
    mapping(bytes1 => uint256) public viewTagArrayLength;

    // Total message count
    uint256 public totalMessages;

    IZKVerifier public verifier;

    constructor(address verifierAddress) {
        verifier = IZKVerifier(verifierAddress);
    }

    /**
     * @notice Post a direct message commitment
     * @param stealthRecipient The derived stealth address
     * @param ephemeralPubKey 33-byte compressed ephemeral public key
     * @param viewTag 1-byte view tag for efficient recipient scanning
     * @param encryptedMetadata Encrypted message metadata
     * @param nullifier Unique nullifier to prevent replay
     */
    function postDirectMessage(
        address stealthRecipient,
        bytes calldata ephemeralPubKey,
        bytes1 viewTag,
        bytes calldata encryptedMetadata,
        bytes32 nullifier
    ) external {
        require(!usedNullifiers[nullifier], "Nullifier used");
        require(ephemeralPubKey.length == 33, "Invalid ephemeral key length");

        // MEDIUM FIX #11: Check array bounds before pushing
        require(
            viewTagArrayLength[viewTag] < MAX_MESSAGES_PER_VIEW_TAG,
            "View tag array full"
        );

        usedNullifiers[nullifier] = true;

        bytes32 commitment = keccak256(encryptedMetadata);
        commitmentTimestamp[commitment] = block.timestamp;

        // Index by view tag for efficient scanning
        uint256 msgIndex = totalMessages;
        messagesByViewTag[viewTag].push(msgIndex);
        viewTagArrayLength[viewTag]++;
        totalMessages++;

        emit MessagePosted(
            commitment,
            stealthRecipient,
            ephemeralPubKey,
            viewTag,
            encryptedMetadata,
            nullifier
        );
    }

    /**
     * @notice Post a group message with ZK proof
     */
    function postGroupMessage(
        bytes32 groupId,
        bytes calldata encryptedMetadata,
        bytes calldata zkProof,
        bytes32 nullifier,
        bytes32 merkleRoot
    ) external {
        require(!usedNullifiers[nullifier], "Nullifier used");

        require(
            verifier.verifyMembership(zkProof, merkleRoot, groupId, nullifier),
            "Invalid proof"
        );

        usedNullifiers[nullifier] = true;

        bytes32 commitment = keccak256(encryptedMetadata);
        totalMessages++;

        emit GroupMessagePosted(groupId, commitment, encryptedMetadata, zkProof, nullifier);
    }

    /**
     * @notice Batch post multiple messages (gas optimization)
     * @dev MEDIUM FIX #11: Added MAX_BATCH_SIZE limit
     */
    function postDirectMessageBatch(
        address[] calldata stealthRecipients,
        bytes[] calldata ephemeralPubKeys,
        bytes1[] calldata viewTags,
        bytes[] calldata encryptedMetadatas,
        bytes32[] calldata nullifiers
    ) external {
        require(
            stealthRecipients.length == ephemeralPubKeys.length &&
                ephemeralPubKeys.length == viewTags.length &&
                viewTags.length == encryptedMetadatas.length &&
                encryptedMetadatas.length == nullifiers.length,
            "Length mismatch"
        );

        // MEDIUM FIX #11: Limit batch size
        require(stealthRecipients.length <= MAX_BATCH_SIZE, "Batch too large");

        for (uint256 i = 0; i < stealthRecipients.length; i++) {
            require(!usedNullifiers[nullifiers[i]], "Nullifier used");
            require(ephemeralPubKeys[i].length == 33, "Invalid ephemeral key length");

            // MEDIUM FIX #11: Check array bounds
            require(
                viewTagArrayLength[viewTags[i]] < MAX_MESSAGES_PER_VIEW_TAG,
                "View tag array full"
            );

            usedNullifiers[nullifiers[i]] = true;

            bytes32 commitment = keccak256(encryptedMetadatas[i]);
            commitmentTimestamp[commitment] = block.timestamp;

            uint256 msgIndex = totalMessages;
            messagesByViewTag[viewTags[i]].push(msgIndex);
            viewTagArrayLength[viewTags[i]]++;
            totalMessages++;

            emit MessagePosted(
                commitment,
                stealthRecipients[i],
                ephemeralPubKeys[i],
                viewTags[i],
                encryptedMetadatas[i],
                nullifiers[i]
            );
        }
    }

    /**
     * @notice Get message indices for a view tag (for efficient scanning)
     * @param viewTag The view tag to query
     * @param offset Start index for pagination
     * @param limit Maximum number of results
     * @return indices Array of message indices with this view tag
     */
    function getMessagesByViewTag(
        bytes1 viewTag,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory) {
        uint256[] storage allIndices = messagesByViewTag[viewTag];
        uint256 length = allIndices.length;

        if (offset >= length) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > length) {
            end = length;
        }

        uint256 resultLength = end - offset;
        uint256[] memory result = new uint256[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            result[i] = allIndices[offset + i];
        }

        return result;
    }

    /**
     * @notice Get total count of messages for a view tag
     */
    function getViewTagCount(bytes1 viewTag) external view returns (uint256) {
        return viewTagArrayLength[viewTag];
    }

    /**
     * @notice Check if a nullifier has been used
     */
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return usedNullifiers[nullifier];
    }
}

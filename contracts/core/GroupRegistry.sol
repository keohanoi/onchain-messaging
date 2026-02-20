// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract GroupRegistry {
    using ECDSA for bytes32;

    struct Group {
        address admin;
        bytes32 merkleRoot;
        uint256 memberCount;
        bool isPublic;
        bytes encryptedGroupKey;
        uint256 epoch;
        mapping(bytes32 => uint256) memberIndex;  // identityCommitment -> index
        mapping(uint256 => bytes32) memberByIdentity;  // index -> identityCommitment
    }

    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(uint256 => bytes)) public memberEncryptedKeys;

    event GroupCreated(bytes32 indexed groupId, address admin);
    event MemberAdded(bytes32 indexed groupId, bytes32 identityCommitment, uint256 memberIndex);
    event MemberRemoved(bytes32 indexed groupId, bytes32 identityCommitment, uint256 newMemberCount);
    event GroupKeyRotated(bytes32 indexed groupId, bytes newEncryptedKey, uint256 newEpoch);
    event AdminTransferred(bytes32 indexed groupId, address previousAdmin, address newAdmin);

    modifier onlyAdmin(bytes32 groupId) {
        require(msg.sender == groups[groupId].admin, "Not admin");
        _;
    }

    modifier groupExists(bytes32 groupId) {
        require(groups[groupId].admin != address(0), "Group does not exist");
        _;
    }

    function createGroup(
        bytes32 groupId,
        bool isPublic,
        bytes calldata adminEncryptedKey
    ) external {
        require(groups[groupId].admin == address(0), "Group exists");
        Group storage group = groups[groupId];
        group.admin = msg.sender;
        group.merkleRoot = bytes32(0);
        group.memberCount = 0;
        group.isPublic = isPublic;
        group.encryptedGroupKey = adminEncryptedKey;
        group.epoch = 0;

        emit GroupCreated(groupId, msg.sender);
    }

    function addMember(
        bytes32 groupId,
        bytes32 identityCommitment,
        bytes32 newMerkleRoot,
        bytes calldata encryptedKeyForMember
    ) external groupExists(groupId) onlyAdmin(groupId) {
        Group storage group = groups[groupId];

        // Check member doesn't already exist
        require(group.memberIndex[identityCommitment] == 0 || group.memberByIdentity[0] == identityCommitment,
            "Member already exists");
        // Handle edge case where memberIndex would be 0 (reserved for checking existence)
        if (group.memberCount == 0) {
            require(group.memberIndex[identityCommitment] == 0, "Member already exists");
        } else if (group.memberIndex[identityCommitment] != 0) {
            // Verify it's not a false positive from index 0
            uint256 existingIndex = group.memberIndex[identityCommitment];
            if (existingIndex <= group.memberCount && group.memberByIdentity[existingIndex] == identityCommitment) {
                revert("Member already exists");
            }
        }

        uint256 index = group.memberCount + 1;  // 1-indexed to allow 0 as "not found"
        group.memberIndex[identityCommitment] = index;
        group.memberByIdentity[index] = identityCommitment;
        group.merkleRoot = newMerkleRoot;
        group.memberCount++;

        memberEncryptedKeys[groupId][index] = encryptedKeyForMember;
        emit MemberAdded(groupId, identityCommitment, index);
    }

    /**
     * @notice Remove a member from the group
     * @dev MEDIUM FIX #5: Added member removal functionality
     * @param groupId The group identifier
     * @param identityCommitment The member's identity commitment to remove
     * @param newMerkleRoot The new merkle root after removal
     * @param newEncryptedGroupKey New group key (should be rotated on member removal)
     */
    function removeMember(
        bytes32 groupId,
        bytes32 identityCommitment,
        bytes32 newMerkleRoot,
        bytes calldata newEncryptedGroupKey
    ) external groupExists(groupId) onlyAdmin(groupId) {
        Group storage group = groups[groupId];

        uint256 index = group.memberIndex[identityCommitment];
        require(index > 0 && index <= group.memberCount, "Member not found");
        require(group.memberByIdentity[index] == identityCommitment, "Member not found");

        // Swap with last member if not already last
        if (index < group.memberCount) {
            bytes32 lastMember = group.memberByIdentity[group.memberCount];
            group.memberByIdentity[index] = lastMember;
            group.memberIndex[lastMember] = index;
            memberEncryptedKeys[groupId][index] = memberEncryptedKeys[groupId][group.memberCount];
        }

        // Clear the removed member's data
        delete group.memberIndex[identityCommitment];
        delete group.memberByIdentity[group.memberCount];
        delete memberEncryptedKeys[groupId][group.memberCount];

        group.memberCount--;
        group.merkleRoot = newMerkleRoot;

        // Rotate group key on member removal for forward secrecy
        group.encryptedGroupKey = newEncryptedGroupKey;
        group.epoch++;

        emit MemberRemoved(groupId, identityCommitment, group.memberCount);
        emit GroupKeyRotated(groupId, newEncryptedGroupKey, group.epoch);
    }

    function rotateGroupKey(
        bytes32 groupId,
        bytes calldata newEncryptedGroupKey
    ) external groupExists(groupId) onlyAdmin(groupId) {
        Group storage group = groups[groupId];

        group.encryptedGroupKey = newEncryptedGroupKey;
        group.epoch++;
        emit GroupKeyRotated(groupId, newEncryptedGroupKey, group.epoch);
    }

    /**
     * @notice Transfer admin ownership to a new address
     * @dev MEDIUM FIX #4: Added admin transfer mechanism
     * @param groupId The group identifier
     * @param newAdmin The address of the new admin
     * @param signature Signature from newAdmin accepting the transfer
     */
    function transferAdmin(
        bytes32 groupId,
        address newAdmin,
        bytes calldata signature
    ) external groupExists(groupId) onlyAdmin(groupId) {
        require(newAdmin != address(0), "Invalid new admin");
        require(newAdmin != msg.sender, "Already admin");

        // Verify newAdmin has signed to accept the transfer
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(groupId, msg.sender, newAdmin))
        );
        address signer = ECDSA.recover(digest, signature);
        require(signer == newAdmin, "Invalid acceptance signature");

        address previousAdmin = groups[groupId].admin;
        groups[groupId].admin = newAdmin;

        emit AdminTransferred(groupId, previousAdmin, newAdmin);
    }

    /**
     * @notice Check if an identity commitment is a member of the group
     */
    function isMember(bytes32 groupId, bytes32 identityCommitment) external view returns (bool) {
        Group storage group = groups[groupId];
        uint256 index = group.memberIndex[identityCommitment];
        return index > 0 && index <= group.memberCount && group.memberByIdentity[index] == identityCommitment;
    }

    /**
     * @notice Get member identity commitment by index
     */
    function getMemberByIndex(bytes32 groupId, uint256 index) external view returns (bytes32) {
        return groups[groupId].memberByIdentity[index];
    }

    /**
     * @notice Get group info
     */
    function getGroupInfo(bytes32 groupId) external view returns (
        address admin,
        bytes32 merkleRoot,
        uint256 memberCount,
        bool isPublic,
        uint256 epoch
    ) {
        Group storage group = groups[groupId];
        return (group.admin, group.merkleRoot, group.memberCount, group.isPublic, group.epoch);
    }
}

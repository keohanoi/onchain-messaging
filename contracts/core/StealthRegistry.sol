// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title StealthRegistry
 * @notice Registry for user key bundles including X3DH keys and stealth meta-address
 * @dev Supports key registration, one-time prekey consumption, and key rotation
 */
contract StealthRegistry {
    using ECDSA for bytes32;

    struct KeyBundle {
        bytes identityKey;
        bytes signedPreKey;
        bytes signedPreKeySignature;
        string oneTimePreKeyBundleCid;
        bytes stealthSpendingPubKey;
        bytes stealthViewingPubKey;
        bytes pqPublicKey;
        uint64 updatedAt;
        uint256 oneTimePreKeyCount;     // Total one-time prekeys available
        uint256 oneTimePreKeyConsumed;  // Number consumed
    }

    struct KeyBundleInput {
        bytes identityKey;
        bytes signedPreKey;
        bytes signedPreKeySignature;
        string oneTimePreKeyBundleCid;
        bytes stealthSpendingPubKey;
        bytes stealthViewingPubKey;
        bytes pqPublicKey;
        uint256 oneTimePreKeyCount;
    }

    mapping(address => KeyBundle) private keyBundles;

    // Track consumed one-time prekeys per user
    mapping(address => mapping(uint256 => bool)) public consumedOneTimePreKeys;

    // Minimum time between key updates (to prevent abuse)
    uint256 public constant MIN_UPDATE_INTERVAL = 1 hours;

    event KeyBundleRegistered(
        address indexed owner,
        bytes32 bundleHash,
        string oneTimePreKeyBundleCid
    );
    event KeyBundleRevoked(address indexed owner);
    event SignedPreKeyRotated(
        address indexed owner,
        bytes newSignedPreKey,
        uint64 timestamp
    );
    event OneTimePreKeyConsumed(
        address indexed owner,
        uint256 preKeyIndex,
        uint256 remaining
    );
    event OneTimePreKeysRefilled(
        address indexed owner,
        uint256 newCount,
        string newBundleCid
    );

    /**
     * @notice Compute bundle hash - uses memory to reduce stack depth
     */
    function _computeBundleHash(
        address sender,
        KeyBundleInput calldata bundle
    ) internal pure returns (bytes32) {
        // Use memory array to avoid stack too deep
        bytes memory encoded = abi.encode(
            sender,
            bundle.identityKey,
            bundle.signedPreKey,
            bundle.signedPreKeySignature
        );
        bytes memory encoded2 = abi.encode(
            bundle.oneTimePreKeyBundleCid,
            bundle.stealthSpendingPubKey,
            bundle.stealthViewingPubKey,
            bundle.pqPublicKey,
            bundle.oneTimePreKeyCount
        );
        return keccak256(abi.encodePacked(encoded, encoded2));
    }

    /**
     * @notice Store key bundle - extracted to reduce stack depth
     */
    function _storeKeyBundle(
        address owner,
        KeyBundleInput calldata bundle
    ) internal {
        keyBundles[owner] = KeyBundle({
            identityKey: bundle.identityKey,
            signedPreKey: bundle.signedPreKey,
            signedPreKeySignature: bundle.signedPreKeySignature,
            oneTimePreKeyBundleCid: bundle.oneTimePreKeyBundleCid,
            stealthSpendingPubKey: bundle.stealthSpendingPubKey,
            stealthViewingPubKey: bundle.stealthViewingPubKey,
            pqPublicKey: bundle.pqPublicKey,
            updatedAt: uint64(block.timestamp),
            oneTimePreKeyCount: bundle.oneTimePreKeyCount,
            oneTimePreKeyConsumed: 0
        });
    }

    /**
     * @notice Register a new key bundle
     * @param bundle The key bundle to register
     * @param ethSignature EIP-191 signature over the bundle hash
     */
    function registerKeyBundle(
        KeyBundleInput calldata bundle,
        bytes calldata ethSignature
    ) external {
        bytes32 bundleHash = _computeBundleHash(msg.sender, bundle);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bundleHash);
        address recovered = ECDSA.recover(digest, ethSignature);
        require(recovered == msg.sender, "Invalid signature");

        _storeKeyBundle(msg.sender, bundle);

        emit KeyBundleRegistered(msg.sender, bundleHash, bundle.oneTimePreKeyBundleCid);
    }

    /**
     * @notice Rotate signed prekey (should be done periodically)
     * @param newSignedPreKey New signed prekey
     * @param newSignature Signature over new prekey
     */
    function rotateSignedPreKey(
        bytes calldata newSignedPreKey,
        bytes calldata newSignature
    ) external {
        KeyBundle storage bundle = keyBundles[msg.sender];
        require(bundle.identityKey.length > 0, "No key bundle registered");

        // Rate limiting
        require(
            block.timestamp >= bundle.updatedAt + MIN_UPDATE_INTERVAL,
            "Update too frequent"
        );

        // Verify signature over new prekey
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(newSignedPreKey)
        );
        address recovered = ECDSA.recover(digest, newSignature);
        require(recovered == msg.sender, "Invalid signature");

        bundle.signedPreKey = newSignedPreKey;
        bundle.signedPreKeySignature = newSignature;
        bundle.updatedAt = uint64(block.timestamp);

        emit SignedPreKeyRotated(msg.sender, newSignedPreKey, bundle.updatedAt);
    }

    /**
     * @notice Consume a one-time prekey for X3DH
     * @dev HIGH FIX #1: Added signature verification to prevent unauthorized consumption
     * @param owner Address of the key bundle owner
     * @param preKeyIndex Index of the one-time prekey to consume
     * @param senderSignature Signature from owner authorizing this sender to consume the prekey
     * @return True if the prekey was available and consumed
     */
    function consumeOneTimePreKey(
        address owner,
        uint256 preKeyIndex,
        bytes calldata senderSignature
    ) external returns (bool) {
        KeyBundle storage bundle = keyBundles[owner];
        require(bundle.identityKey.length > 0, "No key bundle registered");
        require(preKeyIndex < bundle.oneTimePreKeyCount, "Invalid prekey index");
        require(!consumedOneTimePreKeys[owner][preKeyIndex], "Prekey already consumed");

        // HIGH FIX #1: Verify signature from owner authorizing this specific sender
        // The owner must sign: keccak256(abi.encode(sender, preKeyIndex, nonce))
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(msg.sender, preKeyIndex, bundle.oneTimePreKeyConsumed))
        );
        address signer = ECDSA.recover(digest, senderSignature);
        require(signer == owner, "Unauthorized: invalid signature");

        consumedOneTimePreKeys[owner][preKeyIndex] = true;
        bundle.oneTimePreKeyConsumed++;

        uint256 remaining = bundle.oneTimePreKeyCount - bundle.oneTimePreKeyConsumed;

        emit OneTimePreKeyConsumed(owner, preKeyIndex, remaining);

        return true;
    }

    /**
     * @notice Consume own one-time prekey (owner only, no signature needed)
     * @param preKeyIndex Index of the one-time prekey to consume
     */
    function consumeOwnOneTimePreKey(uint256 preKeyIndex) external returns (bool) {
        KeyBundle storage bundle = keyBundles[msg.sender];
        require(bundle.identityKey.length > 0, "No key bundle registered");
        require(preKeyIndex < bundle.oneTimePreKeyCount, "Invalid prekey index");
        require(!consumedOneTimePreKeys[msg.sender][preKeyIndex], "Prekey already consumed");

        consumedOneTimePreKeys[msg.sender][preKeyIndex] = true;
        bundle.oneTimePreKeyConsumed++;

        uint256 remaining = bundle.oneTimePreKeyCount - bundle.oneTimePreKeyConsumed;

        emit OneTimePreKeyConsumed(msg.sender, preKeyIndex, remaining);

        return true;
    }

    /**
     * @notice Refill one-time prekeys (generate new batch)
     * @param newBundleCid IPFS CID of new encrypted one-time prekey bundle
     * @param newCount New total count of one-time prekeys
     */
    function refillOneTimePreKeys(
        string calldata newBundleCid,
        uint256 newCount
    ) external {
        KeyBundle storage bundle = keyBundles[msg.sender];
        require(bundle.identityKey.length > 0, "No key bundle registered");

        // Reset consumed count when refilling
        bundle.oneTimePreKeyBundleCid = newBundleCid;
        bundle.oneTimePreKeyCount = newCount;
        bundle.oneTimePreKeyConsumed = 0;

        // Clear consumed mapping (note: old entries remain but are irrelevant)
        // In production, consider using a bitmap or epoch-based system

        emit OneTimePreKeysRefilled(msg.sender, newCount, newBundleCid);
    }

    /**
     * @notice Revoke the sender's key bundle
     */
    function revokeKeyBundle() external {
        delete keyBundles[msg.sender];
        emit KeyBundleRevoked(msg.sender);
    }

    /**
     * @notice Get the key bundle for an address
     */
    function getKeyBundle(address owner) external view returns (KeyBundle memory) {
        return keyBundles[owner];
    }

    /**
     * @notice Get remaining one-time prekeys
     */
    function getRemainingOneTimePreKeys(address owner) external view returns (uint256) {
        KeyBundle storage bundle = keyBundles[owner];
        if (bundle.oneTimePreKeyCount == 0) return 0;
        return bundle.oneTimePreKeyCount - bundle.oneTimePreKeyConsumed;
    }

    /**
     * @notice Check if a specific one-time prekey is available
     */
    function isOneTimePreKeyAvailable(
        address owner,
        uint256 preKeyIndex
    ) external view returns (bool) {
        KeyBundle storage bundle = keyBundles[owner];
        if (preKeyIndex >= bundle.oneTimePreKeyCount) return false;
        return !consumedOneTimePreKeys[owner][preKeyIndex];
    }

    /**
     * @notice Check if address has a valid key bundle
     */
    function hasKeyBundle(address owner) external view returns (bool) {
        return keyBundles[owner].identityKey.length > 0;
    }
}

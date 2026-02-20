// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC5564Announcer {
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        uint256 ephemeralPubKey,
        bytes metadata
    );
}

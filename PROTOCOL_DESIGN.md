# Private Onchain Messaging Protocol (POMP)

A privacy-preserving, decentralized messaging protocol for Ethereum/EVM L2s with full metadata protection.

## 1. Executive Summary

| Aspect | Decision |
|--------|----------|
| Target | Ethereum L2s (Base, Arbitrum, Optimism, Polygon) |
| Privacy | Full metadata privacy via ZK proofs + stealth addresses |
| Storage | Hybrid (encrypted content on IPFS/Arweave, commitment onchain) |
| Features | DMs, group chats, attachments |

## 2. Threat Model

### Protected Against
- **Network observers** - Cannot see who communicates with whom
- **Blockchain analysts** - Cannot link messages to identities
- **Storage providers** - Cannot read message content
- **Compromised nodes** - Forward secrecy limits damage

### Assumptions
- Users control their private keys
- Recipient devices not compromised at time of decryption
- L2 sequencers are live (liveness, not privacy)

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  DM Chat │  │  Groups  │  │  Files   │  │  Key Management  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ENCRYPTION LAYER                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Hybrid Signal Protocol (X3DH + Double Ratchet + PQXDH)  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ Stealth Addrs  │  │ ZK Membership   │  │ Group Key       │   │
│  │ (ERC-5564)     │  │ Proofs          │  │ Rotation        │   │
│  └────────────────┘  └─────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       STORAGE LAYER                              │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │  IPFS/W3IPFS         │    │  Arweave (permanent)         │   │
│  │  - Message content   │    │  - Critical records          │   │
│  │  - Attachments       │    │  - Group state               │   │
│  └──────────────────────┘    └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BLOCKCHAIN LAYER (L2)                        │
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ Message        │  │ Stealth Meta-   │  │ Group           │   │
│  │ Commitments    │  │ Address Registry│  │ Registry        │   │
│  └────────────────┘  └─────────────────┘  └─────────────────┘   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ZK Verifier Contract (groth16/Plonky2)                    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Core Components

### 4.1 Identity & Key Management

```
User Identity Structure:
├── Primary Identity
│   ├── Ethereum Address (public, for payments)
│   └── Stealth Meta-Address (ERC-5564 compatible)
│       ├── Spending Key (S_pub, S_priv) - for claiming messages
│       └── Viewing Key (V_pub, V_priv) - for scanning messages
│
├── Messaging Keys
│   ├── Identity Key (IK) - long-term, signed by eth key
│   ├── Signed Pre-Key (SPK) - medium-term, rotated weekly
│   └── One-Time Pre-Keys (OPK) - single use, batch generated
│
└── Optional: ZK Identity Commitment
    └── For anonymous group membership proofs
```

**Key Registration Flow:**
```
1. Generate key bundle: {IK, SPK, OPKs[], S_pub, V_pub}
2. Sign bundle with Ethereum private key
3. Register on StealthRegistry contract (ERC-6538 style)
4. Upload encrypted pre-key bundle to IPFS
```

### 4.2 Stealth Address Protocol

Based on ERC-5564 with modifications for messaging:

```solidity
// Simplified stealth address derivation
function deriveStealthAddress(
    address recipient,
    uint256 ephemeralPubKey
) returns (address stealthAddr, bytes memory encryptedViewingKey) {
    // ECDH: shared = eph_priv * recipient_viewing_pub
    // stealth_addr = hash(shared) * G + recipient_spending_pub
    // encrypt(viewing_key, shared_secret)
}
```

**Message Annoucement Event (onchain):**
```solidity
event MessageAnnouncement(
    uint256 schemeId,           // 1 = secp256k1
    address stealthAddress,     // Recipient's stealth address
    uint256 ephemeralPubKey,    // For ECDH derivation
    bytes encryptedMetadata,    // Encrypted {sender, timestamp, contentHash}
    bytes32 nullifier           // Prevents double-processing
);
```

### 4.3 Encryption Protocol

Adapted Signal Protocol with post-quantum prep:

```
┌─────────────────────────────────────────────────────────────┐
│                    KEY EXCHANGE (X3DH + PQXDH)              │
│                                                             │
│  Alice (sender)              Bob (recipient)                │
│  ───────────────             ────────────────               │
│  Fetches: IK_B, SPK_B, OPK_B                                │
│                                                             │
│  DH1 = DH(IK_A, IK_B)                                       │
│  DH2 = DH(IK_A, SPK_B)                                      │
│  DH3 = DH(EK_A, IK_B)      ← EK_A is ephemeral             │
│  DH4 = DH(EK_A, SPK_B)                                      │
│  DH5 = DH(IK_A, OPK_B)     ← optional one-time             │
│                                                             │
│  SK = KDF(DH1 || DH2 || DH3 || DH4 || DH5)                  │
│                                                             │
│  + Post-quantum: Include Kyber768 ciphertext                │
│    PQ_SK = encapsulate(pq_pk_b)                             │
│    final_SK = KDF(SK || PQ_SK)                              │
└─────────────────────────────────────────────────────────────┘
```

**Double Ratchet for Ongoing Messages:**
```
Message Chain:
├── Sending Chain: Each message advances chain key
├── Receiving Chain: Decrypt with expected chain key
└── DH Ratchet: On reply, new DH exchange, reset chains

Per-Message Keys:
├── Message Key (AES-256-GCM for content)
├── Header Key (encrypts metadata)
└── Next Chain Key (KDF derived)
```

### 4.4 ZK Privacy Layer

**Anonymous Sender Proofs:**

For full metadata privacy, sender proves they're authorized without revealing identity:

```circom
// Anonymous sender proof circuit
template AnonymousSender() {
    signal input identity_commitment;  // User's commitment
    signal input merkle_root;          // Current identity tree root
    signal input merkle_path[20];      // Merkle proof
    signal input message_hash;         // What they're sending

    signal output nullifier;           // Unique but unlinkable

    // Verify membership in registered users
    component merkle = MerkleTreeVerifier(20);
    merkle.leaf <== identity_commitment;
    merkle.root <== merkle_root;
    // ... path verification

    // Nullifier prevents linking messages
    nullifier <== poseidon(identity_commitment, message_hash);
}
```

**Group Membership Proofs:**
```circom
template GroupMember() {
    signal input identity_commitment;
    signal input group_id;
    signal input merkle_root;
    signal input merkle_path[];

    // Prove: "I am in group X" without revealing which member
    // Output: nullifier (unique per group+sender)
}
```

### 4.5 Hybrid Storage Protocol

```
┌────────────────────────────────────────────────────────────┐
│                  MESSAGE STORAGE FLOW                       │
│                                                            │
│  1. ENCRYPT                                                 │
│     content_bytes → encrypt(message_key) → ciphertext      │
│                                                            │
│  2. UPLOAD                                                  │
│     ciphertext → IPFS add → CID                            │
│     (or Arweave for permanent storage)                     │
│                                                            │
│  3. COMPUTE COMMITMENT                                      │
│     commitment = poseidon(CID, message_key_hash, nonce)    │
│                                                            │
│  4. PUBLISH ONCHAIN                                        │
│     emit MessageAnnouncement(stealth_addr, eph_pub,        │
│                              encrypted_metadata, nullifier)│
│                                                            │
│  5. OFFCHAIN NOTIFICATION (optional)                       │
│     Push to recipient via Waku/p2p for faster delivery     │
└────────────────────────────────────────────────────────────┘
```

**Encrypted Metadata Structure:**
```typescript
interface EncryptedMetadata {
  version: 1;
  sender_stealth: address;      // Sender's stealth address for this message
  recipient_stealth: address;   // Derived stealth for recipient
  contentCID: string;           // IPFS/Arweave CID
  contentKey: bytes;            // Encrypted content decryption key
  timestamp: uint64;            // Unix timestamp
  messageType: enum { DM, GROUP, ATTACHMENT };
  groupId?: bytes32;            // If group message
  replyTo?: bytes32;            // If replying to message
  signature: bytes;             // Sender's signature over hash
}
```

## 5. Smart Contract Architecture

### 5.1 Core Contracts

```
contracts/
├── core/
│   ├── StealthRegistry.sol      # ERC-6538 style meta-address registry
│   ├── MessageHub.sol           # Message announcement contract
│   ├── GroupRegistry.sol        # Group membership management
│   └── ZKVerifier.sol           # Verify ZK proofs
│
├── primitives/
│   ├── MerkleTree.sol           # Identity tree
│   ├── Poseidon.sol             # ZK-friendly hash
│   └── ERC-5564Adapter.sol      # Stealth address interface
│
└── governance/
    └── ProtocolDAO.sol          # Upgrade management
```

### 5.2 MessageHub Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MessageHub {
    // Events
    event MessagePosted(
        bytes32 indexed commitment,
        address indexed stealthRecipient,
        uint256 ephemeralPubKey,
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

    // Nullifier tracking (prevents replay)
    mapping(bytes32 => bool) public usedNullifiers;

    // Message commitments (for proof of existence)
    mapping(bytes32 => uint256) public commitmentTimestamp;

    // Post direct message
    function postDirectMessage(
        address stealthRecipient,
        uint256 ephemeralPubKey,
        bytes calldata encryptedMetadata,
        bytes32 nullifier
    ) external {
        require(!usedNullifiers[nullifier], "Nullifier used");
        usedNullifiers[nullifier] = true;

        bytes32 commitment = keccak256(encryptedMetadata);
        commitmentTimestamp[commitment] = block.timestamp;

        emit MessagePosted(
            commitment,
            stealthRecipient,
            ephemeralPubKey,
            encryptedMetadata,
            nullifier
        );
    }

    // Post group message with ZK proof
    function postGroupMessage(
        bytes32 groupId,
        bytes calldata encryptedMetadata,
        bytes calldata zkProof,
        bytes32 nullifier,
        bytes32 merkleRoot
    ) external {
        require(!usedNullifiers[nullifier], "Nullifier used");

        // Verify ZK proof of group membership
        require(
            ZKVerifier.verifyMembership(zkProof, merkleRoot, groupId, nullifier),
            "Invalid proof"
        );

        usedNullifiers[nullifier] = true;

        bytes32 commitment = keccak256(encryptedMetadata);
        emit GroupMessagePosted(groupId, commitment, encryptedMetadata, zkProof, nullifier);
    }
}
```

### 5.3 GroupRegistry Contract

```solidity
contract GroupRegistry {
    struct Group {
        address admin;
        bytes32 merkleRoot;
        uint256 memberCount;
        bool isPublic;
        bytes encryptedGroupKey; // Encrypted with admin key, re-encrypted for members
    }

    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(uint256 => bytes)) public memberEncryptedKeys;

    event GroupCreated(bytes32 indexed groupId, address admin);
    event MemberAdded(bytes32 indexed groupId, bytes32 identityCommitment);
    event GroupKeyRotated(bytes32 indexed groupId, bytes newEncryptedKey);

    function createGroup(
        bytes32 groupId,
        bool isPublic,
        bytes calldata adminEncryptedKey
    ) external {
        require(groups[groupId].admin == address(0), "Group exists");
        groups[groupId] = Group({
            admin: msg.sender,
            merkleRoot: bytes32(0),
            memberCount: 0,
            isPublic: isPublic,
            encryptedGroupKey: adminEncryptedKey
        });
        emit GroupCreated(groupId, msg.sender);
    }

    function addMember(
        bytes32 groupId,
        bytes32 identityCommitment,
        bytes calldata newMerkleRoot,
        bytes calldata zkProof,
        bytes calldata encryptedKeyForMember
    ) external {
        Group storage group = groups[groupId];
        require(msg.sender == group.admin, "Not admin");
        // Verify merkle root update
        // Store encrypted key for member index
        group.merkleRoot = newMerkleRoot;
        group.memberCount++;
        emit MemberAdded(groupId, identityCommitment);
    }
}
```

## 6. Client Implementation

### 6.1 Message Sending Flow

```typescript
async function sendMessage(
  recipient: string,
  content: string,
  type: 'dm' | 'group'
): Promise<TxHash> {

  // 1. Fetch recipient's key bundle
  const keyBundle = await registry.getKeyBundle(recipient);

  // 2. Derive stealth address
  const { stealthAddr, ephPrivKey, sharedSecret } =
    await deriveStealthAddress(keyBundle.viewingPubKey);

  // 3. X3DH key exchange
  const sessionKey = await performX3DH(myKeys, keyBundle);

  // 4. Initialize/continue double ratchet
  const ratchetState = await loadRatchetState(recipient);
  const { messageKey, newState } = await ratchetEncrypt(ratchetState);

  // 5. Encrypt content
  const ciphertext = await aesGcmEncrypt(content, messageKey);

  // 6. Upload to IPFS
  const cid = await ipfs.add(ciphertext);

  // 7. Build metadata
  const metadata = {
    sender_stealth: deriveMyStealth(ephPrivKey),
    recipient_stealth: stealthAddr,
    contentCID: cid,
    contentKey: encryptForRecipient(messageKey, sharedSecret),
    timestamp: Date.now(),
    messageType: type
  };

  // 8. Encrypt metadata
  const encryptedMetadata = await encryptMetadata(metadata, sharedSecret);

  // 9. Generate nullifier
  const nullifier = poseidon([myIdentityCommitment, cid]);

  // 10. Post to chain
  const tx = await messageHub.postDirectMessage(
    stealthAddr,
    ephPrivKey.publicKey,
    encryptedMetadata,
    nullifier
  );

  return tx.hash;
}
```

### 6.2 Message Receiving Flow

```typescript
async function scanForMessages(): Promise<Message[]> {
  const messages: Message[] = [];

  // 1. Get my viewing key pair
  const { viewingPriv, spendingPriv } = await getMyStealthKeys();

  // 2. Scan recent MessagePosted events
  const events = await messageHub.queryFilter(
    messageHub.filters.MessagePosted()
  );

  for (const event of events) {
    // 3. Try to derive matching stealth address
    const derived = deriveStealthFromEphemeral(
      event.ephemeralPubKey,
      viewingPriv
    );

    if (derived.stealthAddr === event.stealthRecipient) {
      // 4. This message is for me!
      const sharedSecret = derived.sharedSecret;

      // 5. Decrypt metadata
      const metadata = await decryptMetadata(
        event.encryptedMetadata,
        sharedSecret
      );

      // 6. Fetch from IPFS
      const ciphertext = await ipfs.cat(metadata.contentCID);

      // 7. Decrypt content using ratchet
      const ratchetState = await loadRatchetState(metadata.sender_stealth);
      const content = await ratchetDecrypt(ratchetState, ciphertext);

      messages.push({
        from: metadata.sender_stealth,
        content,
        timestamp: metadata.timestamp
      });
    }
  }

  return messages;
}
```

## 7. Group Chat Protocol

### 7.1 Group Key Management

```
Group State:
├── group_id: bytes32
├── admin: address
├── merkle_root: bytes32 (identity tree)
├── member_count: uint256
├── current_epoch: uint256 (increments on key rotation)
└── group_key_tree: Tree of encrypted keys

Key Distribution:
1. Group key K_g encrypted per-member with their viewing key
2. On member add/remove: rotate K_g, re-encrypt for remaining members
3. Member fetches their encrypted slice, decrypts with viewing key

Tree Structure for Efficient Updates:
                    [root]
                   /      \
              [0]          [1]
             /   \        /   \
          Alice  Bob   Carol  Dave

Each leaf: encrypt(K_g, member_viewing_key)
Internal nodes: cached for efficient updates
```

### 7.2 Group Message Flow

```typescript
async function sendGroupMessage(
  groupId: bytes32,
  content: string
): Promise<TxHash> {

  // 1. Get current group key
  const groupKey = await getGroupKey(groupId);

  // 2. Encrypt content with group key
  const ciphertext = await aesGcmEncrypt(content, groupKey);

  // 3. Upload to IPFS
  const cid = await ipfs.add(ciphertext);

  // 4. Generate ZK membership proof
  const { proof, publicSignals } = await generateMembershipProof(
    myIdentityCommitment,
    groupId,
    groupMerkleRoot
  );

  // 5. Build encrypted metadata (key encrypted with group key)
  const metadata = {
    contentCID: cid,
    contentKeyHash: sha256(groupKey),
    timestamp: Date.now(),
    epoch: currentEpoch
  };
  const encryptedMetadata = await encryptWithGroupKey(metadata, groupKey);

  // 6. Post with ZK proof
  const tx = await messageHub.postGroupMessage(
    groupId,
    encryptedMetadata,
    proof,
    publicSignals.nullifier,
    groupMerkleRoot
  );

  return tx.hash;
}
```

## 8. Attachment Protocol

```
Attachment Flow:
1. Encrypt file: ciphertext = aes256_gcm(file, random_key)
2. Upload to IPFS: cid = ipfs.add(ciphertext)
3. Generate thumbnail (client-side, encrypted)
4. Create attachment manifest:
   {
     cid: "Qm...",
     thumbnail_cid: "Qm...",
     key: encrypt(random_key, message_key),
     filename: "original.pdf",
     size: 1024000,
     mime_type: "application/pdf",
     hash: sha256(file)
   }
5. Include manifest in message metadata
6. Recipient decrypts manifest → fetches → decrypts
```

## 9. Gas Optimization

### 9.1 Batch Message Posting

```solidity
function postDirectMessageBatch(
    address[] calldata stealthRecipients,
    uint256[] calldata ephemeralPubKeys,
    bytes[] calldata encryptedMetadatas,
    bytes32[] calldata nullifiers
) external {
    require(
        stealthRecipients.length == ephemeralPubKeys.length &&
        ephemeralPubKeys.length == encryptedMetadatas.length &&
        encryptedMetadatas.length == nullifiers.length,
        "Length mismatch"
    );

    for (uint256 i = 0; i < stealthRecipients.length; i++) {
        require(!usedNullifiers[nullifiers[i]], "Nullifier used");
        usedNullifiers[nullifiers[i]] = true;

        emit MessagePosted(
            keccak256(encryptedMetadatas[i]),
            stealthRecipients[i],
            ephemeralPubKeys[i],
            encryptedMetadatas[i],
            nullifiers[i]
        );
    }
}
```

### 9.2 Estimated Costs (L2)

| Operation | Gas | Cost @ 0.001 gwei |
|-----------|-----|-------------------|
| Single message | ~45k | ~$0.01 |
| Batch message (10) | ~150k | ~$0.03 |
| Group message + ZK | ~120k | ~$0.02 |
| Key registration | ~60k | ~$0.01 |

## 10. Security Considerations

### 10.1 Forward Secrecy
- Double ratchet ensures past messages safe if keys compromised
- Each message uses unique key derived from chain

### 10.2 Post-Compromise Security
- DH ratchet provides healing after compromise
- Regular key rotation recommended

### 10.3 Deniability
- X3DH provides cryptographic deniability
- No non-repudiable signatures on message content

### 10.4 Known Limitations
- Timing analysis may reveal communication patterns
- IPFS gateway can see access patterns (use light client)
- L2 sequencer can see transaction ordering (but not content)

## 11. Future Enhancements

| Feature | Priority | Notes |
|---------|----------|-------|
| Post-quantum (ML-KEM) | High | PQXDH integration |
| Waku integration | Medium | P2P notification layer |
| Threaded conversations | Medium | Message references |
| Read receipts | Low | Privacy tradeoff |
| Encrypted push | Medium | Mobile notifications |

## 12. References

- [ERC-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [ERC-6538: Stealth Meta-Address Registry](https://eips.ethereum.org/EIPS/eip-6538)
- [Signal Protocol Specification](https://signal.org/docs/)
- [Session Protocol](https://getsession.org/introducing-the-session-protocol)
- [ZK Email](https://docs.zk.email/)
- [Vitalik: Using ZK-SNARKs for Privacy](https://vitalik.eth.limo/general/2022/06/15/using_snarks.html)

## 13. Implementation Roadmap

### Phase 1: Core Infrastructure
- [ ] StealthRegistry contract
- [ ] MessageHub contract
- [ ] Basic key management
- [ ] IPFS integration

### Phase 2: Encryption Layer
- [ ] X3DH implementation
- [ ] Double ratchet
- [ ] Stealth address derivation

### Phase 3: Privacy Layer
- [ ] ZK circuit for membership proofs
- [ ] ZKVerifier contract
- [ ] Group key management

### Phase 4: Full Features
- [ ] Group chats
- [ ] Attachments
- [ ] Mobile SDK

### Phase 5: Production
- [ ] Security audit
- [ ] Gas optimization
- [ ] Mainnet deployment

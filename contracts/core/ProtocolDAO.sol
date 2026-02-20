// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title ProtocolDAO
 * @notice Governance contract for the Private Onchain Messaging Protocol
 * @dev MEDIUM FIX #12: Implements decentralized governance for protocol upgrades
 *
 * Features:
 * - Timelocked proposals for security-sensitive changes
 * - Multi-signature requirements for critical operations
 * - Voting mechanism for protocol parameter changes
 * - Emergency pause functionality
 */
contract ProtocolDAO is Ownable {
    using ECDSA for bytes32;

    // ============ Structs ============

    struct Proposal {
        uint256 id;
        string description;
        address target;
        bytes callData;
        uint256 value;
        uint256 voteStart;
        uint256 voteEnd;
        uint256 forVotes;
        uint256 againstVotes;
        ProposalState state;
        address proposer;
        bytes32 proposalHash;
    }

    struct TimelockedOperation {
        bytes32 id;
        address target;
        bytes callData;
        uint256 value;
        uint256 readyTime;
        bool executed;
    }

    // ============ Enums ============

    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    // ============ State Variables ============

    // Voting parameters
    uint256 public votingDelay = 1 days;         // Delay before voting starts
    uint256 public votingPeriod = 7 days;        // Duration of voting
    uint256 public proposalThreshold = 100;      // Minimum tokens to propose
    uint256 public quorumNumerator = 4;          // Quorum = 4% of total supply
    uint256 public timelockDelay = 2 days;       // Delay before execution

    // Proposal tracking
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(address => bool)) public votedFor;

    // Timelocked operations
    mapping(bytes32 => TimelockedOperation) public timelockedOperations;

    // Protocol contracts managed by this DAO
    mapping(bytes32 => address) public protocolContracts;
    bytes32[] public contractKeys;

    // Emergency pause
    bool public paused;
    uint256 public pauseExpiry;

    // Multi-sig for critical operations
    uint256 public requiredSignatures = 2;
    mapping(address => bool) public isSigner;
    address[] public signers;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string description,
        address target,
        bytes callData
    );
    event ProposalCanceled(uint256 indexed proposalId);
    event ProposalExecuted(uint256 indexed proposalId);
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight
    );
    event OperationQueued(bytes32 indexed operationId, uint256 readyTime);
    event OperationExecuted(bytes32 indexed operationId);
    event ProtocolContractUpdated(bytes32 indexed key, address indexed contractAddr);
    event Paused(uint256 expiry);
    event Unpaused();
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);

    // ============ Modifiers ============

    modifier whenNotPaused() {
        require(!paused || block.timestamp > pauseExpiry, "Protocol paused");
        _;
    }

    modifier onlySigner() {
        require(isSigner[msg.sender], "Not authorized signer");
        _;
    }

    // ============ Constructor ============

    constructor(
        address[] memory _signers,
        uint256 _requiredSignatures
    ) Ownable(msg.sender) {
        require(_signers.length >= _requiredSignatures, "Insufficient signers");
        require(_requiredSignatures > 0, "Invalid threshold");

        for (uint256 i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0), "Invalid signer address");
            isSigner[_signers[i]] = true;
            signers.push(_signers[i]);
            emit SignerAdded(_signers[i]);
        }
        requiredSignatures = _requiredSignatures;
    }

    // ============ Proposal Functions ============

    /**
     * @notice Create a new governance proposal
     * @param description Human-readable description
     * @param target Contract to call
     * @param callData Function call data
     * @param value ETH value to send
     */
    function createProposal(
        string calldata description,
        address target,
        bytes calldata callData,
        uint256 value
    ) external returns (uint256) {
        // In production, check proposal threshold based on token holdings
        // For now, any signer can propose
        require(isSigner[msg.sender], "Not authorized to propose");

        uint256 proposalId = proposalCount++;
        uint256 voteStart = block.timestamp + votingDelay;
        uint256 voteEnd = voteStart + votingPeriod;

        bytes32 proposalHash = keccak256(abi.encode(target, callData, value, description));

        proposals[proposalId] = Proposal({
            id: proposalId,
            description: description,
            target: target,
            callData: callData,
            value: value,
            voteStart: voteStart,
            voteEnd: voteEnd,
            forVotes: 0,
            againstVotes: 0,
            state: ProposalState.Pending,
            proposer: msg.sender,
            proposalHash: proposalHash
        });

        emit ProposalCreated(proposalId, msg.sender, description, target, callData);
        return proposalId;
    }

    /**
     * @notice Cast vote on a proposal
     * @param proposalId The proposal to vote on
     * @param support True for yes, false for no
     */
    function castVote(uint256 proposalId, bool support) external whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.voteStart, "Voting not started");
        require(block.timestamp < proposal.voteEnd, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        // Update state to active if needed
        if (proposal.state == ProposalState.Pending) {
            proposal.state = ProposalState.Active;
        }

        hasVoted[proposalId][msg.sender] = true;
        votedFor[proposalId][msg.sender] = support;

        // Each signer has weight of 1 (in production, use token balance)
        uint256 weight = 1;
        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /**
     * @notice Queue a successful proposal for execution
     * @param proposalId The proposal to queue
     */
    function queueProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp >= proposal.voteEnd, "Voting not ended");

        // Check if proposal passed
        require(proposal.forVotes > proposal.againstVotes, "Proposal defeated");
        require(
            proposal.forVotes >= (signers.length * quorumNumerator) / 100,
            "Quorum not reached"
        );

        proposal.state = ProposalState.Queued;

        // Create timelocked operation
        bytes32 operationId = keccak256(abi.encode(proposal.target, proposal.callData, proposal.value));
        timelockedOperations[operationId] = TimelockedOperation({
            id: operationId,
            target: proposal.target,
            callData: proposal.callData,
            value: proposal.value,
            readyTime: block.timestamp + timelockDelay,
            executed: false
        });

        emit OperationQueued(operationId, block.timestamp + timelockDelay);
    }

    /**
     * @notice Execute a queued proposal after timelock
     * @param proposalId The proposal to execute
     * @param signatures Multi-sig signatures authorizing execution
     */
    function executeProposal(
        uint256 proposalId,
        bytes[] calldata signatures
    ) external whenNotPaused {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.state == ProposalState.Queued, "Not queued");

        bytes32 operationId = keccak256(abi.encode(proposal.target, proposal.callData, proposal.value));
        TimelockedOperation storage op = timelockedOperations[operationId];

        require(block.timestamp >= op.readyTime, "Timelock not expired");
        require(!op.executed, "Already executed");

        // Verify multi-sig
        _verifySignatures(operationId, signatures);

        // Execute the operation
        op.executed = true;
        proposal.state = ProposalState.Executed;

        (bool success, ) = proposal.target.call{value: proposal.value}(proposal.callData);
        require(success, "Execution failed");

        emit ProposalExecuted(proposalId);
        emit OperationExecuted(operationId);
    }

    /**
     * @notice Cancel a proposal
     * @param proposalId The proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(
            msg.sender == proposal.proposer || msg.sender == owner(),
            "Not authorized"
        );
        require(proposal.state == ProposalState.Pending || proposal.state == ProposalState.Active, "Cannot cancel");

        proposal.state = ProposalState.Canceled;
        emit ProposalCanceled(proposalId);
    }

    // ============ Emergency Functions ============

    /**
     * @notice Pause the protocol in emergency
     * @param duration How long the pause should last
     * @param signatures Multi-sig authorization
     */
    function emergencyPause(
        uint256 duration,
        bytes[] calldata signatures
    ) external {
        bytes32 pauseId = keccak256(abi.encode("pause", duration, block.timestamp));
        _verifySignatures(pauseId, signatures);

        paused = true;
        pauseExpiry = block.timestamp + duration;
        emit Paused(pauseExpiry);
    }

    /**
     * @notice Unpause the protocol
     */
    function unpause() external onlyOwner {
        paused = false;
        pauseExpiry = 0;
        emit Unpaused();
    }

    // ============ Contract Management ============

    /**
     * @notice Register a protocol contract
     * @param key Identifier for the contract
     * @param contractAddr Contract address
     */
    function setProtocolContract(
        bytes32 key,
        address contractAddr
    ) external onlyOwner {
        protocolContracts[key] = contractAddr;

        // Track keys for enumeration
        bool found = false;
        for (uint256 i = 0; i < contractKeys.length; i++) {
            if (contractKeys[i] == key) {
                found = true;
                break;
            }
        }
        if (!found) {
            contractKeys.push(key);
        }

        emit ProtocolContractUpdated(key, contractAddr);
    }

    /**
     * @notice Get all registered contract keys
     */
    function getContractKeys() external view returns (bytes32[] memory) {
        return contractKeys;
    }

    // ============ Signer Management ============

    /**
     * @notice Add a new signer
     * @param signer Address to add
     */
    function addSigner(address signer) external onlyOwner {
        require(signer != address(0), "Invalid address");
        require(!isSigner[signer], "Already signer");

        isSigner[signer] = true;
        signers.push(signer);
        emit SignerAdded(signer);
    }

    /**
     * @notice Remove a signer
     * @param signer Address to remove
     */
    function removeSigner(address signer) external onlyOwner {
        require(isSigner[signer], "Not a signer");
        require(signers.length > requiredSignatures, "Would break threshold");

        isSigner[signer] = false;
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }
        emit SignerRemoved(signer);
    }

    /**
     * @notice Update required signatures threshold
     */
    function setRequiredSignatures(uint256 _required) external onlyOwner {
        require(_required > 0 && _required <= signers.length, "Invalid threshold");
        requiredSignatures = _required;
    }

    // ============ View Functions ============

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getSigners() external view returns (address[] memory) {
        return signers;
    }

    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        return proposals[proposalId].state;
    }

    // ============ Internal Functions ============

    function _verifySignatures(
        bytes32 operationId,
        bytes[] calldata signatures
    ) internal view {
        require(signatures.length >= requiredSignatures, "Insufficient signatures");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(operationId);
        uint256 validSignatures = 0;
        address[] memory seenSigners = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);

            // Check signer is authorized
            require(isSigner[signer], "Invalid signer");

            // Check for duplicate signatures
            for (uint256 j = 0; j < i; j++) {
                require(seenSigners[j] != signer, "Duplicate signature");
            }
            seenSigners[i] = signer;
            validSignatures++;
        }

        require(validSignatures >= requiredSignatures, "Insufficient valid signatures");
    }
}

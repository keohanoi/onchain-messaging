import { test, expect } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// Test constants
const HARHAT_RPC = 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;

// Test accounts
const TEST_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
];

let hardhatNode: ChildProcess | null = null;
let provider: ethers.JsonRpcProvider | null = null;
let wallet1: ethers.Wallet | null = null;
let wallet2: ethers.Wallet | null = null;
let deployments: any = null;

test.describe('Smart Contracts', () => {
  test.beforeAll(async () => {
    // Start Hardhat node
    console.log('Starting Hardhat node for contract tests...');
    hardhatNode = spawn('npx', ['hardhat', 'node'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    // Wait for node to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Hardhat node timeout')), 30000);

      hardhatNode!.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
          clearTimeout(timeout);
          console.log('Hardhat node started');
          resolve();
        }
      });

      hardhatNode!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Deploy contracts
    console.log('Deploying contracts...');
    execSync('npx hardhat run scripts/deploy.js --network localhost', {
      stdio: 'inherit',
      timeout: 60000,
    });

    // Load deployments
    const deploymentsPath = path.join(__dirname, '../frontend/src/contracts/deployments.json');
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));

    // Setup provider and wallets
    provider = new ethers.JsonRpcProvider(HARHAT_RPC);
    wallet1 = new ethers.Wallet(TEST_ACCOUNTS[0].privateKey, provider);
    wallet2 = new ethers.Wallet(TEST_ACCOUNTS[1].privateKey, provider);

    console.log('Contracts deployed:', deployments.contracts);
  });

  test.afterAll(async () => {
    if (hardhatNode) {
      hardhatNode.kill();
      hardhatNode = null;
    }
  });

  test('should have valid deployment addresses', () => {
    expect(deployments).toBeDefined();
    expect(deployments.chainId).toBe(CHAIN_ID);
    expect(deployments.contracts.ZKVerifier).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deployments.contracts.StealthRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deployments.contracts.MessageHub).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deployments.contracts.GroupRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('should connect to Hardhat network', async () => {
    const network = await provider!.getNetwork();
    expect(Number(network.chainId)).toBe(CHAIN_ID);
  });

  test('should have test accounts with balance', async () => {
    const balance1 = await provider!.getBalance(TEST_ACCOUNTS[0].address);
    const balance2 = await provider!.getBalance(TEST_ACCOUNTS[1].address);

    expect(balance1).toBeGreaterThan(0n);
    expect(balance2).toBeGreaterThan(0n);
  });
});

test.describe('StealthRegistry Contract', () => {
  let registry: ethers.Contract;

  test.beforeAll(async () => {
    // Load ABI
    const abiPath = path.join(__dirname, '../frontend/src/contracts/StealthRegistry.abi.json');
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

    registry = new ethers.Contract(
      deployments.contracts.StealthRegistry,
      abi,
      wallet1!
    );
  });

  test('should not have key bundle initially', async () => {
    const hasBundle = await registry.hasKeyBundle(TEST_ACCOUNTS[0].address);
    expect(hasBundle).toBe(false);
  });

  test('should register key bundle', async () => {
    // Generate mock keys (32 bytes each)
    const identityKey = ethers.randomBytes(32);
    const signedPreKey = ethers.randomBytes(32);
    const stealthSpendingPubKey = ethers.randomBytes(32);
    const stealthViewingPubKey = ethers.randomBytes(32);

    // Sign the signed prekey
    const signedPreKeySignature = await wallet1!.signMessage(signedPreKey);

    // Create bundle hash for signature
    const bundleHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'bytes', 'bytes', 'bytes', 'string', 'bytes', 'bytes', 'bytes', 'uint256'],
        [
          wallet1!.address,
          identityKey,
          signedPreKey,
          signedPreKeySignature,
          '',
          stealthSpendingPubKey,
          stealthViewingPubKey,
          '0x',
          0
        ]
      )
    );

    const ethSignature = await wallet1!.signMessage(ethers.getBytes(bundleHash));

    // Register
    const tx = await registry.registerKeyBundle(
      {
        identityKey,
        signedPreKey,
        signedPreKeySignature: ethers.getBytes(signedPreKeySignature),
        oneTimePreKeyBundleCid: '',
        stealthSpendingPubKey,
        stealthViewingPubKey,
        pqPublicKey: '0x',
        oneTimePreKeyCount: 0
      },
      ethSignature
    );

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);

    // Verify registration
    const hasBundle = await registry.hasKeyBundle(TEST_ACCOUNTS[0].address);
    expect(hasBundle).toBe(true);
  });

  test('should retrieve registered key bundle', async () => {
    const bundle = await registry.getKeyBundle(TEST_ACCOUNTS[0].address);

    expect(bundle.identityKey).toBeDefined();
    expect(bundle.identityKey.length).toBeGreaterThan(0);
    expect(bundle.signedPreKey).toBeDefined();
    expect(bundle.stealthSpendingPubKey).toBeDefined();
    expect(bundle.stealthViewingPubKey).toBeDefined();
  });

  test('should emit KeyBundleRegistered event', async () => {
    // Check for events in past logs
    const filter = registry.filters.KeyBundleRegistered(TEST_ACCOUNTS[0].address);
    const events = await registry.queryFilter(filter);

    expect(events.length).toBeGreaterThan(0);
  });
});

test.describe('MessageHub Contract', () => {
  let messageHub: ethers.Contract;

  test.beforeAll(async () => {
    // Load ABI
    const abiPath = path.join(__dirname, '../frontend/src/contracts/MessageHub.abi.json');
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

    messageHub = new ethers.Contract(
      deployments.contracts.MessageHub,
      abi,
      wallet1!
    );
  });

  test('should have correct verifier address', async () => {
    const verifier = await messageHub.verifier();
    expect(verifier.toLowerCase()).toBe(deployments.contracts.ZKVerifier.toLowerCase());
  });

  test('should start with zero total messages', async () => {
    const total = await messageHub.totalMessages();
    expect(total).toBe(0n);
  });

  test('should post direct message', async () => {
    const stealthRecipient = wallet2!.address;
    const ephemeralPubKey = ethers.randomBytes(33);
    const viewTag = 0xa7;
    const encryptedMetadata = ethers.randomBytes(64);
    const nullifier = ethers.id('test-nullifier-' + Date.now());

    const tx = await messageHub.postDirectMessage(
      stealthRecipient,
      ephemeralPubKey,
      viewTag,
      encryptedMetadata,
      nullifier
    );

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);

    // Verify message count increased
    const total = await messageHub.totalMessages();
    expect(total).toBe(1n);
  });

  test('should reject duplicate nullifiers', async () => {
    const stealthRecipient = wallet2!.address;
    const ephemeralPubKey = ethers.randomBytes(33);
    const viewTag = 0xb8;
    const encryptedMetadata = ethers.randomBytes(64);
    const nullifier = ethers.id('unique-nullifier');

    // First message should succeed
    await messageHub.postDirectMessage(
      stealthRecipient,
      ephemeralPubKey,
      viewTag,
      encryptedMetadata,
      nullifier
    );

    // Second with same nullifier should fail
    await expect(
      messageHub.postDirectMessage(
        stealthRecipient,
        ephemeralPubKey,
        viewTag,
        encryptedMetadata,
        nullifier
      )
    ).rejects.toThrow('Nullifier used');
  });

  test('should reject invalid ephemeral key length', async () => {
    const stealthRecipient = wallet2!.address;
    const ephemeralPubKey = ethers.randomBytes(32); // Wrong length
    const viewTag = 0xc9;
    const encryptedMetadata = ethers.randomBytes(64);
    const nullifier = ethers.id('another-unique-nullifier');

    await expect(
      messageHub.postDirectMessage(
        stealthRecipient,
        ephemeralPubKey,
        viewTag,
        encryptedMetadata,
        nullifier
      )
    ).rejects.toThrow('Invalid ephemeral key length');
  });

  test('should mark nullifier as used', async () => {
    const nullifier = ethers.id('check-used-nullifier');
    const stealthRecipient = wallet2!.address;
    const ephemeralPubKey = ethers.randomBytes(33);
    const viewTag = 0xd0;
    const encryptedMetadata = ethers.randomBytes(64);

    // Should not be used initially
    const usedBefore = await messageHub.isNullifierUsed(nullifier);
    expect(usedBefore).toBe(false);

    // Post message
    await messageHub.postDirectMessage(
      stealthRecipient,
      ephemeralPubKey,
      viewTag,
      encryptedMetadata,
      nullifier
    );

    // Should be used after
    const usedAfter = await messageHub.isNullifierUsed(nullifier);
    expect(usedAfter).toBe(true);
  });

  test('should emit MessagePosted event', async () => {
    const stealthRecipient = wallet2!.address;
    const ephemeralPubKey = ethers.randomBytes(33);
    const viewTag = 0xe1;
    const encryptedMetadata = ethers.randomBytes(64);
    const nullifier = ethers.id('event-test-nullifier');

    const tx = await messageHub.postDirectMessage(
      stealthRecipient,
      ephemeralPubKey,
      viewTag,
      encryptedMetadata,
      nullifier
    );

    const receipt = await tx.wait();
    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = messageHub.interface.parseLog(log);
        return parsed?.name === 'MessagePosted';
      } catch {
        return false;
      }
    });

    expect(event).toBeDefined();
  });
});

test.describe('GroupRegistry Contract', () => {
  let groupRegistry: ethers.Contract;

  test.beforeAll(async () => {
    // Load ABI
    const abiPath = path.join(__dirname, '../frontend/src/contracts/GroupRegistry.abi.json');
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

    groupRegistry = new ethers.Contract(
      deployments.contracts.GroupRegistry,
      abi,
      wallet1!
    );
  });

  test('should create a group', async () => {
    const groupId = ethers.id('test-group-1');
    const adminEncryptedKey = ethers.randomBytes(32);

    const tx = await groupRegistry.createGroup(groupId, true, adminEncryptedKey);
    const receipt = await tx.wait();

    expect(receipt.status).toBe(1);

    // Verify group exists
    const groupInfo = await groupRegistry.getGroupInfo(groupId);
    expect(groupInfo.admin.toLowerCase()).toBe(wallet1!.address.toLowerCase());
    expect(groupInfo.isPublic).toBe(true);
  });

  test('should add member to group', async () => {
    const groupId = ethers.id('test-group-2');
    const adminEncryptedKey = ethers.randomBytes(32);

    // Create group first
    await groupRegistry.createGroup(groupId, false, adminEncryptedKey);

    // Add member
    const identityCommitment = ethers.id('member-1');
    const newMerkleRoot = ethers.id('merkle-root-1');
    const encryptedKeyForMember = ethers.randomBytes(32);

    const tx = await groupRegistry.addMember(
      groupId,
      identityCommitment,
      newMerkleRoot,
      encryptedKeyForMember
    );

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);

    // Verify member was added
    const groupInfo = await groupRegistry.getGroupInfo(groupId);
    expect(groupInfo.memberCount).toBe(1n);
  });

  test('should check membership', async () => {
    const groupId = ethers.id('test-group-3');
    const identityCommitment = ethers.id('member-check');

    // Create group and add member
    await groupRegistry.createGroup(groupId, true, ethers.randomBytes(32));
    await groupRegistry.addMember(
      groupId,
      identityCommitment,
      ethers.id('root'),
      ethers.randomBytes(32)
    );

    // Check membership
    const isMember = await groupRegistry.isMember(groupId, identityCommitment);
    expect(isMember).toBe(true);

    // Non-member check
    const nonMember = await groupRegistry.isMember(groupId, ethers.id('non-member'));
    expect(nonMember).toBe(false);
  });

  test('should rotate group key', async () => {
    const groupId = ethers.id('test-group-4');

    // Create group
    await groupRegistry.createGroup(groupId, true, ethers.randomBytes(32));

    const groupInfoBefore = await groupRegistry.getGroupInfo(groupId);
    const epochBefore = groupInfoBefore.epoch;

    // Rotate key
    const newEncryptedKey = ethers.randomBytes(32);
    await groupRegistry.rotateGroupKey(groupId, newEncryptedKey);

    const groupInfoAfter = await groupRegistry.getGroupInfo(groupId);
    expect(groupInfoAfter.epoch).toBe(epochBefore + 1n);
  });

  test('should only allow admin to add members', async () => {
    const groupId = ethers.id('test-group-5');

    // Create group as wallet1
    await groupRegistry.createGroup(groupId, true, ethers.randomBytes(32));

    // Try to add member as wallet2 (should fail)
    const groupRegistryAsWallet2 = groupRegistry.connect(wallet2!);

    await expect(
      groupRegistryAsWallet2.addMember(
        groupId,
        ethers.id('unauthorized-member'),
        ethers.id('root'),
        ethers.randomBytes(32)
      )
    ).rejects.toThrow('Not admin');
  });
});

test.describe('ZKVerifier Contract', () => {
  let zkVerifier: ethers.Contract;

  test.beforeAll(async () => {
    // Load ABI
    const abiPath = path.join(__dirname, '../frontend/src/contracts/ZKVerifier.abi.json');
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

    zkVerifier = new ethers.Contract(
      deployments.contracts.ZKVerifier,
      abi,
      wallet1!
    );
  });

  test('should have correct owner', async () => {
    const owner = await zkVerifier.owner();
    expect(owner.toLowerCase()).toBe(wallet1!.address.toLowerCase());
  });

  test('should start with VK not initialized', async () => {
    const initialized = await zkVerifier.vkInitialized();
    expect(initialized).toBe(false);
  });

  test('should allow owner to set valid root', async () => {
    const groupId = ethers.id('root-test-group');
    const root = ethers.id('test-root');

    const tx = await zkVerifier.setValidRoot(groupId, root, true);
    const receipt = await tx.wait();

    expect(receipt.status).toBe(1);

    // Verify root is valid
    const isValid = await zkVerifier.validRoots(groupId, root);
    expect(isValid).toBe(true);
  });

  test('should reject verifyMembership when VK not initialized', async () => {
    const proof = ethers.randomBytes(256);
    const merkleRoot = ethers.id('merkle-root');
    const groupId = ethers.id('group-id');
    const nullifier = ethers.id('nullifier');

    await expect(
      zkVerifier.verifyMembership(proof, merkleRoot, groupId, nullifier)
    ).rejects.toThrow('VK not initialized');
  });
});

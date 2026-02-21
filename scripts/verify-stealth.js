const { ethers } = require('hardhat');
const { secp256k1 } = require('@noble/curves/secp256k1');

function hexFromBytes(bytes) {
  return '0x' + Buffer.from(bytes).toString('hex');
}

function hashToScalar(sharedSecret) {
  const hash = ethers.keccak256(Buffer.from(sharedSecret));
  return BigInt(hash) % secp256k1.CURVE.n;
}

function computeViewTag(sharedSecret) {
  const hash = ethers.keccak256(Buffer.from(sharedSecret));
  return parseInt(hash.slice(2, 4), 16);
}

async function main() {
  const deployments = require('../frontend/src/contracts/deployments.json');
  const registry = await ethers.getContractAt("StealthRegistry", deployments.contracts.StealthRegistry);
  
  // Get Bob's keys from the registry
  const bobAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const bobBundle = await registry.getKeyBundle(bobAddress);
  
  console.log('=== Bob\'s Keys from Registry ===');
  console.log('Viewing pubkey:', bobBundle.stealthViewingPubKey);
  console.log('Spending pubkey:', bobBundle.stealthSpendingPubKey);
  
  // Get the event data
  const messageHub = await ethers.getContractAt("MessageHub", deployments.contracts.MessageHub);
  const filter = messageHub.filters.MessagePosted();
  const events = await messageHub.queryFilter(filter);
  
  if (events.length === 0) {
    console.log('No events found');
    return;
  }
  
  const event = events[0];
  console.log('\n=== Event Data ===');
  console.log('stealthRecipient (from event):', event.args.stealthRecipient);
  console.log('ephemeralPubKey:', event.args.ephemeralPubKey);
  console.log('viewTag (from event):', event.args.viewTag, '= decimal', parseInt(event.args.viewTag.slice(2, 4), 16));
  
  // The problem: we need Bob's viewing PRIVATE key to compute the shared secret
  // But we only have the public key from the registry
  // This confirms the scanning logic needs Bob's private keys loaded locally
  
  console.log('\n=== Analysis ===');
  console.log('To scan messages, Bob needs his viewing PRIVATE key.');
  console.log('The registry only stores PUBLIC keys.');
  console.log('Bob\'s private keys are stored in localStorage/IPFS after registration.');
  
  // Check if Bob has local keys stored
  console.log('\n=== Checking Bob\'s local storage (simulated) ===');
  // This would be in the browser's localStorage
  console.log('Keys would be stored at: pomp-keys-' + bobAddress);
}

main().catch(console.error);

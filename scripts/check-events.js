const { ethers } = require('hardhat');

async function main() {
  const deployments = require('../frontend/src/contracts/deployments.json');
  const messageHub = await ethers.getContractAt("MessageHub", deployments.contracts.MessageHub);
  
  // Query all MessagePosted events
  const filter = messageHub.filters.MessagePosted();
  const events = await messageHub.queryFilter(filter);
  console.log('Total MessagePosted events:', events.length);
  
  for (const event of events) {
    console.log('\n=== Event ===');
    console.log('commitment:', event.args.commitment);
    console.log('stealthRecipient:', event.args.stealthRecipient);
    console.log('ephemeralPubKey length:', event.args.ephemeralPubKey?.length);
    console.log('ephemeralPubKey (hex):', event.args.ephemeralPubKey);
    console.log('viewTag:', event.args.viewTag);
    console.log('encryptedMetadata length:', event.args.encryptedMetadata?.length);
    console.log('nullifier:', event.args.nullifier);
    console.log('blockNumber:', event.blockNumber);
  }
  
  // Check the stealth registry for registered users
  const registry = await ethers.getContractAt("StealthRegistry", deployments.contracts.StealthRegistry);
  
  try {
    const aliceBundle = await registry.getKeyBundle('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    console.log('\n=== Alice (0xf39F...92266) ===');
    console.log('Registered:', aliceBundle.identityKey?.length > 2);
    if (aliceBundle.identityKey?.length > 2) {
      console.log('Identity key (first 30):', aliceBundle.identityKey?.slice(0, 30));
      console.log('Viewing key (first 30):', aliceBundle.stealthViewingPubKey?.slice(0, 30));
      console.log('Spending key (first 30):', aliceBundle.stealthSpendingPubKey?.slice(0, 30));
    }
  } catch (e) {
    console.log('\nAlice not registered:', e.message);
  }
  
  try {
    const bobBundle = await registry.getKeyBundle('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    console.log('\n=== Bob (0x7099...79C8) ===');
    console.log('Registered:', bobBundle.identityKey?.length > 2);
    if (bobBundle.identityKey?.length > 2) {
      console.log('Identity key (first 30):', bobBundle.identityKey?.slice(0, 30));
      console.log('Viewing key (first 30):', bobBundle.stealthViewingPubKey?.slice(0, 30));
      console.log('Spending key (first 30):', bobBundle.stealthSpendingPubKey?.slice(0, 30));
    }
  } catch (e) {
    console.log('\nBob not registered:', e.message);
  }
}

main().catch(console.error);

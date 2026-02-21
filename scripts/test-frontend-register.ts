import { ethers } from "hardhat";
import { AbiCoder, keccak256, getBytes } from "ethers";

// This simulates what the frontend does
async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Testing registration for:", signer.address);
  
  const registryAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const registry = await ethers.getContractAt("StealthRegistry", registryAddress);
  
  // 1. Check if already registered
  console.log("\n1. Checking current registration status...");
  try {
    const existingBundle = await registry.getKeyBundle(signer.address);
    console.log("   Existing identity key length:", existingBundle.identityKey.length);
    if (existingBundle.identityKey.length > 2) {
      console.log("   Already registered!");
      return;
    }
  } catch (err) {
    console.log("   Not registered yet (expected for new users)");
  }
  
  // 2. Generate keys (same as frontend)
  console.log("\n2. Generating keys...");
  const crypto = require('crypto');
  
  const generateKeyPair = () => {
    const privateKey = crypto.randomBytes(32);
    const publicKey = new Uint8Array(33);
    publicKey[0] = 0x02; // Compressed key prefix
    for (let i = 0; i < 32; i++) {
      publicKey[i + 1] = privateKey[i];
    }
    return { privateKey, publicKey };
  };
  
  const identityKeyPair = generateKeyPair();
  const signedPreKeyPair = generateKeyPair();
  const stealthSpendingKeyPair = generateKeyPair();
  const stealthViewingKeyPair = generateKeyPair();
  
  console.log("   Identity key (first 4 bytes):", Buffer.from(identityKeyPair.publicKey.slice(0, 4)).toString('hex'));
  
  // 3. Sign the signed prekey
  console.log("\n3. Signing signed prekey...");
  const signedPreKeySignature = await signer.signMessage(Buffer.from(signedPreKeyPair.publicKey));
  console.log("   Signature length:", signedPreKeySignature.length);
  
  // 4. Build bundle (same as frontend)
  console.log("\n4. Building bundle...");
  const bundle = {
    identityKey: identityKeyPair.publicKey,
    signedPreKey: signedPreKeyPair.publicKey,
    signedPreKeySignature: Buffer.from(signedPreKeySignature.slice(2), 'hex'),
    oneTimePreKeyBundleCid: '',
    stealthSpendingPubKey: stealthSpendingKeyPair.publicKey,
    stealthViewingPubKey: stealthViewingKeyPair.publicKey,
    pqPublicKey: '0x',
    oneTimePreKeyCount: 0
  };
  
  // 5. Compute bundle hash (same as frontend)
  console.log("\n5. Computing bundle hash...");
  const abiCoder = AbiCoder.defaultAbiCoder();
  
  const encoded1 = abiCoder.encode(
    ['address', 'bytes', 'bytes', 'bytes'],
    [signer.address, bundle.identityKey, bundle.signedPreKey, bundle.signedPreKeySignature]
  );
  
  const encoded2 = abiCoder.encode(
    ['string', 'bytes', 'bytes', 'bytes', 'uint256'],
    [bundle.oneTimePreKeyBundleCid, bundle.stealthSpendingPubKey, bundle.stealthViewingPubKey, bundle.pqPublicKey, bundle.oneTimePreKeyCount]
  );
  
  const combined = Buffer.concat([
    Buffer.from(encoded1.slice(2), 'hex'),
    Buffer.from(encoded2.slice(2), 'hex')
  ]);
  const bundleHash = keccak256(combined);
  console.log("   Bundle hash:", bundleHash);
  
  // 6. Sign bundle hash (same as frontend)
  console.log("\n6. Signing bundle hash...");
  const ethSignature = await signer.signMessage(getBytes(bundleHash));
  console.log("   Signature:", ethSignature.slice(0, 30) + "...");
  
  // 7. Register on chain
  console.log("\n7. Registering on chain...");
  try {
    const tx = await registry.registerKeyBundle(bundle, ethSignature);
    console.log("   TX hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("   Status:", receipt?.status === 1 ? "SUCCESS" : "FAILED");
  } catch (err: any) {
    console.error("   ERROR:", err.message);
    return;
  }
  
  // 8. Verify registration (same as frontend refreshRegistration)
  console.log("\n8. Verifying registration...");
  try {
    const storedBundle = await registry.getKeyBundle(signer.address);
    const hasKeys = storedBundle.identityKey && storedBundle.identityKey.length > 2;
    console.log("   Has keys:", hasKeys);
    console.log("   Identity key length:", storedBundle.identityKey.length);
    
    if (hasKeys) {
      console.log("\n✅ REGISTRATION SUCCESSFUL!");
    } else {
      console.log("\n❌ Registration failed - no keys found");
    }
  } catch (err: any) {
    console.error("   Error checking registration:", err.message);
  }
}

main().catch(console.error);

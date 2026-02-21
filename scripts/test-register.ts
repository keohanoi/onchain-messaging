import { ethers } from "hardhat";
import { AbiCoder, keccak256, getBytes } from "ethers";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  
  // Get deployed contract
  const registry = await ethers.getContractAt(
    "StealthRegistry",
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
  );
  
  // Generate mock keys (33 bytes each for compressed public keys)
  const identityKey = new Uint8Array(33).fill(1);
  const signedPreKey = new Uint8Array(33).fill(2);
  const stealthSpendingPubKey = new Uint8Array(33).fill(3);
  const stealthViewingPubKey = new Uint8Array(33).fill(4);
  
  // Sign the signed prekey
  const signedPreKeySignature = await signer.signMessage(Buffer.from(signedPreKey));
  console.log("Signed prekey signature length:", signedPreKeySignature.length);
  
  // Build bundle
  const bundle = {
    identityKey,
    signedPreKey,
    signedPreKeySignature: Buffer.from(signedPreKeySignature.slice(2), 'hex'),
    oneTimePreKeyBundleCid: '',
    stealthSpendingPubKey,
    stealthViewingPubKey,
    pqPublicKey: '0x',
    oneTimePreKeyCount: 0
  };
  
  // Compute bundle hash exactly as Solidity does
  const abiCoder = AbiCoder.defaultAbiCoder();
  
  const encoded1 = abiCoder.encode(
    ['address', 'bytes', 'bytes', 'bytes'],
    [signer.address, bundle.identityKey, bundle.signedPreKey, bundle.signedPreKeySignature]
  );
  
  const encoded2 = abiCoder.encode(
    ['string', 'bytes', 'bytes', 'bytes', 'uint256'],
    [
      bundle.oneTimePreKeyBundleCid,
      bundle.stealthSpendingPubKey,
      bundle.stealthViewingPubKey,
      bundle.pqPublicKey,
      bundle.oneTimePreKeyCount
    ]
  );
  
  const combined = Buffer.concat([
    Buffer.from(encoded1.slice(2), 'hex'), 
    Buffer.from(encoded2.slice(2), 'hex')
  ]);
  const bundleHash = keccak256(combined);
  console.log("Bundle hash:", bundleHash);
  
  // Sign the bundle hash
  const ethSignature = await signer.signMessage(getBytes(bundleHash));
  console.log("ETH signature:", ethSignature.slice(0, 20) + "...");
  
  // Register
  console.log("\nCalling registerKeyBundle...");
  const tx = await registry.registerKeyBundle(bundle, ethSignature);
  console.log("TX sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("TX confirmed, status:", receipt?.status);
}

main().catch(console.error);

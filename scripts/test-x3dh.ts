import { ethers } from "hardhat";
import { keccak256 } from "ethers";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Testing X3DH signature verification...");
  
  // Simulate what frontend does
  const signedPreKey = new Uint8Array(33);
  signedPreKey[0] = 0x02;
  for (let i = 1; i < 33; i++) signedPreKey[i] = i;
  
  // Sign with EIP-191 (what frontend does)
  const signature = await signer.signMessage(Buffer.from(signedPreKey));
  console.log("Signature length:", signature.length);
  console.log("Signature:", signature);
  
  // Verify what X3DH code will compute
  const prefix = Buffer.from("\x19Ethereum Signed Message:\n" + signedPreKey.length);
  const msg = Buffer.concat([prefix, Buffer.from(signedPreKey)]);
  const msgHash = keccak256(msg);
  console.log("Message hash:", msgHash);
  
  // Recover signer address
  const recovered = ethers.verifyMessage(Buffer.from(signedPreKey), signature);
  console.log("Recovered address:", recovered);
  console.log("Signer address:", signer.address);
  console.log("Match:", recovered.toLowerCase() === signer.address.toLowerCase());
  
  // Now test with the contract
  const registry = await ethers.getContractAt(
    "StealthRegistry",
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
  );
  
  const bundle = await registry.getKeyBundle(signer.address);
  console.log("\nStored bundle:");
  console.log("  identityKey length:", bundle.identityKey.length);
  console.log("  signedPreKey length:", bundle.signedPreKey.length);
  console.log("  signature length:", bundle.signedPreKeySignature.length);
  console.log("  signature hex:", bundle.signedPreKeySignature);
}

main().catch(console.error);

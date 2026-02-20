const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH");

  // Deploy ZKVerifier first (no constructor args)
  console.log("\nDeploying ZKVerifier...");
  const ZKVerifier = await hre.ethers.getContractFactory("ZKVerifier");
  const zkVerifier = await ZKVerifier.deploy();
  await zkVerifier.waitForDeployment();
  const zkVerifierAddress = await zkVerifier.getAddress();
  console.log("ZKVerifier deployed to:", zkVerifierAddress);

  // Deploy StealthRegistry (no constructor args)
  console.log("\nDeploying StealthRegistry...");
  const StealthRegistry = await hre.ethers.getContractFactory("StealthRegistry");
  const stealthRegistry = await StealthRegistry.deploy();
  await stealthRegistry.waitForDeployment();
  const stealthRegistryAddress = await stealthRegistry.getAddress();
  console.log("StealthRegistry deployed to:", stealthRegistryAddress);

  // Deploy MessageHub (requires ZKVerifier address)
  console.log("\nDeploying MessageHub...");
  const MessageHub = await hre.ethers.getContractFactory("MessageHub");
  const messageHub = await MessageHub.deploy(zkVerifierAddress);
  await messageHub.waitForDeployment();
  const messageHubAddress = await messageHub.getAddress();
  console.log("MessageHub deployed to:", messageHubAddress);

  // Deploy GroupRegistry (no constructor args)
  console.log("\nDeploying GroupRegistry...");
  const GroupRegistry = await hre.ethers.getContractFactory("GroupRegistry");
  const groupRegistry = await GroupRegistry.deploy();
  await groupRegistry.waitForDeployment();
  const groupRegistryAddress = await groupRegistry.getAddress();
  console.log("GroupRegistry deployed to:", groupRegistryAddress);

  // Authorize GroupRegistry to register roots in ZKVerifier
  console.log("\nAuthorizing GroupRegistry in ZKVerifier...");
  const tx = await zkVerifier.setAuthorizedRootRegistrar(groupRegistryAddress, true);
  await tx.wait();
  console.log("GroupRegistry authorized as root registrar");

  // Get chain ID
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  // Export deployment addresses
  const deployments = {
    chainId,
    network: hre.network.name,
    contracts: {
      ZKVerifier: zkVerifierAddress,
      StealthRegistry: stealthRegistryAddress,
      MessageHub: messageHubAddress,
      GroupRegistry: groupRegistryAddress
    }
  };

  const deploymentsPath = path.join(__dirname, "../frontend/src/contracts/deployments.json");

  // Ensure directory exists
  const contractsDir = path.dirname(deploymentsPath);
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log("\nDeployment addresses written to:", deploymentsPath);

  // Print summary
  console.log("\n=== Deployment Summary ===");
  console.log("Chain ID:", chainId);
  console.log("Network:", hre.network.name);
  console.log("ZKVerifier:", zkVerifierAddress);
  console.log("StealthRegistry:", stealthRegistryAddress);
  console.log("MessageHub:", messageHubAddress);
  console.log("GroupRegistry:", groupRegistryAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

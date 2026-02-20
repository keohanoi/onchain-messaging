const fs = require("fs");
const path = require("path");

const contracts = [
  "ZKVerifier",
  "StealthRegistry",
  "MessageHub",
  "GroupRegistry"
];

const artifactsDir = path.join(__dirname, "../artifacts/contracts/core");
const outputDir = path.join(__dirname, "../frontend/src/contracts");

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

for (const contractName of contracts) {
  const artifactPath = path.join(artifactsDir, `${contractName}.sol/${contractName}.json`);

  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found: ${artifactPath}`);
    console.error("Make sure to compile contracts first with 'npx hardhat compile'");
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  // Extract only the ABI
  const abi = artifact.abi;

  // Write ABI to output file
  const outputPath = path.join(outputDir, `${contractName}.abi.json`);
  fs.writeFileSync(outputPath, JSON.stringify(abi, null, 2));

  console.log(`Exported ABI: ${contractName} -> ${outputPath}`);
}

// Also create a combined ABIs export for convenience
const combinedAbis = {};
for (const contractName of contracts) {
  const abiPath = path.join(outputDir, `${contractName}.abi.json`);
  combinedAbis[contractName] = JSON.parse(fs.readFileSync(abiPath, "utf8"));
}

const combinedPath = path.join(outputDir, "index.ts");
const indexContent = `// Auto-generated - do not edit
// Run 'bun run export:abis' to regenerate

${contracts.map(c => `import ${c}ABI from './${c}.abi.json';`).join('\n')}

export const abis = {
${contracts.map(c => `  ${c}: ${c}ABI as const,`).join('\n')}
} as const;

${contracts.map(c => `export { ${c}ABI };`).join('\n')}
`;

fs.writeFileSync(combinedPath, indexContent);
console.log(`\nCreated combined export: ${combinedPath}`);

console.log("\nABI export complete!");

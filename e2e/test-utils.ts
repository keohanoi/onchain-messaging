import { spawn, ChildProcess } from 'child_process';
import { execSync } from 'child_process';

let hardhatNode: ChildProcess | null = null;
let contractsDeployed = false;

// Hardhat test accounts (first 3)
export const TEST_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
];

export async function startHardhatNode(): Promise<void> {
  if (hardhatNode) return;

  console.log('Starting Hardhat node...');
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

    hardhatNode!.stderr?.on('data', (data: Buffer) => {
      console.error('Hardhat stderr:', data.toString());
    });

    hardhatNode!.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function deployContracts(): Promise<void> {
  if (contractsDeployed) return;

  console.log('Deploying contracts...');
  try {
    execSync('npx hardhat run scripts/deploy.js --network localhost', {
      stdio: 'inherit',
      timeout: 60000,
    });
    contractsDeployed = true;
    console.log('Contracts deployed');
  } catch (error) {
    console.error('Failed to deploy contracts:', error);
    throw error;
  }
}

export async function stopHardhatNode(): Promise<void> {
  if (hardhatNode) {
    console.log('Stopping Hardhat node...');
    hardhatNode.kill();
    hardhatNode = null;
    contractsDeployed = false;
  }
}

export async function setupTestEnvironment(): Promise<void> {
  await startHardhatNode();
  await deployContracts();
}

export async function teardownTestEnvironment(): Promise<void> {
  await stopHardhatNode();
}

import { Wallet, JsonRpcProvider } from 'ethers'

export interface TestUser {
  name: string
  address: string
  privateKey: string
  wallet: Wallet
}

const provider = new JsonRpcProvider('http://127.0.0.1:8545')

// Hardhat default accounts - well-known private keys for local testing
export const TEST_USERS: Record<string, TestUser> = {
  alice: {
    name: 'Alice',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    wallet: new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider),
  },
  bob: {
    name: 'Bob',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    wallet: new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider),
  },
}

// Test mode is stored in localStorage as it's needed before wallet connection
// Once wallet is connected, config can be synced to IPFS
export const isTestMode = (): boolean => {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('pomp-test-mode') === 'true'
}

export const getTestUser = (): TestUser | null => {
  if (typeof window === 'undefined') return null
  const userName = localStorage.getItem('pomp-test-user')
  if (!userName) return TEST_USERS.alice
  return TEST_USERS[userName] || TEST_USERS.alice
}

export const setTestUser = (userName: string): void => {
  if (typeof window === 'undefined') return
  localStorage.setItem('pomp-test-user', userName)
}

export const enableTestMode = (): void => {
  if (typeof window === 'undefined') return
  localStorage.setItem('pomp-test-mode', 'true')
}

export const disableTestMode = (): void => {
  if (typeof window === 'undefined') return
  localStorage.setItem('pomp-test-mode', 'false')
}

// Get the localStorage key suffix for test mode
export const getStorageKeySuffix = (isTest: boolean, userName?: string): string => {
  if (isTest) {
    return `test-${userName || 'alice'}`
  }
  return ''
}

// Config type for IPFS sync
export interface Config {
  testMode: boolean
  testUser: string | null
  lastUpdated: number
}

// Get config for IPFS sync
export const getConfig = (): Config => {
  return {
    testMode: isTestMode(),
    testUser: localStorage.getItem('pomp-test-user'),
    lastUpdated: Date.now(),
  }
}

// Apply config from IPFS
export const applyConfig = (config: Config): void => {
  if (typeof window === 'undefined') return
  if (config.testMode) {
    localStorage.setItem('pomp-test-mode', 'true')
  } else {
    localStorage.setItem('pomp-test-mode', 'false')
  }
  if (config.testUser) {
    localStorage.setItem('pomp-test-user', config.testUser)
  }
}

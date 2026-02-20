import { http, createConfig } from 'wagmi'
import { hardhat } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

// Hardhat local network configuration
export const config = createConfig({
  chains: [hardhat],
  connectors: [
    injected(),
    metaMask(),
  ],
  transports: {
    [hardhat.id]: http('http://127.0.0.1:8545'),
  },
})

// Export chain for convenience
export const chain = hardhat

// Chain ID constant
export const CHAIN_ID = 31337

import { BrowserProvider, JsonRpcSigner } from 'ethers'
import type { WalletClient } from 'viem'

/**
 * Convert a viem WalletClient to an ethers JsonRpcSigner
 * This bridge allows using the existing MessageClient (ethers-based) with wagmi (viem-based)
 */
export function walletClientToSigner(walletClient: WalletClient): JsonRpcSigner {
  const { account, chain, transport } = walletClient

  if (!account) {
    throw new Error('Wallet client has no account')
  }

  if (!chain) {
    throw new Error('Wallet client has no chain')
  }

  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  }

  // Create a BrowserProvider from the viem transport
  const provider = new BrowserProvider(transport, network)

  // Return a JsonRpcSigner for the connected account
  return new JsonRpcSigner(provider, account.address)
}

/**
 * Type guard to check if wallet client has an account
 */
export function hasAccount(walletClient: WalletClient | undefined): walletClient is WalletClient & { account: { address: `0x${string}` } } {
  return walletClient?.account !== undefined
}

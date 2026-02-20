'use client'

import { useState, useCallback } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { Contract } from 'ethers'
import { walletClientToSigner } from '../lib/ethers-adapter'
import { generateKeyPair } from '../../../src/stealth'
import { createPoseidonHasher } from '../../../src/poseidon'
import { toBase64 } from '../../../src/crypto'
import { deployments } from '../contracts'
import StealthRegistryABI from '../contracts/StealthRegistry.abi.json'

export interface UseRegisterKeysReturn {
  isRegistering: boolean
  error: string | null
  txHash: string | null
  register: () => Promise<string | null>
}

export function useRegisterKeys(): UseRegisterKeysReturn {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const register = useCallback(async (): Promise<string | null> => {
    if (!isConnected || !address || !walletClient) {
      setError('Wallet not connected')
      return null
    }

    setIsRegistering(true)
    setError(null)
    setTxHash(null)

    try {
      const signer = walletClientToSigner(walletClient)

      // Generate key pairs
      const identityKeyPair = generateKeyPair()
      const signedPreKeyPair = generateKeyPair()
      const stealthSpendingKeyPair = generateKeyPair()
      const stealthViewingKeyPair = generateKeyPair()

      // Sign the signed prekey
      const signedPreKeySignature = await signer.signMessage(
        Buffer.from(signedPreKeyPair.publicKey)
      )

      // Compute identity commitment using Poseidon hash
      const poseidon = await createPoseidonHasher()
      // Simple hash of public key for commitment
      const pubKeyHex = Buffer.from(identityKeyPair.publicKey).toString('hex')
      const identityCommitment = poseidon([BigInt('0x' + pubKeyHex.slice(0, 32))])

      // Create registry contract instance
      const registry = new Contract(
        deployments.contracts.StealthRegistry,
        StealthRegistryABI,
        signer
      )

      // Create bundle hash for signature
      const bundleData = {
        identityKey: identityKeyPair.publicKey,
        signedPreKey: signedPreKeyPair.publicKey,
        signedPreKeySignature: Buffer.from(signedPreKeySignature.slice(2), 'hex'),
        oneTimePreKeyBundleCid: '',
        stealthSpendingPubKey: stealthSpendingKeyPair.publicKey,
        stealthViewingPubKey: stealthViewingKeyPair.publicKey,
        pqPublicKey: '0x',
        oneTimePreKeyCount: 0
      }

      // Create a simple registration message to sign
      const registrationMessage = `POMP Registration: ${address}-${Date.now()}`
      const ethSignature = await signer.signMessage(registrationMessage)

      // Register on chain
      const tx = await registry.registerKeyBundle(
        bundleData,
        ethSignature
      )

      setTxHash(tx.hash)

      // Wait for confirmation
      await tx.wait()

      // Store keys locally
      localStorage.setItem(`pomp-keys-${address}`, JSON.stringify({
        identityPrivateKey: toBase64(identityKeyPair.privateKey),
        identityPublicKey: toBase64(identityKeyPair.publicKey),
        signedPrePrivateKey: toBase64(signedPreKeyPair.privateKey),
        signedPrePublicKey: toBase64(signedPreKeyPair.publicKey),
        stealthSpendingPrivateKey: toBase64(stealthSpendingKeyPair.privateKey),
        stealthSpendingPublicKey: toBase64(stealthSpendingKeyPair.publicKey),
        stealthViewingPrivateKey: toBase64(stealthViewingKeyPair.privateKey),
        stealthViewingPublicKey: toBase64(stealthViewingKeyPair.publicKey),
        identityCommitment: identityCommitment.toString()
      }))

      return tx.hash
    } catch (err) {
      console.error('Registration failed:', err)
      const errorMsg = err instanceof Error ? err.message : 'Registration failed'
      setError(errorMsg)
      return null
    } finally {
      setIsRegistering(false)
    }
  }, [isConnected, address, walletClient])

  return { isRegistering, error, txHash, register }
}

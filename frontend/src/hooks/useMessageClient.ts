'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { Contract } from 'ethers'
import { walletClientToSigner } from '../lib/ethers-adapter'
import { MessageClient } from '../../../src/client'
import { InMemoryRatchetStore } from '../../../src/store'
import { generateKeyPair } from '../../../src/stealth'
import { createPoseidonHasher } from '../../../src/poseidon'
import { toBase64 } from '../../../src/crypto'
import { deployments } from '../contracts'
import StealthRegistryABI from '../contracts/StealthRegistry.abi.json'
import MessageHubABI from '../contracts/MessageHub.abi.json'

// Simple in-memory storage for demo (replace with IPFS in production)
const mockStorage = {
  add: async (data: Uint8Array): Promise<string> => {
    // Store in localStorage with random CID
    const cid = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(`pomp-msg-${cid}`, Buffer.from(data).toString('base64'))
    return cid
  },
  get: async (cid: string): Promise<Uint8Array> => {
    const data = localStorage.getItem(`pomp-msg-${cid}`)
    if (!data) throw new Error(`Message not found: ${cid}`)
    return new Uint8Array(Buffer.from(data, 'base64'))
  }
}

export interface UseMessageClientReturn {
  client: MessageClient | null
  isInitializing: boolean
  error: string | null
  isRegistered: boolean
  register: () => Promise<void>
}

export function useMessageClient(): UseMessageClientReturn {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [client, setClient] = useState<MessageClient | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRegistered, setIsRegistered] = useState(false)

  const register = useCallback(async () => {
    if (!client || !address || !walletClient) {
      setError('Wallet not connected')
      return
    }

    try {
      setError(null)
      const signer = walletClientToSigner(walletClient)

      // Generate key pairs for registration
      const identityKeyPair = generateKeyPair()
      const signedPreKeyPair = generateKeyPair()
      const stealthSpendingKeyPair = generateKeyPair()
      const stealthViewingKeyPair = generateKeyPair()

      // Create signature for signed prekey
      const signedPreKeySignature = await signer.signMessage(
        Buffer.from(signedPreKeyPair.publicKey)
      )

      // Create registry contract instance
      const registry = new Contract(
        deployments.contracts.StealthRegistry,
        StealthRegistryABI,
        signer
      )

      // Compute identity commitment
      const poseidon = await createPoseidonHasher()
      const identityCommitment = poseidon([BigInt('0x' + toBase64(identityKeyPair.publicKey).replace(/[^a-zA-Z0-9]/g, ''))])

      // Register on chain
      const tx = await registry.registerKeyBundle({
        identityKey: identityKeyPair.publicKey,
        signedPreKey: signedPreKeyPair.publicKey,
        signedPreKeySignature: Buffer.from(signedPreKeySignature.slice(2), 'hex'),
        oneTimePreKeyBundleCid: '',
        stealthSpendingPubKey: stealthSpendingKeyPair.publicKey,
        stealthViewingPubKey: stealthViewingKeyPair.publicKey,
        pqPublicKey: '0x',
        oneTimePreKeyCount: 0
      }, await signer.signMessage('pomp-registration'))

      await tx.wait()
      setIsRegistered(true)

      // Store keys locally for future use
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

    } catch (err) {
      console.error('Registration failed:', err)
      setError(err instanceof Error ? err.message : 'Registration failed')
    }
  }, [client, address, walletClient])

  useEffect(() => {
    if (!isConnected || !address || !walletClient) {
      setClient(null)
      setIsRegistered(false)
      return
    }

    const initClient = async () => {
      setIsInitializing(true)
      setError(null)

      try {
        const signer = walletClientToSigner(walletClient)

        // Create contract instances
        const registry = new Contract(
          deployments.contracts.StealthRegistry,
          StealthRegistryABI,
          signer
        ) as any

        const messageHub = new Contract(
          deployments.contracts.MessageHub,
          MessageHubABI,
          signer
        ) as any

        // Check if user is registered
        const keyBundle = await registry.getKeyBundle(address)
        const hasKeys = keyBundle.identityKey && keyBundle.identityKey.length > 0
        setIsRegistered(hasKeys)

        // Load or generate keys
        let keys = null
        const storedKeys = localStorage.getItem(`pomp-keys-${address}`)
        if (storedKeys) {
          keys = JSON.parse(storedKeys)
        } else {
          // Generate new keys
          const identityKeyPair = generateKeyPair()
          const signedPreKeyPair = generateKeyPair()
          const stealthSpendingKeyPair = generateKeyPair()
          const stealthViewingKeyPair = generateKeyPair()

          const poseidon = await createPoseidonHasher()
          const identityCommitment = poseidon([BigInt('0x' + toBase64(identityKeyPair.publicKey).replace(/[^a-zA-Z0-9]/g, ''))])

          keys = {
            identityPrivateKey: toBase64(identityKeyPair.privateKey),
            identityPublicKey: toBase64(identityKeyPair.publicKey),
            signedPrePrivateKey: toBase64(signedPreKeyPair.privateKey),
            signedPrePublicKey: toBase64(signedPreKeyPair.publicKey),
            stealthSpendingPrivateKey: toBase64(stealthSpendingKeyPair.privateKey),
            stealthSpendingPublicKey: toBase64(stealthSpendingKeyPair.publicKey),
            stealthViewingPrivateKey: toBase64(stealthViewingKeyPair.privateKey),
            stealthViewingPublicKey: toBase64(stealthViewingKeyPair.publicKey),
            identityCommitment: identityCommitment.toString()
          }
        }

        // Convert base64 keys back to Uint8Array
        const keyFromBase64 = (b64: string) => {
          const binary = atob(b64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          return bytes
        }

        // Create ratchet store
        const ratchetStore = new InMemoryRatchetStore()

        // Create MessageClient
        const messageClient = new MessageClient({
          registry,
          messageHub,
          storage: mockStorage,
          signer,
          identityKeyPair: {
            privateKey: keyFromBase64(keys.identityPrivateKey),
            publicKey: keyFromBase64(keys.identityPublicKey)
          },
          signedPreKeyPair: {
            privateKey: keyFromBase64(keys.signedPrePrivateKey),
            publicKey: keyFromBase64(keys.signedPrePublicKey)
          },
          stealthSpendingKeyPair: {
            privateKey: keyFromBase64(keys.stealthSpendingPrivateKey),
            publicKey: keyFromBase64(keys.stealthSpendingPublicKey)
          },
          stealthViewingKeyPair: {
            privateKey: keyFromBase64(keys.stealthViewingPrivateKey),
            publicKey: keyFromBase64(keys.stealthViewingPublicKey)
          },
          identityCommitment: BigInt(keys.identityCommitment),
          ratchetStore
        })

        setClient(messageClient)
      } catch (err) {
        console.error('Failed to initialize MessageClient:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize')
      } finally {
        setIsInitializing(false)
      }
    }

    initClient()
  }, [isConnected, address, walletClient])

  return { client, isInitializing, error, isRegistered, register }
}

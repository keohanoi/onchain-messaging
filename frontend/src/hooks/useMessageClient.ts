'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Contract } from 'ethers'
import { useAccountContext } from '../context/AccountContext'
import { useIpfsStorage } from './useIpfsStorage'
import { MessageClient } from '../../../src/client'
import { InMemoryRatchetStore } from '../../../src/store'
import { generateKeyPair } from '../../../src/stealth'
import { createPoseidonHasher } from '../../../src/poseidon'
import { toBase64, fromBase64 } from '../../../src/crypto'
import { deployments } from '../contracts'
import StealthRegistryABI from '../contracts/StealthRegistry.abi.json'
import MessageHubABI from '../contracts/MessageHub.abi.json'
import { StorageClient } from '../../../src/storage'

export interface UseMessageClientReturn {
  client: MessageClient | null
  isInitializing: boolean
  error: string | null
  isRegistered: boolean
  register: () => Promise<void>
  refreshRegistration: () => Promise<void>
  reinitialize: () => void
}

// Serialized key format
interface SerializedKeys {
  identityPrivateKey: string
  identityPublicKey: string
  signedPrePrivateKey: string
  signedPrePublicKey: string
  stealthSpendingPrivateKey: string
  stealthSpendingPublicKey: string
  stealthViewingPrivateKey: string
  stealthViewingPublicKey: string
  identityCommitment: string
}

/**
 * Create a storage adapter that uses IPFS for message payloads
 * Falls back to localStorage when IPFS is not available
 */
function createPayloadStorageAdapter(
  ipfsPut: (path: string, data: Uint8Array) => Promise<string | null>,
  ipfsGet: (path: string) => Promise<Uint8Array | null>
): StorageClient {
  return {
    async add(data: Uint8Array): Promise<string> {
      // Generate a unique CID-like identifier
      const id = `payload-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // Try IPFS first
      const cid = await ipfsPut(`payloads/${id}`, data)
      if (cid) {
        console.log('Stored payload on IPFS:', id)
        return id
      }

      // Fallback to localStorage
      localStorage.setItem(`pomp-msg-${id}`, Buffer.from(data).toString('base64'))
      console.log('Stored payload in localStorage (IPFS unavailable)')
      return id
    },

    async get(id: string): Promise<Uint8Array> {
      // Try IPFS first
      const data = await ipfsGet(`payloads/${id}`)
      if (data) {
        return data
      }

      // Fallback to localStorage
      const stored = localStorage.getItem(`pomp-msg-${id}`)
      if (stored) {
        return new Uint8Array(Buffer.from(stored, 'base64'))
      }

      throw new Error(`Message not found: ${id}`)
    },
  }
}

export function useMessageClient(): UseMessageClientReturn {
  const { address, isConnected, signer, mounted } = useAccountContext()
  const { isReady: ipfsReady, ipfsConnected, put, get, getJson, has } = useIpfsStorage()

  const [client, setClient,] = useState<MessageClient | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRegistered, setIsRegistered] = useState(false)
  const [reinitializeCounter, setReinitializeCounter] = useState(0)

  // Keep refs to latest IPFS functions to avoid stale closures
  const putRef = useRef(put)
  const getRef = useRef(get)
  useEffect(() => {
    putRef.current = put
    getRef.current = get
  }, [put, get])

  const register = useCallback(async () => {
    if (!client || !address || !signer) {
      setError('Wallet not connected')
      return
    }

    try {
      setError(null)

      // Generate key pairs for registration
      const identityKeyPair = generateKeyPair()
      const signedPreKeyPair = generateKeyPair()
      const stealthSpendingKeyPair = generateKeyPair()
      const stealthViewingKeyPair = generateKeyPair()

      // Create signature for signed prekey
      const signedPreKeySignature = await signer.signMessage(Buffer.from(signedPreKeyPair.publicKey))

      // Create registry contract instance
      const registry = new Contract(deployments.contracts.StealthRegistry, StealthRegistryABI, signer)

      // Compute identity commitment
      const poseidon = await createPoseidonHasher()
      const pubKeyHex = Buffer.from(identityKeyPair.publicKey).toString('hex')
      const identityCommitment = poseidon([BigInt('0x' + pubKeyHex.slice(0, 31))])

      // Register on chain
      const tx = await registry.registerKeyBundle(
        {
          identityKey: identityKeyPair.publicKey,
          signedPreKey: signedPreKeyPair.publicKey,
          signedPreKeySignature: Buffer.from(signedPreKeySignature.slice(2), 'hex'),
          oneTimePreKeyBundleCid: '',
          stealthSpendingPubKey: stealthSpendingKeyPair.publicKey,
          stealthViewingPubKey: stealthViewingKeyPair.publicKey,
          pqPublicKey: '0x',
          oneTimePreKeyCount: 0,
        },
        await signer.signMessage('pomp-registration')
      )

      await tx.wait()
      setIsRegistered(true)

      // Store keys to IPFS (or localStorage fallback)
      const keysData: SerializedKeys = {
        identityPrivateKey: toBase64(identityKeyPair.privateKey),
        identityPublicKey: toBase64(identityKeyPair.publicKey),
        signedPrePrivateKey: toBase64(signedPreKeyPair.privateKey),
        signedPrePublicKey: toBase64(signedPreKeyPair.publicKey),
        stealthSpendingPrivateKey: toBase64(stealthSpendingKeyPair.privateKey),
        stealthSpendingPublicKey: toBase64(stealthSpendingKeyPair.publicKey),
        stealthViewingPrivateKey: toBase64(stealthViewingKeyPair.privateKey),
        stealthViewingPublicKey: toBase64(stealthViewingKeyPair.publicKey),
        identityCommitment: identityCommitment.toString(),
      }

      if (ipfsReady) {
        await putRef.current(`keys/${address}`, new TextEncoder().encode(JSON.stringify(keysData)))
        console.log('Stored keys to IPFS')
      } else {
        localStorage.setItem(`pomp-keys-${address}`, JSON.stringify(keysData))
        console.log('Stored keys to localStorage')
      }
    } catch (err) {
      console.error('Registration failed:', err)
      setError(err instanceof Error ? err.message : 'Registration failed')
    }
  }, [client, address, signer, ipfsReady])

  useEffect(() => {
    // Wait for mount to avoid hydration issues
    if (!mounted) {
      return
    }

    if (!isConnected || !address || !signer) {
      setClient(null)
      setIsRegistered(false)
      return
    }

    const initClient = async () => {
      setIsInitializing(true)
      setError(null)

      try {
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
        let hasKeys = false
        try {
          const keyBundle = await registry.getKeyBundle(address)
          // Check if identityKey is a valid hex string with more than just "0x"
          const identityKey = keyBundle.identityKey
          hasKeys = identityKey && identityKey.length > 2 && identityKey !== '0x'
        } catch {
          // User not registered yet - this is expected for new users
          hasKeys = false
        }
        setIsRegistered(hasKeys)

        // Load or generate keys - IPFS only
        let keys: SerializedKeys | null = null

        console.log('useMessageClient: Loading keys for address:', address)
        console.log('useMessageClient: IPFS ready:', ipfsReady)

        if (!ipfsConnected) {
          console.error('useMessageClient: IPFS node not reachable')
          setError('IPFS node not reachable. Please check if IPFS is running at localhost:5001')
          setIsInitializing(false)
          return
        }

        if (!ipfsReady) {
          console.error('useMessageClient: Encrypted storage not initialized')
          setError('Please sign the message in your wallet to enable encrypted storage.')
          setIsInitializing(false)
          return
        }

        // Load keys from IPFS
        try {
          const keysPath = `keys/${address}`
          const hasKeysIpfs = await has(keysPath)
          console.log('useMessageClient: IPFS hasKeys:', hasKeysIpfs)
          if (hasKeysIpfs) {
            const data = await getJson<SerializedKeys>(keysPath)
            if (data) {
              keys = data
              console.log('useMessageClient: Loaded keys from IPFS')
              console.log('useMessageClient: stealthViewingPublicKey preview:', data.stealthViewingPublicKey?.slice(0, 20))
            }
          }
        } catch (err) {
          console.warn('useMessageClient: Failed to load keys from IPFS:', err)
        }

        if (!keys) {
          console.log('useMessageClient: No keys found on IPFS for this address')
          // Don't generate new keys - user needs to register first
          setIsInitializing(false)
          return
        }

        // Generate new keys if none exist
        if (!keys) {
          const identityKeyPair = generateKeyPair()
          const signedPreKeyPair = generateKeyPair()
          const stealthSpendingKeyPair = generateKeyPair()
          const stealthViewingKeyPair = generateKeyPair()

          const poseidon = await createPoseidonHasher()
          const pubKeyHex = Buffer.from(identityKeyPair.publicKey).toString('hex')
          const identityCommitment = poseidon([BigInt('0x' + pubKeyHex.slice(0, 31))])

          keys = {
            identityPrivateKey: toBase64(identityKeyPair.privateKey),
            identityPublicKey: toBase64(identityKeyPair.publicKey),
            signedPrePrivateKey: toBase64(signedPreKeyPair.privateKey),
            signedPrePublicKey: toBase64(signedPreKeyPair.publicKey),
            stealthSpendingPrivateKey: toBase64(stealthSpendingKeyPair.privateKey),
            stealthSpendingPublicKey: toBase64(stealthSpendingKeyPair.publicKey),
            stealthViewingPrivateKey: toBase64(stealthViewingKeyPair.privateKey),
            stealthViewingPublicKey: toBase64(stealthViewingKeyPair.publicKey),
            identityCommitment: identityCommitment.toString(),
          }
        }

        // Convert base64 keys back to Uint8Array
        const keyFromBase64 = (b64: string) => {
          return fromBase64(b64)
        }

        // Create payload storage adapter
        const payloadStorage = createPayloadStorageAdapter(
          async (path, data) => {
            if (ipfsReady) {
              return putRef.current(path, data)
            }
            return null
          },
          async (path) => {
            if (ipfsReady) {
              return getRef.current(path)
            }
            return null
          }
        )

        // Create ratchet store
        const ratchetStore = new InMemoryRatchetStore()

        // Create MessageClient
        const messageClient = new MessageClient({
          registry,
          messageHub,
          storage: payloadStorage,
          signer,
          identityKeyPair: {
            privateKey: keyFromBase64(keys.identityPrivateKey),
            publicKey: keyFromBase64(keys.identityPublicKey),
          },
          signedPreKeyPair: {
            privateKey: keyFromBase64(keys.signedPrePrivateKey),
            publicKey: keyFromBase64(keys.signedPrePublicKey),
          },
          stealthSpendingKeyPair: {
            privateKey: keyFromBase64(keys.stealthSpendingPrivateKey),
            publicKey: keyFromBase64(keys.stealthSpendingPublicKey),
          },
          stealthViewingKeyPair: {
            privateKey: keyFromBase64(keys.stealthViewingPrivateKey),
            publicKey: keyFromBase64(keys.stealthViewingPublicKey),
          },
          identityCommitment: BigInt(keys.identityCommitment),
          ratchetStore,
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
  }, [mounted, isConnected, address, signer, ipfsReady, has, getJson, reinitializeCounter])

  // Force reinitialization after registration (new keys stored)
  const reinitialize = useCallback(() => {
    setReinitializeCounter((c) => c + 1)
  }, [])

  const refreshRegistration = useCallback(async () => {
    if (!address || !signer) {
      console.log('refreshRegistration: missing address or signer')
      return
    }

    try {
      const registry = new Contract(deployments.contracts.StealthRegistry, StealthRegistryABI, signer)

      let hasKeys = false
      try {
        const keyBundle = await registry.getKeyBundle(address)
        console.log('refreshRegistration: keyBundle.identityKey =', keyBundle.identityKey)
        // Check if identityKey is a valid hex string with more than just "0x"
        const identityKey = keyBundle.identityKey
        hasKeys = identityKey && identityKey.length > 2 && identityKey !== '0x'
        console.log('refreshRegistration: hasKeys =', hasKeys)
      } catch (err) {
        console.log('refreshRegistration: caught error, setting hasKeys = false')
        hasKeys = false
      }
      setIsRegistered(hasKeys)
    } catch (err) {
      console.error('Failed to refresh registration status:', err)
    }
  }, [address, signer])

  return { client, isInitializing, error, isRegistered, register, refreshRegistration, reinitialize }
}

'use client'

import { useState, useCallback, useEffect } from 'react'
import { Contract, AbiCoder, keccak256, getBytes } from 'ethers'
import { useAccountContext } from '../context/AccountContext'
import { useIpfsStorage } from './useIpfsStorage'
import { generateKeyPair } from '../../../src/stealth'
import { createPoseidonHasher } from '../../../src/poseidon'
import { toBase64, fromBase64, keccakHash } from '../../../src/crypto'
import { deployments } from '../contracts'
import StealthRegistryABI from '../contracts/StealthRegistry.abi.json'
import { secp256k1 } from '@noble/curves/secp256k1'
import { KeyPair } from '../../../src/types'

export interface StoredKeys {
  identityKeyPair: KeyPair
  signedPreKeyPair: KeyPair
  oneTimePreKeyPairs?: KeyPair[]
  stealthSpendingKeyPair: KeyPair
  stealthViewingKeyPair: KeyPair
  identityCommitment: string
  registered: boolean
}

// Serialized format for storage
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

export interface UseRegisterKeysReturn {
  isRegistering: boolean
  error: string | null
  txHash: string | null
  isReady: boolean
  wrongNetwork: boolean
  register: () => Promise<string | null>
  keys: StoredKeys | null
  setKeys: (keys: StoredKeys) => void
}

/**
 * Compute the bundle hash exactly as the Solidity contract does
 */
function computeBundleHash(
  sender: string,
  bundle: {
    identityKey: Uint8Array
    signedPreKey: Uint8Array
    signedPreKeySignature: Uint8Array
    oneTimePreKeyBundleCid: string
    stealthSpendingPubKey: Uint8Array
    stealthViewingPubKey: Uint8Array
    pqPublicKey: string
    oneTimePreKeyCount: number
  }
): string {
  const abiCoder = AbiCoder.defaultAbiCoder()

  // Match Solidity: abi.encode(sender, identityKey, signedPreKey, signedPreKeySignature)
  const encoded1 = abiCoder.encode(
    ['address', 'bytes', 'bytes', 'bytes'],
    [sender, bundle.identityKey, bundle.signedPreKey, bundle.signedPreKeySignature]
  )

  // Match Solidity: abi.encode(oneTimePreKeyBundleCid, stealthSpendingPubKey, stealthViewingPubKey, pqPublicKey, oneTimePreKeyCount)
  const encoded2 = abiCoder.encode(
    ['string', 'bytes', 'bytes', 'bytes', 'uint256'],
    [
      bundle.oneTimePreKeyBundleCid,
      bundle.stealthSpendingPubKey,
      bundle.stealthViewingPubKey,
      bundle.pqPublicKey,
      bundle.oneTimePreKeyCount
    ]
  )

  // Match Solidity: keccak256(abi.encodePacked(encoded, encoded2))
  // In ethers, concat + keccak256 is equivalent to abi.encodePacked then keccak256
  const combined = Buffer.concat([Buffer.from(encoded1.slice(2), 'hex'), Buffer.from(encoded2.slice(2), 'hex')])
  return keccak256(combined)
}

/**
 * Serialize keys for storage
 */
function serializeKeys(keys: StoredKeys): SerializedKeys {
  return {
    identityPrivateKey: toBase64(keys.identityKeyPair.privateKey),
    identityPublicKey: toBase64(keys.identityKeyPair.publicKey),
    signedPrePrivateKey: toBase64(keys.signedPreKeyPair.privateKey),
    signedPrePublicKey: toBase64(keys.signedPreKeyPair.publicKey),
    stealthSpendingPrivateKey: toBase64(keys.stealthSpendingKeyPair.privateKey),
    stealthSpendingPublicKey: toBase64(keys.stealthSpendingKeyPair.publicKey),
    stealthViewingPrivateKey: toBase64(keys.stealthViewingKeyPair.privateKey),
    stealthViewingPublicKey: toBase64(keys.stealthViewingKeyPair.publicKey),
    identityCommitment: keys.identityCommitment,
  }
}

/**
 * Deserialize keys from storage
 */
function deserializeKeys(data: SerializedKeys): StoredKeys {
  return {
    identityKeyPair: {
      privateKey: fromBase64(data.identityPrivateKey),
      publicKey: fromBase64(data.identityPublicKey),
    },
    signedPreKeyPair: {
      privateKey: fromBase64(data.signedPrePrivateKey),
      publicKey: fromBase64(data.signedPrePublicKey),
    },
    stealthSpendingKeyPair: {
      privateKey: fromBase64(data.stealthSpendingPrivateKey),
      publicKey: fromBase64(data.stealthSpendingPublicKey),
    },
    stealthViewingKeyPair: {
      privateKey: fromBase64(data.stealthViewingPrivateKey),
      publicKey: fromBase64(data.stealthViewingPublicKey),
    },
    identityCommitment: data.identityCommitment,
    registered: true,
  }
}

export function useRegisterKeys(): UseRegisterKeysReturn {
  const { address, isConnected, signer, mounted, isTestMode } = useAccountContext()
  const { isReady: ipfsReady, putJson, getJson, has } = useIpfsStorage()

  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [localMounted, setLocalMounted] = useState(false)
  const [keys, setKeysState] = useState<StoredKeys | null>(null)
  const [keysLoaded, setKeysLoaded] = useState(false)

  // Load keys from IPFS storage on mount
  useEffect(() => {
    if (!localMounted || !address || !ipfsReady || keysLoaded) return

    const loadKeys = async () => {
      try {
        const keysPath = `keys/${address}`
        const hasKeys = await has(keysPath)

        if (hasKeys) {
          const data = await getJson<SerializedKeys>(keysPath)
          if (data) {
            const loadedKeys = deserializeKeys(data)
            setKeysState(loadedKeys)
            console.log('Loaded keys from IPFS')
          }
        }
      } catch (err) {
        console.error('Failed to load stored keys from IPFS:', err)
      } finally {
        setKeysLoaded(true)
      }
    }

    loadKeys()
  }, [localMounted, address, ipfsReady, keysLoaded, getJson, has])

  // Set keys and save to IPFS storage only
  const setKeys = useCallback(
    async (newKeys: StoredKeys) => {
      setKeysState(newKeys)

      if (!address || !ipfsReady) {
        console.error('Cannot save keys: IPFS not ready')
        setError('IPFS storage not connected')
        return
      }

      try {
        const keysPath = `keys/${address}`
        await putJson(keysPath, serializeKeys(newKeys))
        console.log('Saved keys to IPFS')
      } catch (err) {
        console.error('Failed to save keys to IPFS:', err)
        setError('Failed to save keys to IPFS')
      }
    },
    [address, ipfsReady, putJson]
  )

  useEffect(() => {
    setLocalMounted(true)
  }, [])

  // In test mode, we're always on the correct network (Hardhat local)
  // In production, we'd check chainId, but for now we assume Hardhat
  const wrongNetwork = false
  const isReady = localMounted && mounted && isConnected && !!address && !!signer && !wrongNetwork

  // Debug logging
  useEffect(() => {
    if (localMounted && mounted) {
      console.log('useRegisterKeys state:', {
        mounted,
        isConnected,
        address,
        hasSigner: !!signer,
        isTestMode,
        ipfsReady,
        wrongNetwork,
        isReady,
      })
    }
  }, [localMounted, mounted, isConnected, address, signer, isTestMode, ipfsReady, wrongNetwork, isReady])

  const register = useCallback(async (): Promise<string | null> => {
    console.log('register() called', { mounted, isConnected, address, hasSigner: !!signer, isTestMode })

    if (!localMounted || !mounted) {
      setError('Component not mounted')
      return null
    }

    if (!isConnected) {
      setError('Wallet not connected')
      return null
    }

    if (!address || !signer) {
      setError('Account not ready. Please try again.')
      return null
    }

    setIsRegistering(true)
    setError(null)
    setTxHash(null)

    try {
      // Generate key pairs
      const identityKeyPair = generateKeyPair()
      const signedPreKeyPair = generateKeyPair()
      const stealthSpendingKeyPair = generateKeyPair()
      const stealthViewingKeyPair = generateKeyPair()

      // Sign the signed prekey with the IDENTITY PRIVATE KEY (not wallet)
      // This is what X3DH expects - the identity key signs the prekey
      const preKeyHash = Buffer.from(keccakHash(signedPreKeyPair.publicKey).slice(2), 'hex')
      const signature = secp256k1.sign(preKeyHash, identityKeyPair.privateKey)
      // Convert to compact format (64 bytes: r || s)
      const signedPreKeySignature = '0x' + Buffer.from(signature.toCompactRawBytes()).toString('hex')

      // Compute identity commitment using Poseidon hash
      const poseidon = await createPoseidonHasher()
      const pubKeyHex = Buffer.from(identityKeyPair.publicKey).toString('hex')
      const identityCommitment = poseidon([BigInt('0x' + pubKeyHex.slice(0, 32))])

      // Create registry contract instance
      const registry = new Contract(
        deployments.contracts.StealthRegistry,
        StealthRegistryABI,
        signer
      )

      // Build the bundle data
      const bundleData = {
        identityKey: identityKeyPair.publicKey,
        signedPreKey: signedPreKeyPair.publicKey,
        signedPreKeySignature: Buffer.from(signedPreKeySignature.slice(2), 'hex'),
        oneTimePreKeyBundleCid: '',
        stealthSpendingPubKey: stealthSpendingKeyPair.publicKey,
        stealthViewingPubKey: stealthViewingKeyPair.publicKey,
        pqPublicKey: '0x',
        oneTimePreKeyCount: 0,
      }

      // Compute the bundle hash exactly as the contract does
      const bundleHash = computeBundleHash(address, bundleData)

      // Sign the bundle hash (EIP-191)
      const ethSignature = await (signer as any).signMessage(getBytes(bundleHash))

      // Register on chain
      const tx = await registry.registerKeyBundle(bundleData, ethSignature)

      setTxHash(tx.hash)

      // Wait for confirmation
      await tx.wait()

      // Store keys using setKeys (saves to IPFS automatically)
      await setKeys({
        identityKeyPair,
        signedPreKeyPair,
        stealthSpendingKeyPair,
        stealthViewingKeyPair,
        identityCommitment: identityCommitment.toString(),
        registered: true,
      })

      return tx.hash
    } catch (err) {
      console.error('Registration failed:', err)
      const errorMsg = err instanceof Error ? err.message : 'Registration failed'
      setError(errorMsg)
      return null
    } finally {
      setIsRegistering(false)
    }
  }, [localMounted, mounted, isConnected, address, signer, isTestMode, setKeys])

  return { isRegistering, error, txHash, isReady, wrongNetwork, register, keys, setKeys }
}

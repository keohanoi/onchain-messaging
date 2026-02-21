'use client'

import { useState, useCallback } from 'react'
import { useAccountContext } from '../context/AccountContext'
import {
  createBackup,
  restoreBackup,
  createKeyBackupData,
  BackupMetadata,
} from '../../../src/backup'
import { StorageClient } from '../../../src/storage'
import { IpfsStorageAdapter } from '../lib/ipfs-storage-adapter'
import { useRegisterKeys } from './useRegisterKeys'

// For testing without IPFS node, we use a mock storage
class MockStorage implements StorageClient {
  private store = new Map<string, Uint8Array>()

  async add(data: Uint8Array): Promise<string> {
    // Generate a mock CID
    const cid =
      'Qm' +
      Array.from(data.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 44)
    this.store.set(cid, data)
    console.log('MockStorage: Added data with CID:', cid)
    return cid
  }

  async get(cid: string): Promise<Uint8Array> {
    const data = this.store.get(cid)
    if (!data) {
      throw new Error(`CID not found: ${cid}`)
    }
    console.log('MockStorage: Retrieved data for CID:', cid)
    return data
  }
}

// Create storage adapter (IPFS or mock fallback)
const createStorage = (): StorageClient => {
  const ipfsUrl = process.env.NEXT_PUBLIC_IPFS_URL
  if (ipfsUrl) {
    console.log('Using IPFS storage at:', ipfsUrl)
    return new IpfsStorageAdapter({ baseUrl: ipfsUrl })
  }
  console.log('Using mock storage (no IPFS URL configured)')
  return new MockStorage()
}

export interface UseBackupResult {
  // State
  isBackingUp: boolean
  isRestoring: boolean
  backupCid: string | null
  backupTimestamp: number | null
  error: string | null

  // Actions
  backupKeys: () => Promise<string | null>
  restoreKeys: (cid: string) => Promise<boolean>
  clearError: () => void
}

// Local storage key for backup metadata
const BACKUP_META_KEY = 'pomp-backup-meta'

export function useBackup(): UseBackupResult {
  const { address, signer, isTestMode } = useAccountContext()
  const { keys, setKeys } = useRegisterKeys()

  const [isBackingUp, setIsBackingUp] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [backupCid, setBackupCid] = useState<string | null>(null)
  const [backupTimestamp, setBackupTimestamp] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load backup metadata from localStorage on mount
  const getStorageKey = useCallback((base: string) => {
    return isTestMode ? `${base}-test` : `${base}-${address}`
  }, [isTestMode, address])

  // Create encrypted backup and upload to storage
  const backupKeys = useCallback(async (): Promise<string | null> => {
    if (!signer || !address || !keys) {
      setError('No keys to backup or signer not available')
      return null
    }

    setIsBackingUp(true)
    setError(null)

    try {
      // Create storage client
      const storage = createStorage()

      // Create backup data from current keys
      const backupData = createKeyBackupData(
        address,
        31337, // TODO: Get from chain
        keys.identityKeyPair,
        keys.signedPreKeyPair,
        keys.oneTimePreKeyPairs || [],
        keys.stealthSpendingKeyPair,
        keys.stealthViewingKeyPair,
        BigInt(keys.identityCommitment)
      )

      // Create encrypted backup and upload
      const metadata = await createBackup(signer, 31337, backupData, storage)

      // Store backup metadata locally
      const metaKey = getStorageKey(BACKUP_META_KEY)
      localStorage.setItem(metaKey, JSON.stringify(metadata))

      setBackupCid(metadata.cid)
      setBackupTimestamp(metadata.timestamp)

      console.log('Backup created successfully:', metadata)
      return metadata.cid
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backup failed'
      setError(msg)
      console.error('Backup error:', err)
      return null
    } finally {
      setIsBackingUp(false)
    }
  }, [signer, address, keys, getStorageKey])

  // Restore keys from backup
  const restoreKeys = useCallback(async (cid: string): Promise<boolean> => {
    if (!signer || !address) {
      setError('Signer not available')
      return false
    }

    setIsRestoring(true)
    setError(null)

    try {
      // Create storage client
      const storage = createStorage()

      // Download and decrypt backup
      const backupData = await restoreBackup(signer, 31337, cid, storage)

      // Validate address matches
      if (backupData.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Backup address does not match current wallet')
      }

      // Restore keys to state
      setKeys({
        identityKeyPair: backupData.identityKeyPair,
        signedPreKeyPair: backupData.signedPreKeyPair,
        oneTimePreKeyPairs: backupData.oneTimePreKeyPairs,
        stealthSpendingKeyPair: backupData.stealthSpendingKeyPair,
        stealthViewingKeyPair: backupData.stealthViewingKeyPair,
        identityCommitment: backupData.identityCommitment,
        registered: true, // Assume registered if we have backup
      })

      // Store backup metadata
      const metadata: BackupMetadata = {
        cid,
        timestamp: backupData.timestamp,
        address: backupData.address,
      }
      const metaKey = getStorageKey(BACKUP_META_KEY)
      localStorage.setItem(metaKey, JSON.stringify(metadata))

      setBackupCid(cid)
      setBackupTimestamp(backupData.timestamp)

      console.log('Keys restored successfully from backup')
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restore failed'
      setError(msg)
      console.error('Restore error:', err)
      return false
    } finally {
      setIsRestoring(false)
    }
  }, [signer, address, setKeys, getStorageKey])

  const clearError = useCallback(() => setError(null), [])

  return {
    isBackingUp,
    isRestoring,
    backupCid,
    backupTimestamp,
    error,
    backupKeys,
    restoreKeys,
    clearError,
  }
}

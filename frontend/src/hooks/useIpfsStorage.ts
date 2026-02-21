'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccountContext } from '../context/AccountContext'
import { EncryptedIpfsStorage } from '../lib/encrypted-ipfs-storage'
import { IpfsStorageAdapter } from '../lib/ipfs-storage-adapter'

export interface UseIpfsStorageResult {
  isReady: boolean
  isLoading: boolean
  ipfsConnected: boolean
  error: string | null
  storage: EncryptedIpfsStorage | null
  put: (path: string, data: Uint8Array) => Promise<string | null>
  get: (path: string) => Promise<Uint8Array | null>
  putJson: <T>(path: string, data: T) => Promise<string | null>
  getJson: <T>(path: string) => Promise<T | null>
  has: (path: string) => Promise<boolean>
}

/**
 * React hook for encrypted IPFS storage
 *
 * Provides a convenient interface for storing and retrieving encrypted data on IPFS.
 * Automatically initializes with the connected wallet signer.
 */
export function useIpfsStorage(): UseIpfsStorageResult {
  const { address, signer, mounted } = useAccountContext()
  const [storage, setStorage] = useState<EncryptedIpfsStorage | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ipfsConnected, setIpfsConnected] = useState(false)

  // Test IPFS connection on mount (before wallet signature)
  useEffect(() => {
    const testIpfsConnection = async () => {
      const ipfsUrl = process.env.NEXT_PUBLIC_IPFS_URL || 'http://localhost:5001'
      console.log('Testing IPFS connection to:', ipfsUrl)

      try {
        const adapter = new IpfsStorageAdapter({ baseUrl: ipfsUrl })
        // Test by adding and getting a small piece of data
        const testData = new TextEncoder().encode('pomp-ipfs-test')
        const cid = await adapter.add(testData)
        await adapter.get(cid)
        console.log('IPFS connection successful')
        setIpfsConnected(true)
        setError(null)
      } catch (err) {
        console.error('IPFS connection failed:', err)
        setError('Failed to connect to IPFS node at ' + ipfsUrl)
        setIpfsConnected(false)
      }
    }

    testIpfsConnection()
  }, [])

  // Initialize encrypted storage when wallet connects
  useEffect(() => {
    if (!address || !signer || !mounted || !ipfsConnected) {
      setStorage(null)
      return
    }

    const ipfsUrl = process.env.NEXT_PUBLIC_IPFS_URL || 'http://localhost:5001'
    const newStorage = new EncryptedIpfsStorage(ipfsUrl)

    setIsLoading(true)
    setError(null)

    newStorage
      .initialize(signer)
      .then(() => {
        setStorage(newStorage)
        console.log('IPFS storage initialized for:', address)
      })
      .catch((err) => {
        console.error('Failed to initialize IPFS storage:', err)
        setError(err instanceof Error ? err.message : 'Failed to initialize storage')
      })
      .finally(() => {
        setIsLoading(false)
      })

    // Cleanup on unmount or address change
    return () => {
      setStorage(null)
    }
  }, [address, signer, mounted, ipfsConnected])

  const put = useCallback(
    async (path: string, data: Uint8Array): Promise<string | null> => {
      if (!storage) {
        setError('Storage not initialized')
        return null
      }
      try {
        setError(null)
        return await storage.put(path, data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Storage put failed'
        setError(msg)
        console.error('IPFS put error:', err)
        return null
      }
    },
    [storage]
  )

  const get = useCallback(
    async (path: string): Promise<Uint8Array | null> => {
      if (!storage) {
        setError('Storage not initialized')
        return null
      }
      try {
        setError(null)
        return await storage.get(path)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Storage get failed'
        setError(msg)
        console.error('IPFS get error:', err)
        return null
      }
    },
    [storage]
  )

  const putJson = useCallback(
    async <T,>(path: string, data: T): Promise<string | null> => {
      if (!storage) {
        setError('Storage not initialized')
        return null
      }
      try {
        setError(null)
        return await storage.putJson(path, data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Storage putJson failed'
        setError(msg)
        console.error('IPFS putJson error:', err)
        return null
      }
    },
    [storage]
  )

  const getJson = useCallback(
    async <T,>(path: string): Promise<T | null> => {
      if (!storage) {
        setError('Storage not initialized')
        return null
      }
      try {
        setError(null)
        return await storage.getJson<T>(path)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Storage getJson failed'
        setError(msg)
        console.error('IPFS getJson error:', err)
        return null
      }
    },
    [storage]
  )

  const has = useCallback(
    async (path: string): Promise<boolean> => {
      if (!storage) {
        return false
      }
      try {
        return await storage.has(path)
      } catch {
        return false
      }
    },
    [storage]
  )

  return {
    isReady: !!storage,
    isLoading,
    ipfsConnected,
    error,
    storage,
    put,
    get,
    putJson,
    getJson,
    has,
  }
}

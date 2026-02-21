'use client'

import { Signer } from 'ethers'
import { IpfsStorageAdapter } from './ipfs-storage-adapter'

// Cache for encryption keys to avoid repeated wallet signatures
const encryptionKeyCache = new Map<string, { key: CryptoKey; timestamp: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

// Session storage key for signature caching
const SIGNATURE_STORAGE_KEY = 'pomp-encryption-sig'

/**
 * Get cached signature from sessionStorage
 */
function getCachedSignature(address: string): string | null {
  try {
    const cached = sessionStorage.getItem(`${SIGNATURE_STORAGE_KEY}-${address}`)
    if (cached) {
      const { signature, timestamp } = JSON.parse(cached)
      // Check if cache is still valid (24 hours)
      if (Date.now() - timestamp < CACHE_TTL) {
        return signature
      }
    }
  } catch {
    // Ignore errors
  }
  return null
}

/**
 * Cache signature in sessionStorage
 */
function cacheSignature(address: string, signature: string): void {
  try {
    sessionStorage.setItem(
      `${SIGNATURE_STORAGE_KEY}-${address}`,
      JSON.stringify({ signature, timestamp: Date.now() })
    )
  } catch {
    // Ignore errors (e.g., private browsing mode)
  }
}

/**
 * Derive encryption key from wallet signature
 * Uses PBKDF2 with the signature as key material
 * Caches the signature to avoid repeated wallet interactions
 */
async function deriveEncryptionKey(signer: Signer): Promise<CryptoKey> {
  const address = await signer.getAddress()

  // Check memory cache first
  const cached = encryptionKeyCache.get(address)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.key
  }

  // Check session storage for cached signature
  let signature = getCachedSignature(address)

  if (!signature) {
    // Request signature from wallet
    const message = 'Authorize POMP encrypted storage access\n\nThis signature will be cached for this session to reduce wallet interactions.'
    signature = await signer.signMessage(message)

    // Cache the signature
    cacheSignature(address, signature)
  }

  // Use first 64 chars of signature as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signature.slice(0, 64)),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  // Derive AES-256-GCM key using PBKDF2
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('pomp-ipfs-encryption-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Cache in memory
  encryptionKeyCache.set(address, { key, timestamp: Date.now() })

  return key
}

/**
 * User manifest tracking all data CIDs on IPFS
 */
interface UserManifest {
  version: number
  address: string
  lastUpdated: number
  entries: {
    keys: string | null // CID for encrypted keys
    conversations: string | null // CID for conversation list
    messages: string | null // CID for message history
    config: string | null // CID for config (test mode, etc.)
    payloads: Record<string, string> // message CID -> payload CID
  }
  manifestHistory: string[] // Previous manifest CIDs for recovery
}

/**
 * Encrypted IPFS Storage with user manifest tracking
 *
 * All data is encrypted with AES-256-GCM before being stored on IPFS.
 * A manifest tracks all CIDs and is stored on IPFS itself.
 * The manifest CID is stored in localStorage as a pointer (minimal localStorage use).
 */
export class EncryptedIpfsStorage {
  private adapter: IpfsStorageAdapter
  private encryptionKey: CryptoKey | null = null
  private manifest: UserManifest | null = null
  private manifestCid: string | null = null
  private address: string | null = null

  constructor(ipfsUrl: string) {
    this.adapter = new IpfsStorageAdapter({ baseUrl: ipfsUrl })
  }

  /**
   * Initialize storage with wallet signer
   * Loads existing manifest from IPFS or creates a new one
   */
  async initialize(signer: Signer): Promise<void> {
    this.encryptionKey = await deriveEncryptionKey(signer)
    this.address = await signer.getAddress()

    // Try to load existing manifest from localStorage pointer
    const manifestPointer = localStorage.getItem(`pomp-manifest-${this.address}`)
    if (manifestPointer) {
      try {
        const decryptedManifest = await this.getDecrypted(manifestPointer)
        this.manifest = JSON.parse(new TextDecoder().decode(decryptedManifest))
        this.manifestCid = manifestPointer
        console.log('Loaded existing manifest from IPFS:', this.manifestCid)
      } catch (error) {
        console.warn('Failed to load manifest, creating new one:', error)
        // Manifest corrupt or key changed, create new
      }
    }

    // Create new manifest if none exists
    if (!this.manifest) {
      this.manifest = {
        version: 1,
        address: this.address,
        lastUpdated: Date.now(),
        entries: {
          keys: null,
          conversations: null,
          messages: null,
          config: null,
          payloads: {},
        },
        manifestHistory: [],
      }
      console.log('Created new manifest')
    }
  }

  /**
   * Encrypt data with AES-256-GCM
   */
  private async encrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.encryptionKey) {
      throw new Error('Storage not initialized - call initialize() first')
    }

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      data.buffer as ArrayBuffer
    )

    // Prepend IV to ciphertext
    return new Uint8Array([...iv, ...new Uint8Array(encrypted)])
  }

  /**
   * Decrypt data with AES-256-GCM
   */
  private async decrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.encryptionKey) {
      throw new Error('Storage not initialized - call initialize() first')
    }

    const iv = data.slice(0, 12)
    const encrypted = data.slice(12)

    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.encryptionKey, encrypted.buffer as ArrayBuffer)
    )
  }

  /**
   * Get decrypted data from IPFS by CID
   */
  private async getDecrypted(cid: string): Promise<Uint8Array> {
    const encrypted = await this.adapter.get(cid)
    return this.decrypt(encrypted)
  }

  /**
   * Store data at a given path
   * Path format: /type/name (e.g., /keys/address, /payloads/cid)
   */
  async put(path: string, data: Uint8Array): Promise<string> {
    if (!this.manifest) {
      throw new Error('Storage not initialized - call initialize() first')
    }

    // Encrypt and upload to IPFS
    const encrypted = await this.encrypt(data)
    const cid = await this.adapter.add(encrypted)

    // Update manifest
    const parts = path.split('/').filter(Boolean)
    const type = parts[0]
    const name = parts[1]

    if (type === 'payloads' && name) {
      // Payloads are stored in a map
      this.manifest.entries.payloads[name] = cid
    } else if (type === 'keys') {
      this.manifest.entries.keys = cid
    } else if (type === 'conversations') {
      this.manifest.entries.conversations = cid
    } else if (type === 'messages') {
      this.manifest.entries.messages = cid
    } else if (type === 'config') {
      this.manifest.entries.config = cid
    }

    this.manifest.lastUpdated = Date.now()

    // Save updated manifest
    await this.saveManifest()

    console.log(`Stored ${path} on IPFS:`, cid)
    return cid
  }

  /**
   * Retrieve data from a given path
   */
  async get(path: string): Promise<Uint8Array> {
    if (!this.manifest) {
      throw new Error('Storage not initialized - call initialize() first')
    }

    const parts = path.split('/').filter(Boolean)
    const type = parts[0]
    const name = parts[1]

    let cid: string | null = null

    if (type === 'payloads' && name) {
      cid = this.manifest.entries.payloads[name] || null
    } else if (type === 'keys') {
      cid = this.manifest.entries.keys
    } else if (type === 'conversations') {
      cid = this.manifest.entries.conversations
    } else if (type === 'messages') {
      cid = this.manifest.entries.messages
    } else if (type === 'config') {
      cid = this.manifest.entries.config
    }

    if (!cid) {
      throw new Error(`No data at path: ${path}`)
    }

    return this.getDecrypted(cid)
  }

  /**
   * Check if data exists at a given path
   */
  async has(path: string): Promise<boolean> {
    if (!this.manifest) {
      return false
    }

    const parts = path.split('/').filter(Boolean)
    const type = parts[0]
    const name = parts[1]

    if (type === 'payloads' && name) {
      return !!this.manifest.entries.payloads[name]
    } else if (type === 'keys') {
      return !!this.manifest.entries.keys
    } else if (type === 'conversations') {
      return !!this.manifest.entries.conversations
    } else if (type === 'messages') {
      return !!this.manifest.entries.messages
    } else if (type === 'config') {
      return !!this.manifest.entries.config
    }

    return false
  }

  /**
   * Store JSON data at a given path
   */
  async putJson<T>(path: string, data: T): Promise<string> {
    const encoded = new TextEncoder().encode(JSON.stringify(data))
    return this.put(path, encoded)
  }

  /**
   * Retrieve JSON data from a given path
   */
  async getJson<T>(path: string): Promise<T> {
    const data = await this.get(path)
    return JSON.parse(new TextDecoder().decode(data))
  }

  /**
   * Get the current manifest CID
   */
  getManifestCid(): string | null {
    return this.manifestCid
  }

  /**
   * Get manifest history for recovery
   */
  getManifestHistory(): string[] {
    return this.manifest?.manifestHistory || []
  }

  /**
   * Save the manifest to IPFS and update localStorage pointer
   */
  private async saveManifest(): Promise<void> {
    if (!this.manifest) {
      throw new Error('No manifest to save')
    }

    const data = new TextEncoder().encode(JSON.stringify(this.manifest))
    const encrypted = await this.encrypt(data)
    const newCid = await this.adapter.add(encrypted)

    // Track history for recovery
    if (this.manifestCid) {
      this.manifest.manifestHistory.push(this.manifestCid)
      // Keep only last 10 manifests in history
      if (this.manifest.manifestHistory.length > 10) {
        this.manifest.manifestHistory = this.manifest.manifestHistory.slice(-10)
      }
    }

    this.manifestCid = newCid

    // Store pointer in localStorage (minimal use)
    localStorage.setItem(`pomp-manifest-${this.manifest.address}`, newCid)

    console.log('Saved manifest to IPFS:', newCid)
  }

  /**
   * Restore from a previous manifest CID
   */
  async restoreFromManifest(cid: string): Promise<boolean> {
    try {
      const decryptedManifest = await this.getDecrypted(cid)
      const manifest = JSON.parse(new TextDecoder().decode(decryptedManifest)) as UserManifest

      // Validate manifest belongs to current user
      if (manifest.address.toLowerCase() !== this.address?.toLowerCase()) {
        throw new Error('Manifest belongs to different address')
      }

      this.manifest = manifest
      this.manifestCid = cid
      localStorage.setItem(`pomp-manifest-${this.address}`, cid)

      console.log('Restored from manifest:', cid)
      return true
    } catch (error) {
      console.error('Failed to restore from manifest:', error)
      return false
    }
  }

  /**
   * Clear cached encryption key for this address
   * Call this on logout or when re-authentication is needed
   */
  clearCache(): void {
    if (this.address) {
      encryptionKeyCache.delete(this.address)
      try {
        sessionStorage.removeItem(`${SIGNATURE_STORAGE_KEY}-${this.address}`)
      } catch {
        // Ignore errors
      }
    }
  }
}

/**
 * Clear all cached encryption keys and signatures
 * Call this on logout
 */
export function clearAllEncryptionCaches(): void {
  encryptionKeyCache.clear()
  try {
    // Clear all signature caches
    const keysToRemove: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(SIGNATURE_STORAGE_KEY)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key))
  } catch {
    // Ignore errors
  }
}

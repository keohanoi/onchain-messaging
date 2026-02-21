'use client'

export interface StorageClient {
  add(data: Uint8Array): Promise<string>
  get(cidOrId: string): Promise<Uint8Array>
}

export interface IpfsConfig {
  baseUrl: string
  timeout?: number
}

/**
 * IPFS Storage Adapter using fetch API
 *
 * Uses Kubo RPC API v0 for communication with IPFS node.
 * This avoids bundling issues with ipfs-http-client in Next.js.
 */
export class IpfsStorageAdapter implements StorageClient {
  private config: IpfsConfig

  constructor(config: IpfsConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    }
  }

  /**
   * Add data to IPFS and return the CID
   */
  async add(data: Uint8Array): Promise<string> {
    const formData = new FormData()
    // Convert Uint8Array to ArrayBuffer for Blob compatibility
    formData.append('file', new Blob([data.buffer as ArrayBuffer]))

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(`${this.config.baseUrl}/api/v0/add`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      return result.Hash
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('IPFS add request timed out')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Retrieve data from IPFS by CID
   */
  async get(cid: string): Promise<Uint8Array> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(
        `${this.config.baseUrl}/api/v0/cat?arg=${cid}`,
        {
          method: 'POST',
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        throw new Error(`IPFS get failed: ${response.status} ${response.statusText}`)
      }

      const buffer = await response.arrayBuffer()
      return new Uint8Array(buffer)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('IPFS get request timed out')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Pin a CID to the local node
   */
  async pin(cid: string): Promise<void> {
    const response = await fetch(
      `${this.config.baseUrl}/api/v0/pin/add?arg=${cid}`,
      { method: 'POST' }
    )

    if (!response.ok) {
      throw new Error(`IPFS pin failed: ${response.status} ${response.statusText}`)
    }
  }
}

/**
 * Create an IPFS storage adapter
 */
export function createIpfsStorageAdapter(baseUrl: string): IpfsStorageAdapter {
  return new IpfsStorageAdapter({ baseUrl })
}

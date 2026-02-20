import { StorageClient } from '../../src/storage';
import { RatchetState } from '../../src/types';

/**
 * In-memory mock storage client for testing
 */
export class MockStorageClient implements StorageClient {
  private storage = new Map<string, Uint8Array>();
  private cidCounter = 0;

  async add(data: Uint8Array): Promise<string> {
    const cid = `mock-cid-${this.cidCounter++}`;
    this.storage.set(cid, data);
    return cid;
  }

  async get(cid: string): Promise<Uint8Array> {
    const data = this.storage.get(cid);
    if (!data) {
      throw new Error(`CID not found: ${cid}`);
    }
    return data;
  }

  /**
   * Check if a CID exists
   */
  has(cid: string): boolean {
    return this.storage.has(cid);
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.storage.clear();
    this.cidCounter = 0;
  }
}

/**
 * Create a minimal valid ratchet state for testing
 */
export function createTestRatchetState(overrides: Partial<RatchetState> = {}): RatchetState {
  const dhPair = {
    privateKey: new Uint8Array(32).fill(1),
    publicKey: new Uint8Array(33).fill(2)
  };

  return {
    rootKey: new Uint8Array(32).fill(3),
    sendChainKey: new Uint8Array(32).fill(4),
    recvChainKey: new Uint8Array(32).fill(5),
    dhPair,
    sendCount: 0,
    recvCount: 0,
    skippedKeys: [],
    version: 0,
    ...overrides
  };
}

/**
 * Create a mock X3DH PQ encapsulate function
 */
export function createMockPQEncapsulate() {
  return (pk: Uint8Array) => {
    return {
      sharedSecret: new Uint8Array(32).fill(0x42),
      ciphertext: new Uint8Array(32).fill(0x43)
    };
  };
}

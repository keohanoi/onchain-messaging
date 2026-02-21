"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryRatchetStore = void 0;
/**
 * In-memory ratchet store with mutex locks for race condition prevention
 * HIGH FIX #7: Added locking to prevent concurrent state corruption
 */
class InMemoryRatchetStore {
    constructor() {
        this.store = new Map();
        this.locks = new Map();
    }
    async load(peerId) {
        return this.store.get(peerId);
    }
    async save(peerId, state) {
        // Increment version for optimistic locking
        const existing = this.store.get(peerId);
        state.version = (existing?.version ?? 0) + 1;
        this.store.set(peerId, state);
    }
    /**
     * Acquire a lock for a peer's ratchet state
     * Returns a release function that must be called when done
     * HIGH FIX #7: Prevents race conditions in concurrent message handling
     */
    async lock(peerId) {
        // Wait for any existing lock to be released
        while (this.locks.has(peerId)) {
            await this.locks.get(peerId);
        }
        // Create new lock
        let releaseLock;
        const lockPromise = new Promise((resolve) => {
            releaseLock = resolve;
        });
        this.locks.set(peerId, lockPromise);
        // Return release function
        return () => {
            this.locks.delete(peerId);
            releaseLock();
        };
    }
    /**
     * Update ratchet state with lock (convenience method)
     * HIGH FIX #7: Atomic load-modify-save with locking
     */
    async update(peerId, updater) {
        const release = await this.lock(peerId);
        try {
            const existing = await this.load(peerId);
            const newState = updater(existing);
            await this.save(peerId, newState);
            return newState;
        }
        finally {
            release();
        }
    }
    /**
     * Update ratchet state with lock, returning additional result data
     * HIGH FIX #7: Extended version for operations that produce output
     */
    async updateWithResult(peerId, updater) {
        const release = await this.lock(peerId);
        try {
            const existing = await this.load(peerId);
            const { result, state: newState } = updater(existing);
            await this.save(peerId, newState);
            return { result, state: newState };
        }
        finally {
            release();
        }
    }
    /**
     * Optimistic locking update - will retry if version mismatch
     * HIGH FIX #7: Alternative approach using version numbers
     */
    async optimisticUpdate(peerId, updater, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const existing = await this.load(peerId);
            const expectedVersion = existing?.version ?? 0;
            const newState = updater(existing);
            newState.version = expectedVersion + 1;
            // Check if version changed during update (in single-threaded JS this is unlikely,
            // but included for completeness and for future async storage backends)
            const current = this.store.get(peerId);
            if ((current?.version ?? 0) === expectedVersion) {
                this.store.set(peerId, newState);
                return newState;
            }
            // Version mismatch, retry
            await new Promise(resolve => setTimeout(resolve, 10 * attempt));
        }
        throw new Error(`Failed to update ratchet state after ${maxRetries} retries`);
    }
}
exports.InMemoryRatchetStore = InMemoryRatchetStore;

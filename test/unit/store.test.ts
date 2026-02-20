import { describe, it, expect } from 'vitest';
import { InMemoryRatchetStore } from '../../src/store';
import { createTestRatchetState } from '../fixtures/mocks';

describe('store', () => {
  describe('InMemoryRatchetStore', () => {
    describe('load/save', () => {
      it('should save and load ratchet state', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState();
        const peerId = 'peer-123';

        await store.save(peerId, state);
        const loaded = await store.load(peerId);

        expect(loaded).toBeDefined();
        expect(loaded?.rootKey).toEqual(state.rootKey);
        expect(loaded?.sendCount).toBe(state.sendCount);
      });

      it('should return undefined for unknown peer', async () => {
        const store = new InMemoryRatchetStore();

        const loaded = await store.load('unknown-peer');

        expect(loaded).toBeUndefined();
      });

      it('should overwrite existing state on save', async () => {
        const store = new InMemoryRatchetStore();
        const state1 = createTestRatchetState({ sendCount: 5 });
        const state2 = createTestRatchetState({ sendCount: 10 });
        const peerId = 'peer-456';

        await store.save(peerId, state1);
        await store.save(peerId, state2);
        const loaded = await store.load(peerId);

        expect(loaded?.sendCount).toBe(10);
        expect(loaded?.version).toBeGreaterThan(state1.version!);
      });

      it('should increment version on save', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState({ version: 0 });
        const peerId = 'peer-789';

        await store.save(peerId, state);
        let loaded = await store.load(peerId);
        expect(loaded?.version).toBe(1);

        await store.save(peerId, loaded!);
        loaded = await store.load(peerId);
        expect(loaded?.version).toBe(2);
      });
    });

    describe('lock', () => {
      it('should acquire and release lock', async () => {
        const store = new InMemoryRatchetStore();
        const peerId = 'peer-lock-test';

        const release = await store.lock(peerId);

        // Lock should be acquired
        expect(release).toBeInstanceOf(Function);

        // Release should work without error
        release();
      });

      it('should serialize concurrent access', async () => {
        const store = new InMemoryRatchetStore();
        const peerId = 'peer-concurrent';
        const order: number[] = [];

        // Start multiple operations that need the lock
        const operations = Promise.all([
          (async () => {
            const release = await store.lock(peerId);
            order.push(1);
            await new Promise((r) => setTimeout(r, 50));
            order.push(2);
            release();
          })(),
          (async () => {
            const release = await store.lock(peerId);
            order.push(3);
            await new Promise((r) => setTimeout(r, 50));
            order.push(4);
            release();
          })()
        ]);

        await operations;

        // Operations should be serialized, not interleaved
        // Either [1, 2, 3, 4] or [3, 4, 1, 2]
        const isSerialized =
          (order[0] < order[1] && order[2] < order[3] && order[1] < order[2]) ||
          (order[2] < order[3] && order[0] < order[1] && order[3] < order[0]);

        expect(isSerialized).toBe(true);
      });
    });

    describe('update', () => {
      it('should atomically load-modify-save', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState({ sendCount: 0 });
        const peerId = 'peer-update';

        await store.save(peerId, state);

        const newState = await store.update(peerId, (existing) => {
          return {
            ...existing!,
            sendCount: existing!.sendCount + 1
          };
        });

        expect(newState.sendCount).toBe(1);

        const loaded = await store.load(peerId);
        expect(loaded?.sendCount).toBe(1);
      });

      it('should handle missing state in update', async () => {
        const store = new InMemoryRatchetStore();
        const peerId = 'peer-missing';

        const newState = await store.update(peerId, (existing) => {
          expect(existing).toBeUndefined();
          return createTestRatchetState({ sendCount: 100 });
        });

        expect(newState.sendCount).toBe(100);
      });

      it('should hold lock during update', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState();
        const peerId = 'peer-lock-update';

        await store.save(peerId, state);

        // Start a long-running update
        let updateCompleted = false;
        const updatePromise = store.update(peerId, async (existing) => {
          await new Promise((r) => setTimeout(r, 100));
          updateCompleted = true;
          return { ...existing!, sendCount: 999 };
        });

        // Try to acquire lock in parallel - should wait
        let lockAcquired = false;
        const lockPromise = store.lock(peerId).then((release) => {
          lockAcquired = true;
          release();
        });

        // Wait a bit - update should not be complete yet
        await new Promise((r) => setTimeout(r, 50));
        expect(updateCompleted).toBe(false);

        // After update completes, lock should be available
        await updatePromise;
        expect(updateCompleted).toBe(true);

        // Now lock can be acquired
        await lockPromise;
        expect(lockAcquired).toBe(true);
      });
    });

    describe('updateWithResult', () => {
      it('should return result and update state', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState();
        const peerId = 'peer-result';

        await store.save(peerId, state);

        const { result, state: newState } = await store.updateWithResult(
          peerId,
          (existing) => {
            return {
              result: { message: 'encrypted data', count: existing!.sendCount },
              state: { ...existing!, sendCount: existing!.sendCount + 1 }
            };
          }
        );

        expect(result.message).toBe('encrypted data');
        expect(result.count).toBe(0);
        expect(newState.sendCount).toBe(1);
      });
    });

    describe('optimisticUpdate', () => {
      it('should update state with version check', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState({ version: 0 });
        const peerId = 'peer-optimistic';

        await store.save(peerId, state);

        const newState = await store.optimisticUpdate(peerId, (existing) => {
          return { ...existing!, sendCount: 50 };
        });

        expect(newState.sendCount).toBe(50);
        // Version is incremented by save() inside optimisticUpdate
        expect(newState.version).toBeGreaterThan(0);
      });

      it('should retry on version mismatch', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState({ version: 0 });
        const peerId = 'peer-retry';

        await store.save(peerId, state);

        // Simulate concurrent modification between load and save
        let attemptCount = 0;
        const newState = await store.optimisticUpdate(
          peerId,
          (existing) => {
            attemptCount++;
            if (attemptCount === 1) {
              // Simulate concurrent modification
              store['store'].set(peerId, { ...existing!, version: 99 });
            }
            return { ...existing!, sendCount: 75 };
          },
          3
        );

        // Should have retried and succeeded
        expect(attemptCount).toBe(2);
        expect(newState.sendCount).toBe(75);
      });

      it('should throw after max retries', async () => {
        const store = new InMemoryRatchetStore();
        const state = createTestRatchetState({ version: 0 });
        const peerId = 'peer-max-retries';

        await store.save(peerId, state);

        // Always fail version check
        await expect(
          store.optimisticUpdate(
            peerId,
            (existing) => {
              // Always modify version externally
              store['store'].set(peerId, { ...existing!, version: Date.now() });
              return { ...existing!, sendCount: 1 };
            },
            2
          )
        ).rejects.toThrow('Failed to update ratchet state after 2 retries');
      });
    });
  });
});

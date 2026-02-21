"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRatchet = initRatchet;
exports.dhRatchet = dhRatchet;
exports.ratchetEncrypt = ratchetEncrypt;
exports.ratchetDecrypt = ratchetDecrypt;
exports.pruneSkippedKeys = pruneSkippedKeys;
const secp256k1_1 = require("@noble/curves/secp256k1");
const crypto_1 = require("./crypto");
// Maximum number of skipped message keys to cache
const MAX_SKIP = 1000;
// Auto-pruning threshold for skipped keys
const MAX_SKIPPED_KEYS = 500;
// MEDIUM FIX #2: Use byte values for domain separation (Signal Protocol spec)
// Signal uses 0x01, 0x02 rather than string constants
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
const CHAIN_KEY_SEED = new Uint8Array([0x02]);
const HEADER_KEY_SEED = new Uint8Array([0x03]);
const NEXT_HEADER_KEY_SEED = new Uint8Array([0x04]);
/**
 * MEDIUM FIX #2: Chain key derivation using byte constants
 * Following Signal Protocol specification more closely
 */
function kdfChain(chainKey) {
    const messageKey = (0, crypto_1.hmacSha256)(chainKey, MESSAGE_KEY_SEED);
    const nextChainKey = (0, crypto_1.hmacSha256)(chainKey, CHAIN_KEY_SEED);
    const headerKey = (0, crypto_1.hmacSha256)(chainKey, HEADER_KEY_SEED);
    return { messageKey, nextChainKey, headerKey };
}
/**
 * MEDIUM FIX #1: Root key derivation using HKDF (Signal Protocol spec)
 * Signal uses HKDF for root key updates, not plain HMAC
 */
function kdfRoot(rootKey, dhOut) {
    // Use HKDF for proper extract-then-expand
    const derived = (0, crypto_1.hkdfSha256)(dhOut, rootKey, new TextEncoder().encode("POMP_RATCHET"), 64 // Derive 64 bytes: 32 for root key, 32 for chain key
    );
    return {
        newRootKey: derived.slice(0, 32),
        newChainKey: derived.slice(32, 64)
    };
}
function initRatchet(sessionKey, dhPair, isInitiator = true) {
    // CRITICAL FIX: Use a constant salt derived from the session key
    // DO NOT include dhPair.publicKey in the salt - both parties must derive
    // the SAME initial chain keys from the SAME session key
    const salt = new Uint8Array(32); // Zero salt for initial derivation
    // Derive initial chain keys using HKDF for proper key separation
    // Both parties will derive the SAME chain keys from the SAME session key
    const derived = (0, crypto_1.hkdfSha256)(sessionKey, salt, new TextEncoder().encode("POMP_INIT"), 64);
    let sendChainKey = derived.slice(0, 32);
    let recvChainKey = derived.slice(32, 64);
    // CRITICAL FIX: For Double Ratchet, responder must swap send/recv chain keys
    // so that initiator's sendChainKey = responder's recvChainKey
    // This is per Signal Protocol specification
    if (!isInitiator) {
        [sendChainKey, recvChainKey] = [recvChainKey, sendChainKey];
    }
    console.log('initRatchet:', {
        isInitiator,
        sessionKeySlice: Buffer.from(sessionKey).toString('hex').slice(0, 16),
        sendChainKeySlice: Buffer.from(sendChainKey).toString('hex').slice(0, 16),
        recvChainKeySlice: Buffer.from(recvChainKey).toString('hex').slice(0, 16),
        dhPubKey: Buffer.from(dhPair.publicKey).toString('hex').slice(0, 16)
    });
    return {
        rootKey: sessionKey,
        sendChainKey,
        recvChainKey,
        dhPair,
        sendCount: 0,
        recvCount: 0,
        skippedKeys: [],
        version: 0
    };
}
function dhRatchet(state, theirDhPub) {
    const dhOut = secp256k1_1.secp256k1.getSharedSecret(state.dhPair.privateKey, theirDhPub, true);
    // SECURITY FIX: Derive separate send and receive chain keys
    // Per Signal Protocol, each party derives independent chain keys
    const derived = (0, crypto_1.hkdfSha256)(dhOut, state.rootKey, new TextEncoder().encode("POMP_DH_RATCHET"), 96 // 32 for root key, 32 for send chain, 32 for recv chain
    );
    const newRootKey = derived.slice(0, 32);
    const newSendChainKey = derived.slice(32, 64);
    const newRecvChainKey = derived.slice(64, 96);
    const newPriv = new Uint8Array(secp256k1_1.secp256k1.utils.randomPrivateKey());
    const newDhPair = {
        privateKey: newPriv,
        publicKey: secp256k1_1.secp256k1.getPublicKey(newPriv, true)
    };
    return {
        rootKey: newRootKey,
        sendChainKey: newSendChainKey,
        recvChainKey: newRecvChainKey,
        dhPair: newDhPair,
        theirDhPub,
        sendCount: 0,
        recvCount: 0,
        skippedKeys: state.skippedKeys || [],
        version: (state.version ?? 0) + 1
    };
}
function ratchetEncrypt(state, plaintext, aad // HIGH FIX #4: Optional AAD parameter
) {
    const { messageKey, nextChainKey, headerKey } = kdfChain(state.sendChainKey);
    // HIGH FIX #4: Include AAD (ratchet header) for integrity
    const header = {
        dhPub: (0, crypto_1.toBase64)(state.dhPair.publicKey),
        msgIndex: state.sendCount,
        prevChainLen: state.recvCount
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const effectiveAad = aad ? new Uint8Array([...headerBytes, ...aad]) : headerBytes;
    const { ciphertext, iv, tag } = (0, crypto_1.aesGcmEncrypt)(plaintext, messageKey.slice(0, 32), effectiveAad);
    const newState = {
        ...state,
        sendChainKey: nextChainKey,
        sendCount: state.sendCount + 1
    };
    return { ciphertext, header, state: newState, iv, tag, messageKey, headerKey };
}
/**
 * Decrypt a message with support for out-of-order messages
 * Implements the Signal Double Ratchet algorithm with message key caching
 * HIGH FIX #4: Added AAD support for message integrity
 */
function ratchetDecrypt(state, header, ciphertext, iv, tag, aad // Optional additional authenticated data
) {
    const senderDh = (0, crypto_1.fromBase64)(header.dhPub);
    const senderDhBase64 = header.dhPub;
    // Ensure skipped keys array exists
    let skippedKeys = state.skippedKeys || [];
    // Step 1: Check if message key is already cached (out-of-order message)
    const cachedKeyIndex = skippedKeys.findIndex(sk => sk.dhPub === senderDhBase64 && sk.msgIndex === header.msgIndex);
    if (cachedKeyIndex !== -1) {
        // Found cached key - use it
        const cachedKey = skippedKeys[cachedKeyIndex];
        skippedKeys = skippedKeys.filter((_, i) => i !== cachedKeyIndex);
        // HIGH FIX #4: Include AAD for integrity verification
        const headerBytes = new TextEncoder().encode(JSON.stringify(header));
        const effectiveAad = aad ? new Uint8Array([...headerBytes, ...aad]) : headerBytes;
        const plaintext = (0, crypto_1.aesGcmDecrypt)(ciphertext, cachedKey.messageKey.slice(0, 32), iv, tag, effectiveAad);
        return {
            plaintext,
            state: { ...state, skippedKeys }
        };
    }
    // Step 2: Check if DH ratchet step is needed
    let workingState = state;
    const senderDhBytes = senderDh;
    const needsDhRatchet = state.theirDhPub !== undefined &&
        Buffer.compare(Buffer.from(senderDhBytes), Buffer.from(state.theirDhPub)) !== 0;
    console.log('ratchetDecrypt:', {
        hasTheirDhPub: state.theirDhPub !== undefined,
        needsDhRatchet,
        recvCount: state.recvCount,
        headerMsgIndex: header.msgIndex,
        recvChainKeySlice: Buffer.from(state.recvChainKey).toString('hex').slice(0, 16)
    });
    if (needsDhRatchet) {
        // Step 3: Skip message keys from previous chain if needed
        const skipCount = header.prevChainLen !== undefined
            ? Math.max(0, header.prevChainLen - workingState.recvCount)
            : 0;
        if (skipCount > MAX_SKIP) {
            throw new Error("Skip limit exceeded"); // Reduced error verbosity
        }
        // Cache skipped message keys from current chain before ratchet
        for (let i = 0; i < skipCount; i++) {
            const { messageKey, nextChainKey } = kdfChain(workingState.recvChainKey);
            if (skippedKeys.length < MAX_SKIP) {
                skippedKeys.push({
                    dhPub: (0, crypto_1.toBase64)(state.theirDhPub || new Uint8Array()),
                    msgIndex: workingState.recvCount + i,
                    messageKey
                });
            }
            workingState = { ...workingState, recvChainKey: nextChainKey };
        }
        // Perform DH ratchet step
        workingState = dhRatchet(workingState, senderDhBytes);
        workingState.skippedKeys = skippedKeys;
    }
    // Step 4: Skip message keys in new chain if needed
    const expectedIndex = workingState.recvCount;
    const actualIndex = header.msgIndex;
    if (actualIndex < expectedIndex) {
        throw new Error("Message index before expected"); // Reduced error verbosity
    }
    const skipInNewChain = actualIndex - expectedIndex;
    if (skipInNewChain > MAX_SKIP) {
        throw new Error("Skip limit exceeded"); // Reduced error verbosity
    }
    // Cache skipped keys in current chain
    for (let i = 0; i < skipInNewChain; i++) {
        const { messageKey, nextChainKey } = kdfChain(workingState.recvChainKey);
        if (skippedKeys.length < MAX_SKIP) {
            skippedKeys.push({
                dhPub: senderDhBase64,
                msgIndex: expectedIndex + i,
                messageKey
            });
        }
        workingState = { ...workingState, recvChainKey: nextChainKey };
    }
    // Step 5: Derive message key and decrypt
    const { messageKey, nextChainKey } = kdfChain(workingState.recvChainKey);
    // HIGH FIX #4: Include AAD for integrity verification
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const effectiveAad = aad ? new Uint8Array([...headerBytes, ...aad]) : headerBytes;
    const plaintext = (0, crypto_1.aesGcmDecrypt)(ciphertext, messageKey.slice(0, 32), iv, tag, effectiveAad);
    const newState = {
        ...workingState,
        recvChainKey: nextChainKey,
        recvCount: actualIndex + 1,
        skippedKeys,
        version: (workingState.version ?? 0) + 1
    };
    // SECURITY FIX: Auto-prune skipped keys to prevent memory exhaustion
    if (newState.skippedKeys && newState.skippedKeys.length > MAX_SKIPPED_KEYS) {
        newState.skippedKeys = newState.skippedKeys.slice(-MAX_SKIPPED_KEYS);
    }
    return { plaintext, state: newState };
}
/**
 * Clear old skipped message keys (call periodically to prevent memory bloat)
 */
function pruneSkippedKeys(state, maxAge = 100) {
    if (!state.skippedKeys || state.skippedKeys.length <= maxAge) {
        return state;
    }
    // Keep only the most recent keys
    const prunedKeys = state.skippedKeys.slice(-maxAge);
    return { ...state, skippedKeys: prunedKeys };
}

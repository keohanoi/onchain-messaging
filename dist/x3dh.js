"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.x3dhInitiator = x3dhInitiator;
exports.x3dhResponder = x3dhResponder;
const secp256k1_1 = require("@noble/curves/secp256k1");
const crypto_1 = require("./crypto");
function concatBytes(chunks) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}
/**
 * Validate that a public key is a valid point on secp256k1
 * @param key Compressed or uncompressed public key bytes
 * @throws Error if key is invalid
 */
function validatePublicKey(key, context) {
    try {
        // Try to decompress/parse the point - will throw if invalid
        const point = secp256k1_1.secp256k1.ProjectivePoint.fromHex(key);
        // Verify it's on the curve
        point.assertValidity();
    }
    catch {
        throw new Error(`Invalid public key in ${context}`);
    }
}
/**
 * Verify the signed prekey signature using the identity key
 * SECURITY: Per Signal X3DH spec, the initiator MUST verify the signed prekey signature
 * @param identityKey The recipient's identity public key (verifying key)
 * @param signedPreKey The signed prekey to verify
 * @param signature The signature over the signed prekey (64 bytes, compact format)
 * @throws Error if signature verification fails
 */
function verifySignedPreKeySignature(identityKey, signedPreKey, signature) {
    try {
        // Signature should be 64 bytes (compact r || s format)
        if (signature.length !== 64) {
            throw new Error(`Invalid signature length: expected 64, got ${signature.length}`);
        }
        // Hash the signed prekey to get the message hash
        const msgHash = Buffer.from((0, crypto_1.keccakHash)(signedPreKey).slice(2), "hex");
        // Verify the signature using the identity key
        const valid = secp256k1_1.secp256k1.verify(signature, msgHash, identityKey);
        if (!valid) {
            throw new Error("Signature verification failed");
        }
    }
    catch (e) {
        throw new Error(`Signed prekey signature verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
}
/**
 * Derive HKDF salt from identity keys for domain separation
 * This provides key separation between different sessions
 */
function deriveSalt(identityKeyA, identityKeyB) {
    // Use keccak256 of concatenated identity keys as salt
    // This ensures different salts for different party pairs
    const saltHex = (0, crypto_1.keccakHash)(concatBytes([identityKeyA, identityKeyB]));
    return new Uint8Array(Buffer.from(saltHex.slice(2), "hex"));
}
function x3dhInitiator(myIdentity, recipientBundle, pqEncapsulate) {
    // Validate all public keys (CRITICAL FIX #6: Public key validation)
    validatePublicKey(recipientBundle.identityKey, "recipient identity key");
    validatePublicKey(recipientBundle.signedPreKey, "recipient signed prekey");
    if (recipientBundle.oneTimePreKey) {
        validatePublicKey(recipientBundle.oneTimePreKey, "recipient one-time prekey");
    }
    // SECURITY: Verify signed prekey signature per Signal X3DH specification
    // The initiator MUST verify that the signed prekey was actually signed by the recipient
    if (recipientBundle.signedPreKeySignature) {
        verifySignedPreKeySignature(recipientBundle.identityKey, recipientBundle.signedPreKey, recipientBundle.signedPreKeySignature);
    }
    else {
        throw new Error("Signed prekey signature is required");
    }
    const ephemeralPriv = new Uint8Array(secp256k1_1.secp256k1.utils.randomPrivateKey());
    const ephemeralKeyPair = {
        privateKey: ephemeralPriv,
        publicKey: secp256k1_1.secp256k1.getPublicKey(ephemeralPriv, true)
    };
    // X3DH per Signal Protocol spec:
    // DH1 = DH(IK_A, IK_B)
    // DH2 = DH(IK_A, SPK_B)
    // DH3 = DH(EK_A, IK_B)
    // DH4 = DH(EK_A, SPK_B)
    // DH5 = DH(EK_A, OPK_B) -- CRITICAL FIX #5: Changed from IK_A to EK_A
    const dh1 = secp256k1_1.secp256k1.getSharedSecret(myIdentity.privateKey, recipientBundle.identityKey, true);
    const dh2 = secp256k1_1.secp256k1.getSharedSecret(myIdentity.privateKey, recipientBundle.signedPreKey, true);
    const dh3 = secp256k1_1.secp256k1.getSharedSecret(ephemeralKeyPair.privateKey, recipientBundle.identityKey, true);
    const dh4 = secp256k1_1.secp256k1.getSharedSecret(ephemeralKeyPair.privateKey, recipientBundle.signedPreKey, true);
    const dhValues = [dh1, dh2, dh3, dh4];
    // CRITICAL FIX #5: DH5 should use EK_A (ephemeral key), not IK_A (identity key)
    // This ensures forward secrecy for the one-time pre-key component
    if (recipientBundle.oneTimePreKey) {
        const dh5 = secp256k1_1.secp256k1.getSharedSecret(ephemeralKeyPair.privateKey, // FIXED: was myIdentity.privateKey
        recipientBundle.oneTimePreKey, true);
        dhValues.push(dh5);
    }
    // CRITICAL FIX #6: Use proper derived salt instead of empty salt
    const salt = deriveSalt(myIdentity.publicKey, recipientBundle.identityKey);
    let sharedSecret = (0, crypto_1.hkdfSha256)(concatBytes(dhValues), salt, new TextEncoder().encode("POMP_X3DH"), 32);
    // DEBUG: Log session key derivation for initiator
    console.log('X3DH Initiator:', {
        myIdentityPub: Buffer.from(myIdentity.publicKey).toString('hex').slice(0, 16),
        recipientIdentityPub: Buffer.from(recipientBundle.identityKey).toString('hex').slice(0, 16),
        recipientSignedPreKey: Buffer.from(recipientBundle.signedPreKey).toString('hex').slice(0, 16),
        ephemeralPub: Buffer.from(ephemeralKeyPair.publicKey).toString('hex').slice(0, 16),
        salt: Buffer.from(salt).toString('hex').slice(0, 16),
        sessionKey: Buffer.from(sharedSecret).toString('hex').slice(0, 32),
        dh1Length: dh1.length,
        dh2Length: dh2.length,
        dh3Length: dh3.length,
        dh4Length: dh4.length
    });
    let pqCiphertext;
    if (recipientBundle.pqPublicKey && pqEncapsulate) {
        const pq = pqEncapsulate(recipientBundle.pqPublicKey);
        pqCiphertext = pq.ciphertext;
        // Use same derived salt for PQX3DH
        sharedSecret = (0, crypto_1.hkdfSha256)(concatBytes([sharedSecret, pq.sharedSecret]), salt, new TextEncoder().encode("POMP_PQX3DH"), 32);
    }
    // MEDIUM FIX #3: Return the one-time prekey index if used
    return {
        sharedSecret,
        ephemeralKeyPair,
        pqCiphertext,
        usedOneTimePreKeyIndex: recipientBundle.oneTimePreKey ? recipientBundle.oneTimePreKeyIndex : undefined
    };
}
function x3dhResponder(input) {
    // Validate sender's public keys (CRITICAL FIX #6: Public key validation)
    validatePublicKey(input.senderIdentityKey, "sender identity key");
    validatePublicKey(input.senderEphemeralKey, "sender ephemeral key");
    // X3DH responder computes same DH values from their perspective:
    // DH1 = DH(IK_B, IK_A) = DH(IK_A, IK_B)
    // DH2 = DH(SPK_B, IK_A) = DH(IK_A, SPK_B)
    // DH3 = DH(IK_B, EK_A) = DH(EK_A, IK_B)
    // DH4 = DH(SPK_B, EK_A) = DH(EK_A, SPK_B)
    // DH5 = DH(OPK_B, EK_A) = DH(EK_A, OPK_B)
    const dh1 = secp256k1_1.secp256k1.getSharedSecret(input.recipientIdentityPriv, input.senderIdentityKey, true);
    const dh2 = secp256k1_1.secp256k1.getSharedSecret(input.recipientSignedPreKeyPriv, input.senderIdentityKey, true);
    const dh3 = secp256k1_1.secp256k1.getSharedSecret(input.recipientIdentityPriv, input.senderEphemeralKey, true);
    const dh4 = secp256k1_1.secp256k1.getSharedSecret(input.recipientSignedPreKeyPriv, input.senderEphemeralKey, true);
    const dhValues = [dh1, dh2, dh3, dh4];
    // DH5: OPK_B * EK_A (matches initiator's EK_A * OPK_B)
    if (input.recipientOneTimePreKeyPriv) {
        const dh5 = secp256k1_1.secp256k1.getSharedSecret(input.recipientOneTimePreKeyPriv, input.senderEphemeralKey, // Uses ephemeral key (correct)
        true);
        dhValues.push(dh5);
    }
    // CRITICAL FIX #6: Use proper derived salt
    // SECURITY FIX: Salt must use (initiatorIdentity, responderIdentity) to match initiator
    // Initiator uses: deriveSalt(myIdentity.publicKey, recipientBundle.identityKey)
    // Responder uses: deriveSalt(senderIdentityKey, recipientIdentityPub)
    const salt = deriveSalt(input.senderIdentityKey, input.recipientIdentityPub);
    let sharedSecret = (0, crypto_1.hkdfSha256)(concatBytes(dhValues), salt, new TextEncoder().encode("POMP_X3DH"), 32);
    // DEBUG: Log session key derivation for responder
    console.log('X3DH Responder:', {
        senderIdentityPub: Buffer.from(input.senderIdentityKey).toString('hex').slice(0, 16),
        senderEphemeralPub: Buffer.from(input.senderEphemeralKey).toString('hex').slice(0, 16),
        myIdentityPub: Buffer.from(input.recipientIdentityPub).toString('hex').slice(0, 16),
        salt: Buffer.from(salt).toString('hex').slice(0, 16),
        sessionKey: Buffer.from(sharedSecret).toString('hex').slice(0, 32),
        dh1Length: dh1.length,
        dh2Length: dh2.length,
        dh3Length: dh3.length,
        dh4Length: dh4.length
    });
    if (input.pqSharedSecret) {
        sharedSecret = (0, crypto_1.hkdfSha256)(concatBytes([sharedSecret, input.pqSharedSecret]), salt, new TextEncoder().encode("POMP_PQX3DH"), 32);
    }
    return sharedSecret;
}

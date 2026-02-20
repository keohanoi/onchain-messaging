import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdfSha256, keccakHash } from "./crypto";
import { KeyBundle, KeyPair } from "./types";

export type PQEncapsulate = (pk: Uint8Array) => {
  sharedSecret: Uint8Array;
  ciphertext: Uint8Array;
};

export interface X3DHInitiatorResult {
  sharedSecret: Uint8Array;
  ephemeralKeyPair: KeyPair;
  pqCiphertext?: Uint8Array;
  usedOneTimePreKeyIndex?: number;  // MEDIUM FIX #3: Track which prekey was used
}

export interface X3DHResponderInput {
  senderIdentityKey: Uint8Array;
  senderEphemeralKey: Uint8Array;
  recipientIdentityPriv: Uint8Array;
  recipientIdentityPub: Uint8Array;  // CRITICAL FIX: Added for proper salt derivation
  recipientSignedPreKeyPriv: Uint8Array;
  recipientOneTimePreKeyPriv?: Uint8Array;
  pqSharedSecret?: Uint8Array;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
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
function validatePublicKey(key: Uint8Array, context: string): void {
  try {
    // Try to decompress/parse the point - will throw if invalid
    const point = secp256k1.ProjectivePoint.fromHex(key);
    // Verify it's on the curve
    point.assertValidity();
  } catch {
    throw new Error(`Invalid public key in ${context}`);
  }
}

/**
 * Derive HKDF salt from identity keys for domain separation
 * This provides key separation between different sessions
 */
function deriveSalt(
  identityKeyA: Uint8Array,
  identityKeyB: Uint8Array
): Uint8Array {
  // Use keccak256 of concatenated identity keys as salt
  // This ensures different salts for different party pairs
  const saltHex = keccakHash(concatBytes([identityKeyA, identityKeyB]));
  return new Uint8Array(Buffer.from(saltHex.slice(2), "hex"));
}

export function x3dhInitiator(
  myIdentity: KeyPair,
  recipientBundle: KeyBundle,
  pqEncapsulate?: PQEncapsulate
): X3DHInitiatorResult {
  // Validate all public keys (CRITICAL FIX #6: Public key validation)
  validatePublicKey(recipientBundle.identityKey, "recipient identity key");
  validatePublicKey(recipientBundle.signedPreKey, "recipient signed prekey");
  if (recipientBundle.oneTimePreKey) {
    validatePublicKey(recipientBundle.oneTimePreKey, "recipient one-time prekey");
  }

  const ephemeralPriv = new Uint8Array(secp256k1.utils.randomPrivateKey());
  const ephemeralKeyPair: KeyPair = {
    privateKey: ephemeralPriv,
    publicKey: secp256k1.getPublicKey(ephemeralPriv, true)
  };

  // X3DH per Signal Protocol spec:
  // DH1 = DH(IK_A, IK_B)
  // DH2 = DH(IK_A, SPK_B)
  // DH3 = DH(EK_A, IK_B)
  // DH4 = DH(EK_A, SPK_B)
  // DH5 = DH(EK_A, OPK_B) -- CRITICAL FIX #5: Changed from IK_A to EK_A

  const dh1 = secp256k1.getSharedSecret(
    myIdentity.privateKey,
    recipientBundle.identityKey,
    true
  );
  const dh2 = secp256k1.getSharedSecret(
    myIdentity.privateKey,
    recipientBundle.signedPreKey,
    true
  );
  const dh3 = secp256k1.getSharedSecret(
    ephemeralKeyPair.privateKey,
    recipientBundle.identityKey,
    true
  );
  const dh4 = secp256k1.getSharedSecret(
    ephemeralKeyPair.privateKey,
    recipientBundle.signedPreKey,
    true
  );
  const dhValues = [dh1, dh2, dh3, dh4];

  // CRITICAL FIX #5: DH5 should use EK_A (ephemeral key), not IK_A (identity key)
  // This ensures forward secrecy for the one-time pre-key component
  if (recipientBundle.oneTimePreKey) {
    const dh5 = secp256k1.getSharedSecret(
      ephemeralKeyPair.privateKey,  // FIXED: was myIdentity.privateKey
      recipientBundle.oneTimePreKey,
      true
    );
    dhValues.push(dh5);
  }

  // CRITICAL FIX #6: Use proper derived salt instead of empty salt
  const salt = deriveSalt(myIdentity.publicKey, recipientBundle.identityKey);

  let sharedSecret = hkdfSha256(
    concatBytes(dhValues),
    salt,
    new TextEncoder().encode("POMP_X3DH"),
    32
  );

  let pqCiphertext: Uint8Array | undefined;
  if (recipientBundle.pqPublicKey && pqEncapsulate) {
    const pq = pqEncapsulate(recipientBundle.pqPublicKey);
    pqCiphertext = pq.ciphertext;
    // Use same derived salt for PQX3DH
    sharedSecret = hkdfSha256(
      concatBytes([sharedSecret, pq.sharedSecret]),
      salt,
      new TextEncoder().encode("POMP_PQX3DH"),
      32
    );
  }

  // MEDIUM FIX #3: Return the one-time prekey index if used
  return {
    sharedSecret,
    ephemeralKeyPair,
    pqCiphertext,
    usedOneTimePreKeyIndex: recipientBundle.oneTimePreKey ? recipientBundle.oneTimePreKeyIndex : undefined
  };
}

export function x3dhResponder(input: X3DHResponderInput): Uint8Array {
  // Validate sender's public keys (CRITICAL FIX #6: Public key validation)
  validatePublicKey(input.senderIdentityKey, "sender identity key");
  validatePublicKey(input.senderEphemeralKey, "sender ephemeral key");

  // X3DH responder computes same DH values from their perspective:
  // DH1 = DH(IK_B, IK_A) = DH(IK_A, IK_B)
  // DH2 = DH(SPK_B, IK_A) = DH(IK_A, SPK_B)
  // DH3 = DH(IK_B, EK_A) = DH(EK_A, IK_B)
  // DH4 = DH(SPK_B, EK_A) = DH(EK_A, SPK_B)
  // DH5 = DH(OPK_B, EK_A) = DH(EK_A, OPK_B)

  const dh1 = secp256k1.getSharedSecret(
    input.recipientIdentityPriv,
    input.senderIdentityKey,
    true
  );
  const dh2 = secp256k1.getSharedSecret(
    input.recipientSignedPreKeyPriv,
    input.senderIdentityKey,
    true
  );
  const dh3 = secp256k1.getSharedSecret(
    input.recipientIdentityPriv,
    input.senderEphemeralKey,
    true
  );
  const dh4 = secp256k1.getSharedSecret(
    input.recipientSignedPreKeyPriv,
    input.senderEphemeralKey,
    true
  );

  const dhValues = [dh1, dh2, dh3, dh4];
  // DH5: OPK_B * EK_A (matches initiator's EK_A * OPK_B)
  if (input.recipientOneTimePreKeyPriv) {
    const dh5 = secp256k1.getSharedSecret(
      input.recipientOneTimePreKeyPriv,
      input.senderEphemeralKey,  // Uses ephemeral key (correct)
      true
    );
    dhValues.push(dh5);
  }

  // CRITICAL FIX #6: Use proper derived salt
  // SECURITY FIX: Salt must use (initiatorIdentity, responderIdentity) to match initiator
  // Initiator uses: deriveSalt(myIdentity.publicKey, recipientBundle.identityKey)
  // Responder uses: deriveSalt(senderIdentityKey, recipientIdentityPub)
  const salt = deriveSalt(input.senderIdentityKey, input.recipientIdentityPub);

  let sharedSecret = hkdfSha256(
    concatBytes(dhValues),
    salt,
    new TextEncoder().encode("POMP_X3DH"),
    32
  );

  if (input.pqSharedSecret) {
    sharedSecret = hkdfSha256(
      concatBytes([sharedSecret, input.pqSharedSecret]),
      salt,
      new TextEncoder().encode("POMP_PQX3DH"),
      32
    );
  }

  return sharedSecret;
}

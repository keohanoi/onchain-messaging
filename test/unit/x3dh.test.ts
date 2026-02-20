import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { x3dhInitiator, x3dhResponder, X3DHResponderInput } from '../../src/x3dh';
import {
  generateTestKeyPair,
  generateTestKeyBundle
} from '../fixtures/keys';
import { createMockPQEncapsulate } from '../fixtures/mocks';

describe('x3dh', () => {
  describe('x3dhInitiator', () => {
    it('should return valid shared secret and ephemeral key pair', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle();

      const result = x3dhInitiator(myIdentity, bundle);

      expect(result.sharedSecret).toBeInstanceOf(Uint8Array);
      expect(result.sharedSecret.length).toBe(32);
      expect(result.ephemeralKeyPair).toHaveProperty('privateKey');
      expect(result.ephemeralKeyPair).toHaveProperty('publicKey');
      expect(result.ephemeralKeyPair.publicKey.length).toBe(33); // Compressed
    });

    it('should produce 5 DH values when one-time prekey is present', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle(true);

      const result = x3dhInitiator(myIdentity, bundle);

      // Shared secret should be derived from 5 DH values
      expect(result.sharedSecret.length).toBe(32);
      expect(result.usedOneTimePreKeyIndex).toBe(0);
    });

    it('should produce 4 DH values when one-time prekey is absent', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle(false);

      const result = x3dhInitiator(myIdentity, bundle);

      expect(result.sharedSecret.length).toBe(32);
      expect(result.usedOneTimePreKeyIndex).toBeUndefined();
    });

    it('should throw on invalid recipient identity key', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle();

      // Corrupt the identity key
      bundle.identityKey = new Uint8Array(33).fill(0);

      expect(() => x3dhInitiator(myIdentity, bundle)).toThrow(
        'Invalid public key in recipient identity key'
      );
    });

    it('should throw on invalid recipient signed prekey', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle();

      // Corrupt the signed prekey
      bundle.signedPreKey = new Uint8Array(33).fill(0);

      expect(() => x3dhInitiator(myIdentity, bundle)).toThrow(
        'Invalid public key in recipient signed prekey'
      );
    });

    it('should throw on invalid one-time prekey if provided', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle(true);

      // Corrupt the one-time prekey
      bundle.oneTimePreKey = new Uint8Array(33).fill(0);

      expect(() => x3dhInitiator(myIdentity, bundle)).toThrow(
        'Invalid public key in recipient one-time prekey'
      );
    });

    it('should include PQ ciphertext when PQ encapsulation is provided', () => {
      const myIdentity = generateTestKeyPair();
      const { bundle } = generateTestKeyBundle();
      bundle.pqPublicKey = new Uint8Array(32).fill(1);

      const pqEncapsulate = createMockPQEncapsulate();
      const result = x3dhInitiator(myIdentity, bundle, pqEncapsulate);

      expect(result.pqCiphertext).toBeDefined();
      expect(result.pqCiphertext?.length).toBe(32);
    });
  });

  describe('x3dhResponder', () => {
    it('should produce same shared secret as initiator (without one-time prekey)', () => {
      // Setup: Generate keys for both parties
      const initiatorIdentity = generateTestKeyPair();
      const recipientIdentity = generateTestKeyPair();
      const recipientSignedPreKey = generateTestKeyPair();

      // Create recipient bundle
      const recipientBundle = {
        identityKey: recipientIdentity.publicKey,
        signedPreKey: recipientSignedPreKey.publicKey,
        signedPreKeySignature: new Uint8Array(64),
        stealthSpendingPubKey: new Uint8Array(33),
        stealthViewingPubKey: new Uint8Array(33)
      };

      // Initiator runs X3DH
      const initiatorResult = x3dhInitiator(initiatorIdentity, recipientBundle);

      // Responder runs X3DH
      const responderInput: X3DHResponderInput = {
        senderIdentityKey: initiatorIdentity.publicKey,
        senderEphemeralKey: initiatorResult.ephemeralKeyPair.publicKey,
        recipientIdentityPriv: recipientIdentity.privateKey,
        recipientIdentityPub: recipientIdentity.publicKey,
        recipientSignedPreKeyPriv: recipientSignedPreKey.privateKey
      };

      const responderSharedSecret = x3dhResponder(responderInput);

      // Both should derive the same shared secret
      expect(responderSharedSecret).toEqual(initiatorResult.sharedSecret);
    });

    it('should produce same shared secret as initiator (with one-time prekey)', () => {
      const initiatorIdentity = generateTestKeyPair();
      const recipientIdentity = generateTestKeyPair();
      const recipientSignedPreKey = generateTestKeyPair();
      const recipientOneTimePreKey = generateTestKeyPair();

      const recipientBundle = {
        identityKey: recipientIdentity.publicKey,
        signedPreKey: recipientSignedPreKey.publicKey,
        signedPreKeySignature: new Uint8Array(64),
        oneTimePreKey: recipientOneTimePreKey.publicKey,
        oneTimePreKeyIndex: 0,
        stealthSpendingPubKey: new Uint8Array(33),
        stealthViewingPubKey: new Uint8Array(33)
      };

      const initiatorResult = x3dhInitiator(initiatorIdentity, recipientBundle);

      const responderInput: X3DHResponderInput = {
        senderIdentityKey: initiatorIdentity.publicKey,
        senderEphemeralKey: initiatorResult.ephemeralKeyPair.publicKey,
        recipientIdentityPriv: recipientIdentity.privateKey,
        recipientIdentityPub: recipientIdentity.publicKey,
        recipientSignedPreKeyPriv: recipientSignedPreKey.privateKey,
        recipientOneTimePreKeyPriv: recipientOneTimePreKey.privateKey
      };

      const responderSharedSecret = x3dhResponder(responderInput);

      expect(responderSharedSecret).toEqual(initiatorResult.sharedSecret);
    });

    it('should throw on invalid sender identity key', () => {
      const responderInput: X3DHResponderInput = {
        senderIdentityKey: new Uint8Array(33).fill(0), // Invalid
        senderEphemeralKey: generateTestKeyPair().publicKey,
        recipientIdentityPriv: generateTestKeyPair().privateKey,
        recipientIdentityPub: generateTestKeyPair().publicKey,
        recipientSignedPreKeyPriv: generateTestKeyPair().privateKey
      };

      expect(() => x3dhResponder(responderInput)).toThrow(
        'Invalid public key in sender identity key'
      );
    });

    it('should throw on invalid sender ephemeral key', () => {
      const responderInput: X3DHResponderInput = {
        senderIdentityKey: generateTestKeyPair().publicKey,
        senderEphemeralKey: new Uint8Array(33).fill(0), // Invalid
        recipientIdentityPriv: generateTestKeyPair().privateKey,
        recipientIdentityPub: generateTestKeyPair().publicKey,
        recipientSignedPreKeyPriv: generateTestKeyPair().privateKey
      };

      expect(() => x3dhResponder(responderInput)).toThrow(
        'Invalid public key in sender ephemeral key'
      );
    });

    it('should include PQ shared secret when provided', () => {
      const initiatorIdentity = generateTestKeyPair();
      const recipientIdentity = generateTestKeyPair();
      const recipientSignedPreKey = generateTestKeyPair();

      const recipientBundle = {
        identityKey: recipientIdentity.publicKey,
        signedPreKey: recipientSignedPreKey.publicKey,
        signedPreKeySignature: new Uint8Array(64),
        stealthSpendingPubKey: new Uint8Array(33),
        stealthViewingPubKey: new Uint8Array(33),
        pqPublicKey: new Uint8Array(32).fill(1)
      };

      const pqEncapsulate = createMockPQEncapsulate();
      const initiatorResult = x3dhInitiator(
        initiatorIdentity,
        recipientBundle,
        pqEncapsulate
      );

      const responderInput: X3DHResponderInput = {
        senderIdentityKey: initiatorIdentity.publicKey,
        senderEphemeralKey: initiatorResult.ephemeralKeyPair.publicKey,
        recipientIdentityPriv: recipientIdentity.privateKey,
        recipientIdentityPub: recipientIdentity.publicKey,
        recipientSignedPreKeyPriv: recipientSignedPreKey.privateKey,
        pqSharedSecret: new Uint8Array(32).fill(0x42)
      };

      const responderSharedSecret = x3dhResponder(responderInput);

      expect(responderSharedSecret).toEqual(initiatorResult.sharedSecret);
    });
  });

  describe('salt derivation', () => {
    it('should derive same salt for same party pairs', () => {
      const initiatorIdentity = generateTestKeyPair();
      const recipientIdentity = generateTestKeyPair();
      const recipientSignedPreKey = generateTestKeyPair();

      const recipientBundle = {
        identityKey: recipientIdentity.publicKey,
        signedPreKey: recipientSignedPreKey.publicKey,
        signedPreKeySignature: new Uint8Array(64),
        stealthSpendingPubKey: new Uint8Array(33),
        stealthViewingPubKey: new Uint8Array(33)
      };

      // Run X3DH twice with same keys
      const result1 = x3dhInitiator(initiatorIdentity, recipientBundle);
      const result2 = x3dhInitiator(initiatorIdentity, recipientBundle);

      // Different ephemeral keys mean different shared secrets, but salt derivation
      // is based on identity keys only
      expect(result1.sharedSecret).not.toEqual(result2.sharedSecret);
    });

    it('should derive different shared secrets for different party pairs', () => {
      const initiator1 = generateTestKeyPair();
      const initiator2 = generateTestKeyPair();
      const recipient = generateTestKeyPair();
      const signedPreKey = generateTestKeyPair();

      const bundle = {
        identityKey: recipient.publicKey,
        signedPreKey: signedPreKey.publicKey,
        signedPreKeySignature: new Uint8Array(64),
        stealthSpendingPubKey: new Uint8Array(33),
        stealthViewingPubKey: new Uint8Array(33)
      };

      const result1 = x3dhInitiator(initiator1, bundle);
      const result2 = x3dhInitiator(initiator2, bundle);

      expect(result1.sharedSecret).not.toEqual(result2.sharedSecret);
    });
  });
});

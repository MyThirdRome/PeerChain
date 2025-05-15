/**
 * Key management utilities for DoucyA blockchain
 */

'use strict';

const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const crypto = require('crypto');
const config = require('../config');

class Keys {
  /**
   * Generate a new key pair
   * @returns {Object} Object containing publicKey and privateKey
   */
  static generateKeyPair() {
    const keyPair = ec.genKeyPair();
    return {
      publicKey: keyPair.getPublic('hex'),
      privateKey: keyPair.getPrivate('hex')
    };
  }

  /**
   * Get public key from private key
   * @param {string} privateKey - Private key in hex format
   * @returns {string} Public key in hex format
   */
  static getPublicKey(privateKey) {
    const keyPair = ec.keyFromPrivate(privateKey);
    return keyPair.getPublic('hex');
  }

  /**
   * Sign data with private key
   * @param {string} data - Data to sign
   * @param {string} privateKey - Private key in hex format
   * @returns {string} Signature in hex format
   */
  static sign(data, privateKey) {
    const keyPair = ec.keyFromPrivate(privateKey);
    const signature = keyPair.sign(data);
    return signature.toDER('hex');
  }

  /**
   * Verify signature
   * @param {string} data - Original data
   * @param {string} signature - Signature in hex format
   * @param {string} publicKey - Public key in hex format
   * @returns {boolean} Whether signature is valid
   */
  static verify(data, signature, publicKey) {
    const keyPair = ec.keyFromPublic(publicKey, 'hex');
    return keyPair.verify(data, signature);
  }

  /**
   * Hash data using the configured algorithm
   * @param {string|Buffer} data - Data to hash
   * @returns {string} Hash in hex format
   */
  static hash(data) {
    return crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Generate a deterministic key pair from a seed
   * @param {string} seed - Seed for key generation
   * @returns {Object} Object containing publicKey and privateKey
   */
  static deterministicKeyPair(seed) {
    // Create a deterministic seed
    const hash = this.hash(seed);
    
    // Generate keypair from hash
    const keyPair = ec.keyFromPrivate(hash);
    
    return {
      publicKey: keyPair.getPublic('hex'),
      privateKey: keyPair.getPrivate('hex')
    };
  }

  /**
   * Create a shared secret using ECDH
   * @param {string} privateKey - Own private key
   * @param {string} publicKey - Other party's public key
   * @returns {Buffer} Shared secret as buffer
   */
  static getSharedSecret(privateKey, publicKey) {
    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKeyPoint = ec.keyFromPublic(publicKey, 'hex').getPublic();
    const secret = keyPair.derive(publicKeyPoint);
    
    // Convert BN to Buffer
    return Buffer.from(secret.toString(16, 2), 'hex');
  }
}

module.exports = Keys;

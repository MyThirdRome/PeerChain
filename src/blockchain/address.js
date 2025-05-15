/**
 * Address utilities for DoucyA blockchain
 */

'use strict';

const crypto = require('crypto');
const { randomBytes } = require('crypto');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const config = require('../config');

class Address {
  /**
   * Generate a new key pair and address
   * @returns {Object} - Object containing address, public key, and private key
   */
  static generate() {
    // Generate a new key pair
    const keyPair = ec.genKeyPair();
    
    // Get public and private keys
    const publicKey = keyPair.getPublic('hex');
    const privateKey = keyPair.getPrivate('hex');
    
    // Generate address
    const address = this.publicKeyToAddress(publicKey);
    
    return {
      address,
      publicKey,
      privateKey
    };
  }

  /**
   * Convert a public key to an address
   * @param {string} publicKey - Public key in hex format
   * @returns {string} - DoucyA address
   */
  static publicKeyToAddress(publicKey) {
    // Hash the public key
    const hash = crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(publicKey)
      .digest('hex');
    
    // Get a unique part from the hash (10 characters long)
    const uniquePart = this.hashToUniqueString(hash, 10);
    
    // Create the address with Dou prefix and cyA suffix
    return `${config.address.prefix}${uniquePart}${config.address.suffix}`;
  }

  /**
   * Convert a hash to a unique string with specified characters
   * @param {string} hash - Hash to convert
   * @param {number} length - Length of the unique string
   * @returns {string} - Unique string
   */
  static hashToUniqueString(hash, length) {
    // Define the character set (1-9 and a-z)
    const charSet = '123456789abcdefghijklmnopqrstuvwxyz';
    
    // Convert hash to a sequence from the character set
    let result = '';
    for (let i = 0; i < length; i++) {
      // Get a byte from the hash
      const byte = parseInt(hash.substr(i * 2, 2), 16);
      // Map the byte to a character in our set
      const charIndex = byte % charSet.length;
      result += charSet[charIndex];
    }
    
    return result;
  }

  /**
   * Get a key pair from a private key
   * @param {string} privateKey - Private key in hex format
   * @returns {Object} - Object containing address, public key, and private key
   */
  static fromPrivateKey(privateKey) {
    // Create a key pair from the private key
    const keyPair = ec.keyFromPrivate(privateKey);
    
    // Get public key
    const publicKey = keyPair.getPublic('hex');
    
    // Generate address
    const address = this.publicKeyToAddress(publicKey);
    
    return {
      address,
      publicKey,
      privateKey
    };
  }

  /**
   * Sign data with a private key
   * @param {string} data - Data to sign
   * @param {string} privateKey - Private key in hex format
   * @returns {string} - Signature in hex format
   */
  static sign(data, privateKey) {
    const keyPair = ec.keyFromPrivate(privateKey);
    const signature = keyPair.sign(data);
    return signature.toDER('hex');
  }

  /**
   * Verify a signature
   * @param {string} data - Original data
   * @param {string} signature - Signature in hex format
   * @param {string} publicKey - Public key in hex format
   * @returns {boolean} - Whether the signature is valid
   */
  static verifySignature(data, signature, publicKey) {
    const keyPair = ec.keyFromPublic(publicKey, 'hex');
    return keyPair.verify(data, signature);
  }

  /**
   * Validate a DoucyA address format
   * @param {string} address - Address to validate
   * @returns {boolean} - Whether the address is valid
   */
  static isValidAddress(address) {
    // Check if address has the correct format
    const regex = new RegExp(
      `^${config.address.prefix}[1-9a-z]{${config.address.length - config.address.prefix.length - config.address.suffix.length}}${config.address.suffix}$`
    );
    return regex.test(address);
  }
}

module.exports = Address;

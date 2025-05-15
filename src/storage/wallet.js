/**
 * Wallet implementation for DoucyA blockchain
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Address = require('../blockchain/address');
const crypto = require('crypto');
const Keys = require('../crypto/keys');
const config = require('../config');

class Wallet {
  /**
   * Create a new wallet
   * @param {string} walletPath - Path to the wallet file
   */
  constructor(walletPath) {
    this.walletPath = walletPath;
    this.addresses = new Map();
    this.defaultAddress = null;
  }

  /**
   * Initialize the wallet
   * @returns {Promise} Promise that resolves when wallet is initialized
   */
  async initialize() {
    // Create wallet directory if it doesn't exist
    const walletDir = path.dirname(this.walletPath);
    if (!fs.existsSync(walletDir)) {
      fs.mkdirSync(walletDir, { recursive: true });
    }
    
    // Load wallet if it exists
    if (fs.existsSync(this.walletPath)) {
      try {
        const walletData = fs.readFileSync(this.walletPath, 'utf8');
        const walletJson = JSON.parse(walletData);
        
        for (const addressData of walletJson.addresses) {
          this.addresses.set(addressData.address, {
            publicKey: addressData.publicKey,
            privateKey: this.decryptPrivateKey(addressData.encryptedPrivateKey, config.crypto.keyEncoding)
          });
        }
        
        this.defaultAddress = walletJson.defaultAddress;
        console.log(`Loaded wallet with ${this.addresses.size} addresses`);
      } catch (err) {
        console.error('Error loading wallet:', err);
        // Create a new wallet if loading fails
        console.log('Creating new wallet');
      }
    }
  }

  /**
   * Save wallet to file
   * @returns {Promise} Promise that resolves when wallet is saved
   */
  async save() {
    const addresses = [];
    
    for (const [address, data] of this.addresses.entries()) {
      addresses.push({
        address,
        publicKey: data.publicKey,
        encryptedPrivateKey: this.encryptPrivateKey(data.privateKey, config.crypto.keyEncoding)
      });
    }
    
    const walletData = {
      addresses,
      defaultAddress: this.defaultAddress
    };
    
    fs.writeFileSync(this.walletPath, JSON.stringify(walletData, null, 2));
  }

  /**
   * Create a new address
   * @returns {Promise<Object>} Promise that resolves with the new address data
   */
  async createAddress() {
    // Generate a new key pair
    const keyPair = Address.generate();
    
    // Add to addresses
    this.addresses.set(keyPair.address, {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    });
    
    // Set as default address if first one
    if (this.addresses.size === 1) {
      this.defaultAddress = keyPair.address;
    }
    
    // Save wallet
    await this.save();
    
    return {
      address: keyPair.address,
      privateKey: keyPair.privateKey
    };
  }

  /**
   * Import an address using private key
   * @param {string} privateKey - Private key to import
   * @returns {Promise<string>} Promise that resolves with the imported address
   */
  async importAddress(privateKey) {
    // Generate address from private key
    const keyPair = Address.fromPrivateKey(privateKey);
    
    // Add to addresses
    this.addresses.set(keyPair.address, {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    });
    
    // Set as default address if first one
    if (this.addresses.size === 1) {
      this.defaultAddress = keyPair.address;
    }
    
    // Save wallet
    await this.save();
    
    return keyPair.address;
  }

  /**
   * List all addresses in the wallet
   * @returns {Promise<Array>} Promise that resolves with array of addresses
   */
  async listAddresses() {
    return Array.from(this.addresses.keys());
  }

  /**
   * Get private key for an address
   * @param {string} address - Address to get private key for
   * @returns {Promise<string>} Promise that resolves with the private key
   */
  async getPrivateKey(address) {
    const data = this.addresses.get(address);
    if (!data) {
      throw new Error(`Address ${address} not found in wallet`);
    }
    
    return data.privateKey;
  }

  /**
   * Get public key for an address
   * @param {string} address - Address to get public key for
   * @returns {Promise<string>} Promise that resolves with the public key
   */
  async getPublicKey(address) {
    const data = this.addresses.get(address);
    if (!data) {
      throw new Error(`Address ${address} not found in wallet`);
    }
    
    return data.publicKey;
  }

  /**
   * Get default address
   * @returns {Promise<string>} Promise that resolves with the default address
   */
  async getDefaultAddress() {
    return this.defaultAddress;
  }

  /**
   * Set default address
   * @param {string} address - Address to set as default
   * @returns {Promise} Promise that resolves when default address is set
   */
  async setDefaultAddress(address) {
    if (!this.addresses.has(address)) {
      throw new Error(`Address ${address} not found in wallet`);
    }
    
    this.defaultAddress = address;
    await this.save();
  }

  /**
   * Encrypt a private key
   * @param {string} privateKey - Private key to encrypt
   * @param {string} encoding - Encoding to use
   * @returns {string} Encrypted private key
   */
  encryptPrivateKey(privateKey, encoding) {
    // This is a simple implementation
    // In a production system, you would use a password to encrypt the private key
    return privateKey;
  }

  /**
   * Decrypt a private key
   * @param {string} encryptedPrivateKey - Encrypted private key
   * @param {string} encoding - Encoding to use
   * @returns {string} Decrypted private key
   */
  decryptPrivateKey(encryptedPrivateKey, encoding) {
    // This is a simple implementation
    // In a production system, you would use a password to decrypt the private key
    return encryptedPrivateKey;
  }

  /**
   * Sign data with a private key
   * @param {string} address - Address to sign with
   * @param {string} data - Data to sign
   * @returns {Promise<string>} Promise that resolves with the signature
   */
  async sign(address, data) {
    const privateKey = await this.getPrivateKey(address);
    return Keys.sign(data, privateKey);
  }

  /**
   * Verify a signature
   * @param {string} address - Address to verify with
   * @param {string} data - Original data
   * @param {string} signature - Signature to verify
   * @returns {Promise<boolean>} Promise that resolves with whether the signature is valid
   */
  async verify(address, data, signature) {
    const publicKey = await this.getPublicKey(address);
    return Keys.verify(data, signature, publicKey);
  }
}

module.exports = Wallet;

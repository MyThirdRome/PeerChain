/**
 * Block class for DoucyA blockchain
 */

'use strict';

const crypto = require('crypto');
const config = require('../config');

class Block {
  /**
   * Create a new block
   * @param {number} height - Block height
   * @param {string} previousHash - Hash of the previous block
   * @param {Array} transactions - Array of transactions
   * @param {string} validator - Address of the validator
   * @param {number} timestamp - Block timestamp
   */
  constructor(height, previousHash, transactions, validator, timestamp = Date.now()) {
    this.height = height;
    this.previousHash = previousHash;
    this.transactions = transactions;
    this.validator = validator;
    this.timestamp = timestamp;
    this.hash = this.calculateHash();
    this.signature = null;
  }

  /**
   * Calculate hash of the block
   * @returns {string} - Block hash
   */
  calculateHash() {
    const blockString = JSON.stringify({
      height: this.height,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      transactions: this.transactions,
      validator: this.validator
    });

    return crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(blockString)
      .digest('hex');
  }

  /**
   * Sign the block with validator's private key
   * @param {Function} signCallback - Function to sign data with private key
   */
  async sign(signCallback) {
    this.signature = await signCallback(this.hash);
    return this.signature;
  }

  /**
   * Verify block signature
   * @param {Function} verifyCallback - Function to verify signature
   * @returns {boolean} - Whether signature is valid
   */
  async verifySignature(verifyCallback) {
    if (!this.signature) return false;
    return await verifyCallback(this.hash, this.signature, this.validator);
  }

  /**
   * Convert block to JSON object
   * @returns {Object} - Block as JSON object
   */
  toJSON() {
    return {
      height: this.height,
      hash: this.hash,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      transactions: this.transactions,
      validator: this.validator,
      signature: this.signature,
      size: JSON.stringify(this).length
    };
  }

  /**
   * Create a block from JSON object
   * @param {Object} data - Block data
   * @returns {Block} - Block instance
   */
  static fromJSON(data) {
    const block = new Block(
      data.height,
      data.previousHash,
      data.transactions,
      data.validator,
      data.timestamp
    );
    block.hash = data.hash;
    block.signature = data.signature;
    return block;
  }

  /**
   * Create genesis block
   * @param {string} validatorAddress - Genesis validator address
   * @param {Array} initialAddresses - Addresses to receive initial supply
   * @returns {Block} - Genesis block
   */
  static createGenesisBlock(validatorAddress, initialAddresses) {
    const transactions = initialAddresses.map((address, index) => ({
      type: 'MINT',
      to: address,
      amount: config.blockchain.initialSupply,
      timestamp: config.blockchain.genesisTimestamp,
      hash: crypto.createHash(config.crypto.hashAlgorithm)
        .update(`GENESIS_${index}_${address}`)
        .digest('hex'),
    }));

    return new Block(
      0, // height
      '0'.repeat(64), // previous hash
      transactions,
      validatorAddress,
      config.blockchain.genesisTimestamp
    );
  }
}

module.exports = Block;

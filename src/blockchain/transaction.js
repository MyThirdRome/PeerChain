/**
 * Transaction class for DoucyA blockchain
 */

'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Transaction types:
 * - TRANSFER: Transfer DOU from one address to another
 * - MINT: Create new DOU (genesis or mining rewards)
 * - REWARD: Validator rewards
 * - VALIDATOR_REGISTER: Register as a validator
 * - VALIDATOR_WITHDRAW: Withdraw validator stake
 * - MESSAGE: Send a message
 * - WHITELIST: Add/remove address from whitelist
 */

class Transaction {
  /**
   * Create a new transaction
   * @param {string} type - Transaction type
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {number} amount - Transaction amount
   * @param {number} fee - Transaction fee
   * @param {Object} data - Additional transaction data
   */
  constructor(type, from, to, amount, fee, data = {}) {
    this.type = type;
    this.from = from;
    this.to = to;
    this.amount = amount;
    this.fee = fee;
    this.data = data;
    this.timestamp = Date.now();
    this.hash = this.calculateHash();
    this.signature = null;
    
    // Special fields for message transactions
    this.senderReward = data.senderReward || 0;
    this.receiverReward = data.receiverReward || 0;
  }

  /**
   * Calculate transaction hash
   * @returns {string} - Transaction hash
   */
  calculateHash() {
    const txData = {
      type: this.type,
      from: this.from,
      to: this.to,
      amount: this.amount,
      fee: this.fee,
      data: this.data,
      timestamp: this.timestamp,
      senderReward: this.senderReward,
      receiverReward: this.receiverReward
    };
    
    return crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(JSON.stringify(txData))
      .digest('hex');
  }

  /**
   * Verify transaction hash
   * @returns {boolean} - Whether hash is valid
   */
  verifyHash() {
    return this.hash === this.calculateHash();
  }

  /**
   * Sign transaction with private key
   * @param {Function} signCallback - Function to sign data with private key
   */
  async sign(signCallback) {
    this.signature = await signCallback(this.hash);
    return this.signature;
  }

  /**
   * Verify transaction signature
   * @param {Function} verifyCallback - Function to verify signature
   * @returns {boolean} - Whether signature is valid
   */
  async verifySignature(verifyCallback) {
    if (!this.signature || !this.from) return false;
    return await verifyCallback(this.hash, this.signature, this.from);
  }

  /**
   * Convert transaction to JSON object
   * @returns {Object} - Transaction as JSON object
   */
  toJSON() {
    return {
      type: this.type,
      from: this.from,
      to: this.to,
      amount: this.amount,
      fee: this.fee,
      data: this.data,
      timestamp: this.timestamp,
      hash: this.hash,
      signature: this.signature,
      senderReward: this.senderReward,
      receiverReward: this.receiverReward
    };
  }

  /**
   * Create a transaction from JSON object
   * @param {Object} data - Transaction data
   * @returns {Transaction} - Transaction instance
   */
  static fromJSON(data) {
    const tx = new Transaction(
      data.type,
      data.from,
      data.to,
      data.amount,
      data.fee,
      data.data
    );
    
    tx.timestamp = data.timestamp;
    tx.hash = data.hash;
    tx.signature = data.signature;
    tx.senderReward = data.senderReward || 0;
    tx.receiverReward = data.receiverReward || 0;
    
    return tx;
  }

  /**
   * Create a token transfer transaction
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {number} amount - Amount to transfer
   * @param {number} fee - Transaction fee
   * @returns {Transaction} - Transaction instance
   */
  static createTransfer(from, to, amount, fee) {
    return new Transaction('TRANSFER', from, to, amount, fee);
  }

  /**
   * Create a message transaction
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {string} message - Message content
   * @param {boolean} isWhitelisted - Whether the recipient whitelisted the sender
   * @returns {Transaction} - Transaction instance
   */
  static createMessage(from, to, message, isWhitelisted) {
    let fee = 0;
    let senderReward = 0;
    let receiverReward = 0;
    
    if (isWhitelisted) {
      // Regular rewards
      senderReward = config.messaging.sendReward;
      receiverReward = config.messaging.receiveReward;
    } else {
      // Non-whitelisted fee
      fee = config.messaging.nonWhitelistedFee;
    }
    
    return new Transaction('MESSAGE', from, to, 0, fee, {
      message,
      isWhitelisted
    }, {
      senderReward,
      receiverReward
    });
  }

  /**
   * Create a validator registration transaction
   * @param {string} from - Validator address
   * @param {number} amount - Amount to stake
   * @param {number} fee - Transaction fee
   * @returns {Transaction} - Transaction instance
   */
  static createValidatorRegister(from, amount, fee) {
    return new Transaction('VALIDATOR_REGISTER', from, null, amount, fee);
  }

  /**
   * Create a validator withdrawal transaction
   * @param {string} from - Validator address
   * @param {number} fee - Transaction fee
   * @returns {Transaction} - Transaction instance
   */
  static createValidatorWithdraw(from, fee) {
    return new Transaction('VALIDATOR_WITHDRAW', from, from, 0, fee);
  }

  /**
   * Create a whitelist transaction
   * @param {string} from - Owner address
   * @param {string} to - Address to whitelist
   * @param {string} action - 'add' or 'remove'
   * @returns {Transaction} - Transaction instance
   */
  static createWhitelist(from, to, action) {
    return new Transaction('WHITELIST', from, to, 0, 0, { action });
  }
}

module.exports = Transaction;

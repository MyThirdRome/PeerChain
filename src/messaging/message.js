/**
 * Message class for DoucyA blockchain
 */

'use strict';

const crypto = require('crypto');
const config = require('../config');

class Message {
  /**
   * Create a new message
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {string} content - Message content
   * @param {number} timestamp - Message timestamp
   */
  constructor(from, to, content, timestamp = Date.now()) {
    this.id = this.generateId(from, to, content, timestamp);
    this.from = from;
    this.to = to;
    this.content = content;
    this.timestamp = timestamp;
    this.read = false;
    this.signature = null;
    this.senderReward = 0;
    this.receiverReward = 0;
  }

  /**
   * Generate a unique message ID
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {string} content - Message content
   * @param {number} timestamp - Message timestamp
   * @returns {string} - Message ID
   */
  generateId(from, to, content, timestamp) {
    const data = `${from}${to}${content}${timestamp}`;
    return crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Sign the message
   * @param {Function} signCallback - Function to sign data with private key
   * @returns {string} - Message signature
   */
  async sign(signCallback) {
    this.signature = await signCallback(this.id);
    return this.signature;
  }

  /**
   * Verify message signature
   * @param {Function} verifyCallback - Function to verify signature
   * @returns {boolean} - Whether signature is valid
   */
  async verifySignature(verifyCallback) {
    if (!this.signature) return false;
    return await verifyCallback(this.id, this.signature, this.from);
  }

  /**
   * Set message rewards
   * @param {number} senderReward - Reward for sender
   * @param {number} receiverReward - Reward for receiver
   */
  setRewards(senderReward, receiverReward) {
    this.senderReward = senderReward;
    this.receiverReward = receiverReward;
  }

  /**
   * Mark message as read
   */
  markAsRead() {
    this.read = true;
  }

  /**
   * Convert message to JSON object
   * @returns {Object} - Message as JSON object
   */
  toJSON() {
    return {
      id: this.id,
      from: this.from,
      to: this.to,
      content: this.content,
      timestamp: this.timestamp,
      read: this.read,
      signature: this.signature,
      senderReward: this.senderReward,
      receiverReward: this.receiverReward
    };
  }

  /**
   * Create a message from JSON object
   * @param {Object} data - Message data
   * @returns {Message} - Message instance
   */
  static fromJSON(data) {
    const message = new Message(
      data.from,
      data.to,
      data.content,
      data.timestamp
    );
    
    message.id = data.id;
    message.read = data.read || false;
    message.signature = data.signature;
    message.senderReward = data.senderReward || 0;
    message.receiverReward = data.receiverReward || 0;
    
    return message;
  }
}

module.exports = Message;

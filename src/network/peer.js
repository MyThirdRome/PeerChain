/**
 * Peer management for DoucyA blockchain
 */

'use strict';

class Peer {
  /**
   * Create a new peer
   * @param {string} id - Peer ID
   * @param {string} multiaddr - Multiaddress of the peer
   */
  constructor(id, multiaddr) {
    this.id = id;
    this.multiaddr = multiaddr;
    this.connectedAt = Date.now();
    this.lastSeen = Date.now();
    this.latency = 0; // Average latency in ms
    this.messages = 0; // Number of messages exchanged
    this.blocksReceived = 0;
    this.blocksSent = 0;
    this.transactionsReceived = 0;
    this.transactionsSent = 0;
  }

  /**
   * Update peer's last seen timestamp
   */
  seen() {
    this.lastSeen = Date.now();
  }

  /**
   * Update peer's latency
   * @param {number} latency - Latency in ms
   */
  updateLatency(latency) {
    // Simple moving average
    if (this.latency === 0) {
      this.latency = latency;
    } else {
      this.latency = 0.8 * this.latency + 0.2 * latency;
    }
  }

  /**
   * Increment message count
   */
  incrementMessages() {
    this.messages++;
  }

  /**
   * Increment blocks received
   */
  incrementBlocksReceived() {
    this.blocksReceived++;
  }

  /**
   * Increment blocks sent
   */
  incrementBlocksSent() {
    this.blocksSent++;
  }

  /**
   * Increment transactions received
   */
  incrementTransactionsReceived() {
    this.transactionsReceived++;
  }

  /**
   * Increment transactions sent
   */
  incrementTransactionsSent() {
    this.transactionsSent++;
  }

  /**
   * Get peer age in seconds
   * @returns {number} - Age in seconds
   */
  getAge() {
    return (Date.now() - this.connectedAt) / 1000;
  }

  /**
   * Get time since last seen in seconds
   * @returns {number} - Time since last seen in seconds
   */
  getLastSeenAge() {
    return (Date.now() - this.lastSeen) / 1000;
  }

  /**
   * Convert peer to JSON object
   * @returns {Object} - Peer as JSON object
   */
  toJSON() {
    return {
      id: this.id,
      multiaddr: this.multiaddr,
      connectedAt: this.connectedAt,
      lastSeen: this.lastSeen,
      latency: this.latency,
      messages: this.messages,
      blocksReceived: this.blocksReceived,
      blocksSent: this.blocksSent,
      transactionsReceived: this.transactionsReceived,
      transactionsSent: this.transactionsSent
    };
  }

  /**
   * Create a peer from JSON object
   * @param {Object} data - Peer data
   * @returns {Peer} - Peer instance
   */
  static fromJSON(data) {
    const peer = new Peer(data.id, data.multiaddr);
    peer.connectedAt = data.connectedAt;
    peer.lastSeen = data.lastSeen;
    peer.latency = data.latency || 0;
    peer.messages = data.messages || 0;
    peer.blocksReceived = data.blocksReceived || 0;
    peer.blocksSent = data.blocksSent || 0;
    peer.transactionsReceived = data.transactionsReceived || 0;
    peer.transactionsSent = data.transactionsSent || 0;
    return peer;
  }
}

module.exports = Peer;

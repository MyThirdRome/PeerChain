/**
 * Block Explorer for DoucyA blockchain
 */

'use strict';

const Address = require('../blockchain/address');
const Block = require('../blockchain/block');
const Transaction = require('../blockchain/transaction');

class BlockchainExplorer {
  /**
   * Create a new blockchain explorer
   * @param {Object} node - Node instance
   */
  constructor(node) {
    this.node = node;
  }

  /**
   * Get information about the blockchain
   * @returns {Object} - Blockchain information
   */
  async getBlockchainInfo() {
    try {
      const latestBlock = await this.node.blockchain.getLatestBlock();
      
      return {
        height: latestBlock.height,
        latestBlockHash: latestBlock.hash,
        timestamp: latestBlock.timestamp,
        transactions: latestBlock.transactions.length,
        validator: latestBlock.validator
      };
    } catch (error) {
      // Handle case where no blocks exist yet
      return {
        height: 0,
        latestBlockHash: "No blocks yet",
        timestamp: Date.now(),
        transactions: 0,
        validator: "None"
      };
    }
  }

  /**
   * Get a block by height or hash
   * @param {string|number} heightOrHash - Block height or hash
   * @returns {Object} - Block information
   */
  async getBlock(heightOrHash) {
    const block = await this.node.blockchain.getBlock(heightOrHash);
    
    return {
      height: block.height,
      hash: block.hash,
      previousHash: block.previousHash,
      timestamp: block.timestamp,
      validator: block.validator,
      transactions: block.transactions.length,
      transactionHashes: block.transactions.map(tx => tx.hash)
    };
  }

  /**
   * Get transactions for a block
   * @param {string|number} heightOrHash - Block height or hash
   * @returns {Array} - Transactions
   */
  async getBlockTransactions(heightOrHash) {
    const block = await this.node.blockchain.getBlock(heightOrHash);
    
    return block.transactions.map(tx => ({
      hash: tx.hash,
      type: tx.type,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      fee: tx.fee,
      timestamp: tx.timestamp
    }));
  }

  /**
   * Get a transaction by hash
   * @param {string} hash - Transaction hash
   * @returns {Object} - Transaction information
   */
  async getTransaction(hash) {
    const tx = await this.node.blockchain.getTransaction(hash);
    
    return {
      hash: tx.hash,
      type: tx.type,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      fee: tx.fee,
      timestamp: tx.timestamp,
      blockHeight: tx.blockHeight,
      blockHash: tx.blockHash
    };
  }

  /**
   * Get information about an address
   * @param {string} address - Address to get information for
   * @returns {Object} - Address information
   */
  async getAddressInfo(address) {
    if (!Address.isValidAddress(address)) {
      throw new Error('Invalid address format');
    }
    
    const balance = await this.node.getAddressBalance(address);
    const transactions = await this.node.blockchain.getAddressTransactions(address);
    
    // Get transaction details
    const txDetails = [];
    for (const txHash of transactions) {
      try {
        const tx = await this.node.blockchain.getTransaction(txHash);
        txDetails.push({
          hash: txHash,
          type: tx.type,
          from: tx.from,
          to: tx.to,
          amount: tx.amount,
          fee: tx.fee,
          timestamp: tx.timestamp
        });
      } catch (err) {
        // Transaction not found, skip
      }
    }
    
    // Sort transactions by timestamp (newest first)
    txDetails.sort((a, b) => b.timestamp - a.timestamp);
    
    return {
      address,
      balance,
      transactionCount: txDetails.length,
      transactions: txDetails
    };
  }

  /**
   * Search for blocks, transactions, or addresses
   * @param {string} query - Search query
   * @returns {Object} - Search results
   */
  async search(query) {
    const results = {
      blocks: [],
      transactions: [],
      addresses: []
    };
    
    // Check if query is an address
    if (Address.isValidAddress(query)) {
      try {
        const addressInfo = await this.getAddressInfo(query);
        results.addresses.push(addressInfo);
      } catch (err) {
        // Address not found
      }
    }
    
    // Check if query is a block height
    if (/^\d+$/.test(query)) {
      try {
        const block = await this.getBlock(parseInt(query, 10));
        results.blocks.push(block);
      } catch (err) {
        // Block not found
      }
    }
    
    // Check if query is a block hash or transaction hash
    try {
      const block = await this.getBlock(query);
      results.blocks.push(block);
    } catch (err) {
      // Not a block hash
      try {
        const transaction = await this.getTransaction(query);
        results.transactions.push(transaction);
      } catch (err) {
        // Not a transaction hash
      }
    }
    
    return results;
  }
}

module.exports = BlockchainExplorer;
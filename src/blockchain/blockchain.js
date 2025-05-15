/**
 * Blockchain implementation for DoucyA
 */

'use strict';

const Block = require('./block');
const Transaction = require('./transaction');
const { EventEmitter } = require('events');
const config = require('../config');
const crypto = require('crypto');

class Blockchain extends EventEmitter {
  /**
   * Create a new blockchain instance
   * @param {Object} db - LevelDB database instance
   */
  constructor(db) {
    super();
    this.db = db;
    this.currentBlock = null;
    this.pendingTransactions = [];
    this.validators = new Map(); // validator address -> staked amount
    this.validatorMinDeposit = config.blockchain.validatorMinDeposit;
    this.blockInterval = null;
    this.currentHeight = 0;
  }

  /**
   * Initialize the blockchain
   */
  async initialize() {
    // Try to load the blockchain state from the database
    try {
      const latestBlockData = await this.db.get('LATEST_BLOCK');
      if (latestBlockData) {
        const latestBlock = Block.fromJSON(JSON.parse(latestBlockData));
        this.currentHeight = latestBlock.height;
        console.log(`Blockchain initialized with existing data. Current height: ${this.currentHeight}`);
      } else {
        await this.createGenesisBlock();
      }
    } catch (err) {
      if (err.type === 'NotFoundError') {
        await this.createGenesisBlock();
      } else {
        throw err;
      }
    }

    // Load validators
    try {
      const validatorsData = await this.db.get('VALIDATORS');
      if (validatorsData) {
        const validatorsObj = JSON.parse(validatorsData);
        for (const [address, amount] of Object.entries(validatorsObj)) {
          this.validators.set(address, amount);
        }
        console.log(`Loaded ${this.validators.size} validators`);
      }
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
  }

  /**
   * Create the genesis block - completely direct implementation to avoid recursive calls
   */
  async createGenesisBlock() {
    console.log('Creating genesis block...');
    // For the genesis block, we'll use a predefined validator
    const genesisValidatorAddress = 'DouthefirstcyA';
    
    // Use one predefined initial address 
    const initialAddress = 'Doue8eylmv193cyA'; // Use the address we created earlier
    console.log(`Creating genesis block with initial address: ${initialAddress}`);
    
    // Create a simple genesis block without going through the normal save process
    const timestamp = Date.now();
    const genesisBlock = {
      height: 0,
      previousHash: '0'.repeat(64),
      transactions: [{
        type: 'MINT',
        to: initialAddress,
        amount: 15000, // Initial supply from config
        timestamp: timestamp
      }],
      validator: genesisValidatorAddress,
      timestamp: timestamp,
      hash: crypto.createHash(config.crypto.hashAlgorithm)
        .update(`GENESIS_BLOCK_${timestamp}`)
        .digest('hex'),
      signature: null
    };
    
    // Manually save the block data directly without calling processTransaction
    await this.db.put(`BLOCK_${genesisBlock.hash}`, JSON.stringify(genesisBlock));
    await this.db.put(`BLOCK_HEIGHT_0`, genesisBlock.hash);
    await this.db.put(`BLOCK_HASH_${genesisBlock.hash}`, genesisBlock.hash);
    await this.db.put('LATEST_BLOCK', JSON.stringify(genesisBlock));
    
    // Set the initial balance directly
    await this.db.put(`BALANCE_${initialAddress}`, 15000);
    
    // Save transaction record
    const txHash = crypto.createHash(config.crypto.hashAlgorithm)
      .update(`GENESIS_TX_${timestamp}`)
      .digest('hex');
      
    const transaction = {
      type: 'MINT',
      to: initialAddress,
      amount: 15000,
      fee: 0,
      timestamp: timestamp,
      hash: txHash
    };
    
    await this.db.put(`TX_${txHash}`, JSON.stringify(transaction));
    
    // Add to address transaction history directly
    await this.db.put(`ADDRESS_TX_${initialAddress}`, JSON.stringify([txHash]));
    
    this.currentHeight = 0;
    console.log('Genesis block created with simplified approach');
  }

  /**
   * Start the blockchain
   * @param {string} validatorAddress - Address of this node if it's a validator
   * @param {Function} signCallback - Function to sign data with validator's private key
   */
  async start(validatorAddress, signCallback) {
    // Set block creation interval
    this.blockInterval = setInterval(
      () => this.createBlock(validatorAddress, signCallback),
      config.blockchain.blockTime
    );
    
    console.log('Blockchain started');
  }

  /**
   * Stop the blockchain
   */
  stop() {
    if (this.blockInterval) {
      clearInterval(this.blockInterval);
      this.blockInterval = null;
    }
    console.log('Blockchain stopped');
  }

  /**
   * Create a new block
   * @param {string} validatorAddress - Address of the validator creating the block
   * @param {Function} signCallback - Function to sign the block
   */
  async createBlock(validatorAddress, signCallback) {
    // Check if we are a validator
    if (!this.validators.has(validatorAddress)) {
      // We're not a validator, don't create blocks
      return;
    }

    // Make sure we have the latest state
    await this.syncBlockchain();

    // Get latest block
    const latestBlock = await this.getLatestBlock();

    // Check if we have pending transactions
    if (this.pendingTransactions.length === 0) {
      console.log('No pending transactions, skipping block creation');
      return;
    }

    // Process transactions and remove invalid ones
    const validTransactions = [];
    for (const tx of this.pendingTransactions) {
      if (await this.isTransactionValid(tx)) {
        validTransactions.push(tx);
      }
    }

    if (validTransactions.length === 0) {
      console.log('No valid transactions, skipping block creation');
      return;
    }

    // Create new block
    const newBlock = new Block(
      latestBlock.height + 1,
      latestBlock.hash,
      validTransactions,
      validatorAddress
    );

    // Sign the block
    await newBlock.sign(signCallback);

    // Save the block
    await this.saveBlock(newBlock);

    // Clear processed transactions
    this.pendingTransactions = this.pendingTransactions.filter(
      tx => !validTransactions.includes(tx)
    );

    // Process rewards for the validator
    await this.processValidatorRewards(validatorAddress, newBlock);

    // Emit block created event
    this.emit('blockCreated', newBlock);
    
    console.log(`Block #${newBlock.height} created with ${validTransactions.length} transactions`);
  }

  /**
   * Process validator rewards for creating a block
   * @param {string} validatorAddress - Validator address
   * @param {Block} block - The created block
   */
  async processValidatorRewards(validatorAddress, block) {
    // Calculate validator rewards based on transaction fees and messaging rewards
    let totalReward = 0;
    
    for (const tx of block.transactions) {
      // Add transaction fee to the reward
      totalReward += tx.fee;
      
      // For messaging transactions, validators get 150% of user rewards
      if (tx.type === 'MESSAGE') {
        // Sender rewards
        if (tx.senderReward) {
          totalReward += tx.senderReward * 1.5;
        }
        
        // Receiver rewards
        if (tx.receiverReward) {
          totalReward += tx.receiverReward * 1.5;
        }
      }
    }
    
    // Create reward transaction
    const rewardTx = new Transaction(
      'REWARD',
      null, // No sender for rewards
      validatorAddress,
      totalReward,
      0, // No fee for reward transactions
      { blockHeight: block.height }
    );
    
    rewardTx.hash = rewardTx.calculateHash();
    
    // Store the transaction
    await this.db.put(`TX_${rewardTx.hash}`, JSON.stringify(rewardTx.toJSON()));
    
    // Update the validator's balance
    const balance = await this.getAddressBalance(validatorAddress);
    await this.db.put(`BALANCE_${validatorAddress}`, balance + totalReward);
    
    console.log(`Validator ${validatorAddress} received ${totalReward} DOU reward`);
  }

  /**
   * Get the latest block
   * @returns {Block} - Latest block
   */
  async getLatestBlock() {
    try {
      const latestBlockData = await this.db.get('LATEST_BLOCK');
      return Block.fromJSON(JSON.parse(latestBlockData));
    } catch (err) {
      throw new Error('Failed to get latest block: ' + err.message);
    }
  }

  /**
   * Get a block by height or hash
   * @param {string|number} heightOrHash - Block height or hash
   * @returns {Block} - Block
   */
  async getBlock(heightOrHash) {
    try {
      let blockKey;
      
      if (typeof heightOrHash === 'number' || /^\d+$/.test(heightOrHash)) {
        // It's a height
        blockKey = `BLOCK_HEIGHT_${heightOrHash}`;
      } else {
        // It's a hash
        blockKey = `BLOCK_HASH_${heightOrHash}`;
      }
      
      const blockHash = await this.db.get(blockKey);
      const blockData = await this.db.get(`BLOCK_${blockHash}`);
      return Block.fromJSON(JSON.parse(blockData));
    } catch (err) {
      throw new Error(`Block not found: ${heightOrHash}`);
    }
  }

  /**
   * Save a block to the database
   * @param {Block} block - Block to save
   */
  async saveBlock(block) {
    try {
      // Store the block
      await this.db.put(`BLOCK_${block.hash}`, JSON.stringify(block.toJSON()));
      
      // Store reference by height
      await this.db.put(`BLOCK_HEIGHT_${block.height}`, block.hash);
      
      // Store reference by hash
      await this.db.put(`BLOCK_HASH_${block.hash}`, block.hash);
      
      // Update latest block reference
      await this.db.put('LATEST_BLOCK', JSON.stringify(block.toJSON()));
      
      // Process transactions in the block (skip for genesis block)
      if (block.height > 0) {
        for (const tx of block.transactions) {
          await this.processTransaction(tx);
        }
      } else {
        // For genesis block, just process balance updates directly
        for (const tx of block.transactions) {
          if (tx.type === 'MINT' && tx.to) {
            await this.db.put(`BALANCE_${tx.to}`, tx.amount || 0);
          }
        }
      }
      
      // Update current height
      this.currentHeight = block.height;
    } catch (err) {
      throw new Error('Failed to save block: ' + err.message);
    }
  }

  /**
   * Add a transaction to the pending transactions
   * @param {Transaction} transaction - Transaction to add
   */
  addTransaction(transaction) {
    // Verify the transaction
    if (!transaction.verifyHash()) {
      throw new Error('Invalid transaction hash');
    }
    
    // Add to pending transactions
    this.pendingTransactions.push(transaction);
    
    // Emit transaction added event
    this.emit('transactionAdded', transaction);
    
    return transaction.hash;
  }

  /**
   * Check if a transaction is valid
   * @param {Transaction} transaction - Transaction to check
   * @returns {boolean} - Whether the transaction is valid
   */
  async isTransactionValid(transaction) {
    // Verify transaction hash
    if (!transaction.verifyHash()) {
      return false;
    }
    
    // Skip further checks for certain transaction types
    if (['MINT', 'REWARD'].includes(transaction.type)) {
      return true;
    }
    
    // For normal transactions, verify sender has enough balance
    if (transaction.type === 'TRANSFER') {
      const senderBalance = await this.getAddressBalance(transaction.from);
      return senderBalance >= (transaction.amount + transaction.fee);
    }
    
    // For validator registration
    if (transaction.type === 'VALIDATOR_REGISTER') {
      const senderBalance = await this.getAddressBalance(transaction.from);
      return senderBalance >= (transaction.amount + transaction.fee) && 
             transaction.amount >= this.validatorMinDeposit;
    }
    
    // For validator withdrawal
    if (transaction.type === 'VALIDATOR_WITHDRAW') {
      return this.validators.has(transaction.from);
    }
    
    // For message transactions
    if (transaction.type === 'MESSAGE') {
      // Check if sender has enough balance for fees if applicable
      if (transaction.fee > 0) {
        const senderBalance = await this.getAddressBalance(transaction.from);
        return senderBalance >= transaction.fee;
      }
      return true;
    }
    
    // For whitelist transactions
    if (transaction.type === 'WHITELIST') {
      return true; // No balance requirements for whitelisting
    }
    
    return false;
  }

  /**
   * Process a confirmed transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processTransaction(transaction) {
    // Store the transaction
    await this.db.put(`TX_${transaction.hash}`, JSON.stringify(transaction.toJSON()));
    
    // Process different transaction types
    switch (transaction.type) {
      case 'TRANSFER':
        await this.processTransferTransaction(transaction);
        break;
      case 'MINT':
        await this.processMintTransaction(transaction);
        break;
      case 'REWARD':
        await this.processRewardTransaction(transaction);
        break;
      case 'VALIDATOR_REGISTER':
        await this.processValidatorRegistration(transaction);
        break;
      case 'VALIDATOR_WITHDRAW':
        await this.processValidatorWithdrawal(transaction);
        break;
      case 'MESSAGE':
        await this.processMessageTransaction(transaction);
        break;
      case 'WHITELIST':
        await this.processWhitelistTransaction(transaction);
        break;
    }
    
    // Add to address transaction history
    if (transaction.from) {
      await this.addToAddressTransactions(transaction.from, transaction.hash);
    }
    if (transaction.to && transaction.to !== transaction.from) {
      await this.addToAddressTransactions(transaction.to, transaction.hash);
    }
  }

  /**
   * Process a transfer transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processTransferTransaction(transaction) {
    const senderBalance = await this.getAddressBalance(transaction.from);
    const recipientBalance = await this.getAddressBalance(transaction.to);
    
    // Deduct from sender
    await this.db.put(`BALANCE_${transaction.from}`, senderBalance - transaction.amount - transaction.fee);
    
    // Add to recipient
    await this.db.put(`BALANCE_${transaction.to}`, recipientBalance + transaction.amount);
  }

  /**
   * Process a mint transaction (for genesis block)
   * @param {Transaction} transaction - Transaction to process
   */
  async processMintTransaction(transaction) {
    const recipientBalance = await this.getAddressBalance(transaction.to);
    await this.db.put(`BALANCE_${transaction.to}`, recipientBalance + transaction.amount);
  }

  /**
   * Process a reward transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processRewardTransaction(transaction) {
    const recipientBalance = await this.getAddressBalance(transaction.to);
    await this.db.put(`BALANCE_${transaction.to}`, recipientBalance + transaction.amount);
  }

  /**
   * Process a validator registration transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processValidatorRegistration(transaction) {
    const senderBalance = await this.getAddressBalance(transaction.from);
    
    // Deduct staked amount + fee from sender
    await this.db.put(`BALANCE_${transaction.from}`, senderBalance - transaction.amount - transaction.fee);
    
    // Add to validators map
    const currentStake = this.validators.get(transaction.from) || 0;
    this.validators.set(transaction.from, currentStake + transaction.amount);
    
    // Update validators in the database
    await this.saveValidators();
    
    console.log(`Validator ${transaction.from} registered with ${transaction.amount} DOU stake`);
  }

  /**
   * Process a validator withdrawal transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processValidatorWithdrawal(transaction) {
    if (!this.validators.has(transaction.from)) {
      throw new Error('Not a validator');
    }
    
    const stakedAmount = this.validators.get(transaction.from);
    const senderBalance = await this.getAddressBalance(transaction.from);
    
    // Add staked amount back to sender balance
    await this.db.put(`BALANCE_${transaction.from}`, senderBalance + stakedAmount - transaction.fee);
    
    // Remove from validators
    this.validators.delete(transaction.from);
    
    // Update validators in the database
    await this.saveValidators();
    
    console.log(`Validator ${transaction.from} withdrew ${stakedAmount} DOU stake`);
  }

  /**
   * Process a message transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processMessageTransaction(transaction) {
    // Process sender fees or rewards
    if (transaction.fee > 0) {
      // This is a fee for sending to non-whitelisted address
      const senderBalance = await this.getAddressBalance(transaction.from);
      await this.db.put(`BALANCE_${transaction.from}`, senderBalance - transaction.fee);
    } else if (transaction.senderReward > 0) {
      // This is a reward for sending a message
      const senderBalance = await this.getAddressBalance(transaction.from);
      await this.db.put(`BALANCE_${transaction.from}`, senderBalance + transaction.senderReward);
    }
    
    // Process receiver rewards
    if (transaction.receiverReward > 0) {
      const receiverBalance = await this.getAddressBalance(transaction.to);
      await this.db.put(`BALANCE_${transaction.to}`, receiverBalance + transaction.receiverReward);
    }
    
    // Store the message
    await this.storeMessage(transaction);
  }

  /**
   * Process a whitelist transaction
   * @param {Transaction} transaction - Transaction to process
   */
  async processWhitelistTransaction(transaction) {
    try {
      // Load current whitelist
      const whitelistKey = `WHITELIST_${transaction.from}`;
      let whitelist = [];
      
      try {
        const whitelistData = await this.db.get(whitelistKey);
        whitelist = JSON.parse(whitelistData);
      } catch (err) {
        if (err.type !== 'NotFoundError') {
          throw err;
        }
      }
      
      // Add or remove from whitelist
      if (transaction.data.action === 'add') {
        if (!whitelist.includes(transaction.to)) {
          whitelist.push(transaction.to);
        }
      } else if (transaction.data.action === 'remove') {
        whitelist = whitelist.filter(addr => addr !== transaction.to);
      }
      
      // Save updated whitelist
      await this.db.put(whitelistKey, JSON.stringify(whitelist));
    } catch (err) {
      console.error('Failed to process whitelist transaction:', err);
    }
  }

  /**
   * Store a message in the database
   * @param {Transaction} transaction - Message transaction
   */
  async storeMessage(transaction) {
    // Store message in recipient's inbox
    const inboxKey = `INBOX_${transaction.to}`;
    let inbox = [];
    
    try {
      const inboxData = await this.db.get(inboxKey);
      inbox = JSON.parse(inboxData);
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    
    inbox.push({
      id: transaction.hash,
      from: transaction.from,
      content: transaction.data.message,
      timestamp: transaction.timestamp,
      read: false,
      reward: transaction.receiverReward
    });
    
    await this.db.put(inboxKey, JSON.stringify(inbox));
    
    // Store message in sender's outbox
    const outboxKey = `OUTBOX_${transaction.from}`;
    let outbox = [];
    
    try {
      const outboxData = await this.db.get(outboxKey);
      outbox = JSON.parse(outboxData);
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    
    outbox.push({
      id: transaction.hash,
      to: transaction.to,
      content: transaction.data.message,
      timestamp: transaction.timestamp,
      reward: transaction.senderReward,
      fee: transaction.fee
    });
    
    await this.db.put(outboxKey, JSON.stringify(outbox));
  }

  /**
   * Add a transaction to an address's transaction history
   * @param {string} address - Address
   * @param {string} txHash - Transaction hash
   */
  async addToAddressTransactions(address, txHash) {
    const key = `ADDRESS_TXS_${address}`;
    let transactions = [];
    
    try {
      const txData = await this.db.get(key);
      transactions = JSON.parse(txData);
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    
    transactions.push(txHash);
    await this.db.put(key, JSON.stringify(transactions));
  }

  /**
   * Get transactions for an address
   * @param {string} address - Address
   * @returns {Array} - Array of transaction hashes
   */
  async getAddressTransactions(address) {
    try {
      const txData = await this.db.get(`ADDRESS_TXS_${address}`);
      return JSON.parse(txData);
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Get balance for an address
   * @param {string} address - Address
   * @returns {number} - Balance
   */
  async getAddressBalance(address) {
    try {
      const balance = await this.db.get(`BALANCE_${address}`);
      return parseFloat(balance);
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return 0;
      }
      throw err;
    }
  }

  /**
   * Get a transaction by hash
   * @param {string} hash - Transaction hash
   * @returns {Transaction} - Transaction
   */
  async getTransaction(hash) {
    try {
      const txData = await this.db.get(`TX_${hash}`);
      return Transaction.fromJSON(JSON.parse(txData));
    } catch (err) {
      if (err.type === 'NotFoundError') {
        throw new Error(`Transaction not found: ${hash}`);
      }
      throw err;
    }
  }

  /**
   * Get whitelist for an address
   * @param {string} address - Address
   * @returns {Array} - Whitelisted addresses
   */
  async getWhitelist(address) {
    try {
      const whitelistData = await this.db.get(`WHITELIST_${address}`);
      return JSON.parse(whitelistData);
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Check if an address is whitelisted by another address
   * @param {string} owner - Owner address
   * @param {string} target - Target address
   * @returns {boolean} - Whether target is whitelisted
   */
  async isWhitelisted(owner, target) {
    const whitelist = await this.getWhitelist(owner);
    return whitelist.includes(target);
  }

  /**
   * Get messages for an address
   * @param {string} address - Address
   * @param {boolean} onlyUnread - Get only unread messages
   * @param {string} fromAddress - Filter by sender address
   * @returns {Array} - Messages
   */
  async getMessages(address, onlyUnread = false, fromAddress = null) {
    try {
      const inboxData = await this.db.get(`INBOX_${address}`);
      let messages = JSON.parse(inboxData);
      
      if (onlyUnread) {
        messages = messages.filter(msg => !msg.read);
      }
      
      if (fromAddress) {
        messages = messages.filter(msg => msg.from === fromAddress);
      }
      
      return messages;
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Mark a message as read
   * @param {string} address - Address
   * @param {string} messageId - Message ID
   */
  async markMessageAsRead(address, messageId) {
    try {
      const inboxKey = `INBOX_${address}`;
      const inboxData = await this.db.get(inboxKey);
      const messages = JSON.parse(inboxData);
      
      const updatedMessages = messages.map(msg => {
        if (msg.id === messageId) {
          return { ...msg, read: true };
        }
        return msg;
      });
      
      await this.db.put(inboxKey, JSON.stringify(updatedMessages));
    } catch (err) {
      throw new Error(`Failed to mark message as read: ${err.message}`);
    }
  }

  /**
   * Save validators to the database
   */
  async saveValidators() {
    const validatorsObj = {};
    for (const [address, amount] of this.validators.entries()) {
      validatorsObj[address] = amount;
    }
    await this.db.put('VALIDATORS', JSON.stringify(validatorsObj));
  }

  /**
   * Calculate monthly validator rewards
   * This should be called once a month
   */
  async calculateMonthlyValidatorRewards() {
    for (const [address, stakedAmount] of this.validators.entries()) {
      // Calculate monthly reward: APY / 12
      const monthlyRate = config.blockchain.validatorAPY / 12;
      const reward = stakedAmount * monthlyRate;
      
      // Create reward transaction
      const rewardTx = new Transaction(
        'REWARD',
        null,
        address,
        reward,
        0,
        { type: 'VALIDATOR_MONTHLY_REWARD' }
      );
      
      rewardTx.hash = rewardTx.calculateHash();
      
      // Add to pending transactions
      this.addTransaction(rewardTx);
      
      console.log(`Added monthly reward of ${reward} DOU for validator ${address}`);
    }
  }

  /**
   * Update validator minimum deposit (annual 10% increase)
   */
  async updateValidatorMinDeposit() {
    // Increase by 10%
    this.validatorMinDeposit *= 1.1;
    console.log(`Validator minimum deposit increased to ${this.validatorMinDeposit} DOU`);
    
    // Check and remove validators that don't meet the new minimum
    for (const [address, amount] of this.validators.entries()) {
      if (amount < this.validatorMinDeposit) {
        console.log(`Validator ${address} removed: staked amount (${amount}) below minimum (${this.validatorMinDeposit})`);
        
        // Return staked amount to validator
        const validatorBalance = await this.getAddressBalance(address);
        await this.db.put(`BALANCE_${address}`, validatorBalance + amount);
        
        // Remove from validators list
        this.validators.delete(address);
      }
    }
    
    // Save updated validators list
    await this.saveValidators();
  }

  /**
   * Sync blockchain with other nodes
   * This is a placeholder method to be implemented with libp2p
   */
  async syncBlockchain() {
    // This will be implemented in the network layer
    // For now, it's just a placeholder
  }

  /**
   * Get network statistics
   * @returns {Object} - Network statistics
   */
  async getNetworkStats() {
    const latestBlock = await this.getLatestBlock();
    
    let totalSupply = 0;
    try {
      totalSupply = parseFloat(await this.db.get('TOTAL_SUPPLY'));
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
    
    return {
      blockHeight: latestBlock.height,
      lastBlockTime: latestBlock.timestamp,
      validatorCount: this.validators.size,
      totalSupply: totalSupply,
      minimumValidatorDeposit: this.validatorMinDeposit
    };
  }
}

module.exports = Blockchain;

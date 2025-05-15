/**
 * Simplified Node implementation for DoucyA blockchain
 * A version that doesn't use libp2p for testing the local functionality
 */

'use strict';

const Blockchain = require('../blockchain/blockchain');
const Transaction = require('../blockchain/transaction');
const Block = require('../blockchain/block');
const ValidatorManager = require('../blockchain/validator');
const LevelDB = require('../storage/db');
const Message = require('../messaging/message');
const Group = require('../messaging/group');
const Channel = require('../messaging/channel');
const config = require('../config');
const Address = require('../blockchain/address');
const Encryption = require('../crypto/encryption');

class SimpleNode {
  /**
   * Create a new SimpleNode for DoucyA
   * @param {Object} wallet - Wallet for the node
   */
  constructor(wallet) {
    this.wallet = wallet;
    this.db = new LevelDB(config.storage.dbPath);
    this.blockchain = new Blockchain(this.db);
    this.validatorManager = new ValidatorManager(this.blockchain, this.db);
    this.messageGroups = new Map();
    this.messageChannels = new Map();
  }

  /**
   * Initialize the node
   */
  async initialize() {
    await this.db.open();
    await this.blockchain.initialize();
    await this.validatorManager.initialize();
    await this.loadGroups();
    await this.loadChannels();
    
    console.log('SimpleNode initialized successfully');
  }

  /**
   * Start the node
   */
  async start() {
    await this.initialize();
    
    console.log('Node started in simple mode (no networking)');
    
    // Start the blockchain
    const addresses = await this.wallet.listAddresses();
    let validatorAddress = null;
    
    // Check if any of our addresses are validators
    for (const address of addresses) {
      if (this.validatorManager.isValidator(address)) {
        validatorAddress = address;
        break;
      }
    }
    
    // If we're a validator, start creating blocks
    if (validatorAddress) {
      const privateKey = await this.wallet.getPrivateKey(validatorAddress);
      const signCallback = async (data) => {
        return Address.sign(data, privateKey);
      };
      
      await this.blockchain.start(validatorAddress, signCallback);
      console.log(`Started as validator with address: ${validatorAddress}`);
    } else {
      await this.blockchain.start();
      console.log('Started as regular node');
    }
  }
  
  /**
   * Load message groups from the database
   */
  async loadGroups() {
    try {
      const groupsData = await this.db.get('MESSAGE_GROUPS');
      if (groupsData) {
        const groups = JSON.parse(groupsData);
        for (const groupData of groups) {
          const group = Group.fromJSON(groupData);
          this.messageGroups.set(group.id, group);
        }
        console.log(`Loaded ${this.messageGroups.size} message groups`);
      }
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        console.error('Error loading message groups:', err);
      }
    }
  }
  
  /**
   * Load message channels from the database
   */
  async loadChannels() {
    try {
      const channelsData = await this.db.get('MESSAGE_CHANNELS');
      if (channelsData) {
        const channels = JSON.parse(channelsData);
        for (const channelData of channels) {
          const channel = Channel.fromJSON(channelData);
          this.messageChannels.set(channel.id, channel);
        }
        console.log(`Loaded ${this.messageChannels.size} message channels`);
      }
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        console.error('Error loading message channels:', err);
      }
    }
  }
  
  /**
   * Get address balance
   * @param {string} address - Address to check
   * @returns {Promise<number>} - Address balance
   */
  async getAddressBalance(address) {
    return await this.blockchain.getAddressBalance(address);
  }
  
  /**
   * Send tokens from one address to another
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @param {number} amount - Amount to send
   * @param {number} fee - Transaction fee
   * @returns {Promise<string>} - Transaction hash
   */
  async sendTokens(fromAddress, toAddress, amount, fee = 0.1) {
    // Validate addresses
    if (!Address.isValidAddress(fromAddress) || !Address.isValidAddress(toAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(fromAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Convert amount and fee to numbers
    amount = parseFloat(amount);
    fee = parseFloat(fee);
    
    // Check balance
    const balance = await this.blockchain.getAddressBalance(fromAddress);
    if (balance < amount + fee) {
      throw new Error(`Insufficient balance: ${balance} DOU (need ${amount + fee} DOU)`);
    }
    
    // For simplified version, directly update balances in the DB
    try {
      // Create a transaction ID
      const timestamp = Date.now();
      const txHash = `TX_${fromAddress.substring(0, 8)}_${toAddress.substring(0, 8)}_${timestamp}`;
      
      // Deduct from sender
      const newSenderBalance = balance - (amount + fee);
      await this.db.put(`BALANCE_${fromAddress}`, newSenderBalance.toString());
      
      // Add to recipient
      const recipientBalance = await this.blockchain.getAddressBalance(toAddress);
      const newRecipientBalance = recipientBalance + amount;
      await this.db.put(`BALANCE_${toAddress}`, newRecipientBalance.toString());
      
      // Store transaction record
      const transaction = {
        hash: txHash,
        type: 'TRANSFER',
        from: fromAddress,
        to: toAddress,
        amount: amount,
        fee: fee,
        timestamp: timestamp
      };
      
      await this.db.put(`TX_${txHash}`, JSON.stringify(transaction));
      
      // Add to address transaction histories
      await this.addToAddressTransactions(fromAddress, txHash);
      await this.addToAddressTransactions(toAddress, txHash);
      
      console.log(`Transfer completed: ${amount} DOU from ${fromAddress} to ${toAddress}`);
      return txHash;
    } catch (err) {
      throw new Error(`Failed to process transfer: ${err.message}`);
    }
  }
  
  /**
   * Add a transaction to an address's transaction history
   * @param {string} address - Address
   * @param {string} txHash - Transaction hash
   */
  async addToAddressTransactions(address, txHash) {
    try {
      const txsData = await this.db.get(`ADDRESS_TX_${address}`).catch(() => '[]');
      const txs = JSON.parse(txsData);
      txs.push(txHash);
      await this.db.put(`ADDRESS_TX_${address}`, JSON.stringify(txs));
    } catch (err) {
      console.error(`Failed to update transaction history for ${address}:`, err);
    }
  }
  
  /**
   * Add an address to whitelist
   * @param {string} fromAddress - Address doing the whitelisting
   * @param {string} toAddress - Address to whitelist
   * @returns {Promise<string>} - Transaction hash
   */
  async addToWhitelist(fromAddress, toAddress) {
    // Validate addresses
    if (!Address.isValidAddress(fromAddress) || !Address.isValidAddress(toAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(fromAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Create transaction
    const tx = Transaction.createWhitelist(fromAddress, toAddress, 'add');
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    return txHash;
  }
  
  /**
   * Remove an address from whitelist
   * @param {string} fromAddress - Address doing the un-whitelisting
   * @param {string} toAddress - Address to remove from whitelist
   * @returns {Promise<string>} - Transaction hash
   */
  async removeFromWhitelist(fromAddress, toAddress) {
    // Validate addresses
    if (!Address.isValidAddress(fromAddress) || !Address.isValidAddress(toAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(fromAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Create transaction
    const tx = Transaction.createWhitelist(fromAddress, toAddress, 'remove');
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    return txHash;
  }
  
  /**
   * Get whitelist for an address
   * @param {string} address - Address
   * @returns {Promise<Array>} - Whitelist
   */
  async getWhitelist(address) {
    return this.blockchain.getWhitelist(address);
  }
  
  /**
   * Send a message from one address to another
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @param {string} message - Message content
   * @returns {Promise<Object>} - Result
   */
  async sendMessage(fromAddress, toAddress, message) {
    // Validate addresses
    if (!Address.isValidAddress(fromAddress) || !Address.isValidAddress(toAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(fromAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Check if recipient whitelisted sender
    const isWhitelisted = await this.blockchain.isWhitelisted(toAddress, fromAddress);
    
    // Create message transaction
    const tx = Transaction.createMessage(fromAddress, toAddress, message, isWhitelisted);
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    const result = {
      status: 'success',
      messageId: txHash
    };
    
    if (isWhitelisted) {
      result.reward = config.messaging.sendReward;
    } else {
      result.fee = config.messaging.nonWhitelistedFee;
    }
    
    return result;
  }
  
  /**
   * Get transactions for an address
   * @param {string} address - Address
   * @returns {Promise<Array>} - Array of transaction hashes
   */
  async getAddressTransactions(address) {
    return this.blockchain.getAddressTransactions(address);
  }
  
  /**
   * Get messages for an address
   * @param {string} address - Address
   * @param {boolean} onlyUnread - Get only unread messages
   * @param {string} fromAddress - Filter by sender address
   * @returns {Promise<Array>} - Messages
   */
  async getMessages(address, onlyUnread = false, fromAddress = null) {
    return this.blockchain.getMessages(address, onlyUnread, fromAddress);
  }
  
  /**
   * Become a validator
   * @param {string} address - Address to become validator
   * @param {number} amount - Amount to stake
   * @returns {Promise<string>} - Transaction hash
   */
  async becomeValidator(address, amount) {
    // Validate address
    if (!Address.isValidAddress(address)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(address);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Check if amount is enough
    if (amount < this.validatorManager.minimumDeposit) {
      throw new Error(`Minimum deposit is ${this.validatorManager.minimumDeposit} DOU`);
    }
    
    // Check balance
    const balance = await this.blockchain.getAddressBalance(address);
    if (balance < amount) {
      throw new Error(`Insufficient balance: ${balance} DOU (need ${amount} DOU)`);
    }
    
    // Create transaction
    const tx = Transaction.createValidatorRegister(address, amount, 0.1);
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    return txHash;
  }
  
  /**
   * Stop being a validator
   * @param {string} address - Validator address
   * @returns {Promise<string>} - Transaction hash
   */
  async stopValidating(address) {
    // Validate address
    if (!Address.isValidAddress(address)) {
      throw new Error('Invalid address format');
    }
    
    // Check if address is a validator
    if (!this.validatorManager.isValidator(address)) {
      throw new Error('Address is not a validator');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(address);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Create transaction
    const tx = Transaction.createValidatorWithdraw(address, 0.1);
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    return txHash;
  }
  
  /**
   * Create a group
   * @param {string} ownerAddress - Group owner address
   * @param {string} groupName - Group name
   * @param {boolean} isPrivate - Whether the group is private
   * @returns {Promise<string>} - Group ID
   */
  async createGroup(ownerAddress, groupName, isPrivate = false) {
    // Validate address
    if (!Address.isValidAddress(ownerAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(ownerAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Create group
    const group = new Group(groupName, ownerAddress, isPrivate);
    
    // Save group
    this.messageGroups.set(group.id, group);
    await this.saveGroups();
    
    return group.id;
  }
  
  /**
   * Create a channel
   * @param {string} ownerAddress - Channel owner address
   * @param {string} channelName - Channel name
   * @param {boolean} isPrivate - Whether the channel is private
   * @returns {Promise<string>} - Channel ID
   */
  async createChannel(ownerAddress, channelName, isPrivate = false) {
    // Validate address
    if (!Address.isValidAddress(ownerAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(ownerAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Create channel
    const channel = new Channel(channelName, ownerAddress, isPrivate);
    
    // Save channel
    this.messageChannels.set(channel.id, channel);
    await this.saveChannels();
    
    return channel.id;
  }
  
  /**
   * Save message groups to the database
   */
  async saveGroups() {
    const groups = Array.from(this.messageGroups.values()).map(group => group.toJSON());
    await this.db.put('MESSAGE_GROUPS', JSON.stringify(groups));
  }
  
  /**
   * Save message channels to the database
   */
  async saveChannels() {
    const channels = Array.from(this.messageChannels.values()).map(channel => channel.toJSON());
    await this.db.put('MESSAGE_CHANNELS', JSON.stringify(channels));
  }
}

module.exports = SimpleNode;
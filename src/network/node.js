/**
 * Node implementation for DoucyA blockchain
 * Manages the network and blockchain functionality
 */

'use strict';

const libp2p = require('libp2p');
const { TCP } = require('libp2p-tcp');
const { Mplex } = require('libp2p-mplex');
const { Noise } = require('libp2p-noise');
const { Bootstrap } = require('libp2p-bootstrap');
const { GossipSub } = require('libp2p-gossipsub');
const { PubSubPeerDiscovery } = require('libp2p-pubsub-peer-discovery');
const uint8ArrayFromString = require('uint8arrays/from-string');
const uint8ArrayToString = require('uint8arrays/to-string');

const Blockchain = require('../blockchain/blockchain');
const Transaction = require('../blockchain/transaction');
const Block = require('../blockchain/block');
const ValidatorManager = require('../blockchain/validator');
const LevelDB = require('../storage/db');
const Message = require('../messaging/message');
const Group = require('../messaging/group');
const Channel = require('../messaging/channel');
const config = require('../config');
const Protocol = require('./protocol');
const Address = require('../blockchain/address');
const Encryption = require('../crypto/encryption');

class Node {
  /**
   * Create a new DoucyA node
   * @param {Object} wallet - Wallet for the node
   */
  constructor(wallet) {
    this.libp2p = null;
    this.wallet = wallet;
    this.db = new LevelDB(config.storage.dbPath);
    this.blockchain = new Blockchain(this.db);
    this.validatorManager = new ValidatorManager(this.blockchain, this.db);
    this.protocol = new Protocol(this);
    this.bootstrapped = false;
    this.peers = new Map();
    this.messageGroups = new Map();
    this.messageChannels = new Map();
    
    // Track rate limiting for messages
    this.messageCounts = {
      // address -> { total: number, perAddress: { address: number } }
      hourly: new Map()
    };
    
    // Period to reset rate limiting counters
    this.hourlyResetInterval = 60 * 60 * 1000; // 1 hour
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
    
    // Set up message rate limit reset interval
    setInterval(() => this.resetMessageCounts(), this.hourlyResetInterval);
  }

  /**
   * Start the node
   * @param {number} port - Port to listen on
   * @param {Array} bootstrapNodes - Libp2p multiaddrs of bootstrap nodes
   */
  async start(port = config.network.defaultPort, bootstrapNodes = config.network.bootstrapNodes) {
    await this.initialize();
    
    // Create libp2p node
    this.libp2p = await libp2p.create({
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${port}`]
      },
      modules: {
        transport: [TCP],
        streamMuxer: [Mplex],
        connEncryption: [Noise],
        pubsub: GossipSub,
        peerDiscovery: [Bootstrap, PubSubPeerDiscovery]
      },
      config: {
        peerDiscovery: {
          bootstrap: {
            interval: config.network.discoveryInterval,
            enabled: bootstrapNodes.length > 0,
            list: bootstrapNodes
          },
          pubsub: {
            enabled: true,
            interval: config.network.announceInterval,
            emitSelf: false
          }
        },
        pubsub: {
          enabled: true,
          emitSelf: false
        }
      }
    });
    
    // Set up protocol handlers
    await this.protocol.initialize();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start the node
    await this.libp2p.start();
    console.log('Node started with peer ID:', this.libp2p.peerId.toString());
    
    // Subscribe to blockchain topics
    await this.libp2p.pubsub.subscribe('doucya:blocks');
    await this.libp2p.pubsub.subscribe('doucya:transactions');
    await this.libp2p.pubsub.subscribe('doucya:validators');
    
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
    
    // Check for initial token distribution if first 10 nodes
    await this.checkInitialDistribution();
  }

  /**
   * Set up libp2p event listeners
   */
  setupEventListeners() {
    // Connection events
    this.libp2p.connectionManager.on('peer:connect', this.handlePeerConnect.bind(this));
    this.libp2p.connectionManager.on('peer:disconnect', this.handlePeerDisconnect.bind(this));
    
    // Pubsub message events
    this.libp2p.pubsub.on('doucya:blocks', this.handleBlockMessage.bind(this));
    this.libp2p.pubsub.on('doucya:transactions', this.handleTransactionMessage.bind(this));
    this.libp2p.pubsub.on('doucya:validators', this.handleValidatorMessage.bind(this));
  }

  /**
   * Handle connection to a peer
   * @param {Connection} connection - Libp2p connection
   */
  handlePeerConnect(connection) {
    const peerId = connection.remotePeer.toString();
    console.log('Connected to peer:', peerId);
    
    // Add peer to our list
    this.peers.set(peerId, {
      id: peerId,
      connectedAt: Date.now()
    });
    
    // Sync blockchain and validators
    this.syncWithPeer(peerId).catch(err => {
      console.error('Error syncing with peer:', err);
    });
  }

  /**
   * Handle disconnect from a peer
   * @param {Connection} connection - Libp2p connection
   */
  handlePeerDisconnect(connection) {
    const peerId = connection.remotePeer.toString();
    console.log('Disconnected from peer:', peerId);
    
    // Remove peer from our list
    this.peers.delete(peerId);
  }

  /**
   * Handle block message from pubsub
   * @param {Message} message - Libp2p pubsub message
   */
  async handleBlockMessage(message) {
    try {
      const blockData = JSON.parse(uint8ArrayToString(message.data));
      const block = Block.fromJSON(blockData);
      
      // Verify the block before adding it
      const latestBlock = await this.blockchain.getLatestBlock();
      
      // Ignore blocks we already have
      if (block.height <= latestBlock.height) {
        return;
      }
      
      // Check if block builds on our chain
      if (block.height > latestBlock.height + 1) {
        // We're behind, need to sync
        await this.syncBlockchain();
        return;
      }
      
      // Verify block is valid
      if (block.previousHash !== latestBlock.hash) {
        console.error('Block has invalid previous hash');
        return;
      }
      
      // Verify block signature
      const isValid = await block.verifySignature(
        async (hash, signature, address) => {
          // Lookup validator's public key
          const publicKey = await this.getPublicKeyForAddress(address);
          if (!publicKey) return false;
          
          return Address.verifySignature(hash, signature, publicKey);
        }
      );
      
      if (!isValid) {
        console.error('Block has invalid signature');
        return;
      }
      
      // Process the block
      await this.blockchain.saveBlock(block);
      console.log(`Added block #${block.height} from peer`);
    } catch (err) {
      console.error('Error processing block message:', err);
    }
  }

  /**
   * Handle transaction message from pubsub
   * @param {Message} message - Libp2p pubsub message
   */
  async handleTransactionMessage(message) {
    try {
      const txData = JSON.parse(uint8ArrayToString(message.data));
      const tx = Transaction.fromJSON(txData);
      
      // Check if we already have this transaction
      try {
        await this.blockchain.getTransaction(tx.hash);
        // We already have this transaction, ignore
        return;
      } catch (err) {
        // Transaction not found, continue processing
      }
      
      // Verify transaction
      if (!tx.verifyHash()) {
        console.error('Invalid transaction hash');
        return;
      }
      
      // Add to pending transactions
      this.blockchain.addTransaction(tx);
      console.log(`Added transaction ${tx.hash} from peer`);
    } catch (err) {
      console.error('Error processing transaction message:', err);
    }
  }

  /**
   * Handle validator message from pubsub
   * @param {Message} message - Libp2p pubsub message
   */
  async handleValidatorMessage(message) {
    try {
      const validatorData = JSON.parse(uint8ArrayToString(message.data));
      
      // Update validator information
      if (validatorData.action === 'register') {
        this.validatorManager.registerValidator(
          validatorData.address,
          validatorData.amount
        );
      } else if (validatorData.action === 'withdraw') {
        this.validatorManager.removeValidator(validatorData.address);
      }
      
      // Save validator state
      await this.validatorManager.save();
    } catch (err) {
      console.error('Error processing validator message:', err);
    }
  }

  /**
   * Sync blockchain with a specific peer
   * @param {string} peerId - Peer ID to sync with
   */
  async syncWithPeer(peerId) {
    try {
      // Get latest block height from peer
      const response = await this.protocol.request(peerId, '/doucya/sync/height');
      const peerHeight = parseInt(response.height, 10);
      
      // Get our latest block
      const latestBlock = await this.blockchain.getLatestBlock();
      
      if (peerHeight > latestBlock.height) {
        console.log(`Peer ${peerId} has higher block height (${peerHeight} vs ${latestBlock.height})`);
        
        // Request blocks we don't have
        for (let i = latestBlock.height + 1; i <= peerHeight; i++) {
          const blockResponse = await this.protocol.request(peerId, '/doucya/sync/block', { height: i });
          const block = Block.fromJSON(blockResponse);
          
          // Verify and add the block
          await this.blockchain.saveBlock(block);
          console.log(`Synced block #${i} from peer ${peerId}`);
        }
      }
      
      // Sync validators
      const validatorsResponse = await this.protocol.request(peerId, '/doucya/sync/validators');
      for (const [address, amount] of Object.entries(validatorsResponse.validators)) {
        if (!this.validatorManager.isValidator(address)) {
          this.validatorManager.registerValidator(address, amount);
        }
      }
      
      await this.validatorManager.save();
    } catch (err) {
      console.error(`Error syncing with peer ${peerId}:`, err);
    }
  }

  /**
   * Sync blockchain with network
   */
  async syncBlockchain() {
    // Skip if no peers
    if (this.peers.size === 0) {
      return;
    }
    
    // Pick a random peer to sync with
    const peerIds = Array.from(this.peers.keys());
    const randomPeerId = peerIds[Math.floor(Math.random() * peerIds.length)];
    
    await this.syncWithPeer(randomPeerId);
  }

  /**
   * Check for initial token distribution for first 10 nodes
   */
  async checkInitialDistribution() {
    try {
      // Check if we already received initial tokens
      const receivedInitial = await this.db.get('RECEIVED_INITIAL_TOKENS');
      if (receivedInitial === 'true') {
        return;
      }
    } catch (err) {
      // Key not found, continue
    }
    
    // Get our addresses
    const addresses = await this.wallet.listAddresses();
    if (addresses.length === 0) {
      // No addresses yet, create one
      const { address } = await this.wallet.createAddress();
      addresses.push(address);
    }
    
    // Request initial tokens from a connected peer
    if (this.peers.size > 0) {
      try {
        const peerIds = Array.from(this.peers.keys());
        for (const peerId of peerIds) {
          try {
            const response = await this.protocol.request(peerId, '/doucya/initial-tokens', {
              address: addresses[0]
            });
            
            if (response.success) {
              console.log(`Received initial ${config.blockchain.initialSupply} DOU tokens!`);
              await this.db.put('RECEIVED_INITIAL_TOKENS', 'true');
              break;
            }
          } catch (err) {
            // Try next peer
          }
        }
      } catch (err) {
        console.error('Failed to request initial tokens:', err);
      }
    }
  }

  /**
   * Get public key for an address
   * @param {string} address - Address to get public key for
   * @returns {string|null} - Public key or null if not found
   */
  async getPublicKeyForAddress(address) {
    try {
      return await this.db.get(`PUBKEY_${address}`);
    } catch (err) {
      // If not found locally, try to get from peers
      if (this.peers.size > 0) {
        const peerIds = Array.from(this.peers.keys());
        for (const peerId of peerIds) {
          try {
            const response = await this.protocol.request(peerId, '/doucya/address/pubkey', {
              address
            });
            
            if (response.publicKey) {
              // Store for future use
              await this.db.put(`PUBKEY_${address}`, response.publicKey);
              return response.publicKey;
            }
          } catch (err) {
            // Try next peer
          }
        }
      }
      return null;
    }
  }

  /**
   * Send DOU tokens to another address
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @param {number} amount - Amount to send
   * @param {number} fee - Transaction fee
   * @returns {string} - Transaction hash
   */
  async sendTokens(fromAddress, toAddress, amount, fee) {
    // Validate addresses
    if (!Address.isValidAddress(fromAddress) || !Address.isValidAddress(toAddress)) {
      throw new Error('Invalid address format');
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(fromAddress);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Check balance
    const balance = await this.blockchain.getAddressBalance(fromAddress);
    if (balance < amount + fee) {
      throw new Error(`Insufficient balance: ${balance} DOU (need ${amount + fee} DOU)`);
    }
    
    // Create transaction
    const tx = Transaction.createTransfer(fromAddress, toAddress, amount, fee);
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    // Broadcast to network
    await this.broadcastTransaction(tx);
    
    return txHash;
  }

  /**
   * Add an address to whitelist
   * @param {string} fromAddress - Address doing the whitelisting
   * @param {string} toAddress - Address to whitelist
   * @returns {string} - Transaction hash
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
    
    // Broadcast to network
    await this.broadcastTransaction(tx);
    
    return txHash;
  }

  /**
   * Remove an address from whitelist
   * @param {string} fromAddress - Address removing from whitelist
   * @param {string} toAddress - Address to remove
   * @returns {string} - Transaction hash
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
    
    // Broadcast to network
    await this.broadcastTransaction(tx);
    
    return txHash;
  }

  /**
   * Get whitelist for an address
   * @param {string} address - Address to get whitelist for
   * @returns {Array} - Array of whitelisted addresses
   */
  async getWhitelist(address) {
    return await this.blockchain.getWhitelist(address);
  }

  /**
   * Send a message to another address
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @param {string} message - Message content
   * @returns {Object} - Result with status, messageId, and reward/fee info
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
    
    // Check message rate limits
    await this.checkMessageRateLimits(fromAddress, toAddress);
    
    // Check if recipient has whitelisted sender
    const isWhitelisted = await this.blockchain.isWhitelisted(toAddress, fromAddress);
    
    // Encrypt message
    const encryptedMessage = await Encryption.encryptMessage(
      message,
      await this.getPublicKeyForAddress(toAddress) // This will be null if not found, handled by encryption function
    );
    
    // Create transaction
    const tx = Transaction.createMessage(
      fromAddress,
      toAddress,
      encryptedMessage,
      isWhitelisted
    );
    
    // Set rewards based on whitelist status
    if (isWhitelisted) {
      tx.senderReward = config.messaging.sendReward;
      tx.receiverReward = config.messaging.receiveReward;
    } else {
      tx.fee = config.messaging.nonWhitelistedFee;
    }
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    // Broadcast to network
    await this.broadcastTransaction(tx);
    
    // Update message count for rate limiting
    this.updateMessageCount(fromAddress, toAddress);
    
    // Return result
    return {
      status: 'success',
      messageId: txHash,
      reward: isWhitelisted ? config.messaging.sendReward : 0,
      fee: isWhitelisted ? 0 : config.messaging.nonWhitelistedFee
    };
  }

  /**
   * Check message rate limits
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   * @throws {Error} - If rate limit exceeded
   */
  async checkMessageRateLimits(fromAddress, toAddress) {
    const hourlyStats = this.messageCounts.hourly.get(fromAddress) || { 
      total: 0, 
      perAddress: {} 
    };
    
    // Check total message limit
    if (hourlyStats.total >= config.messaging.maxMessagesPerHour) {
      throw new Error(`Message rate limit exceeded: ${hourlyStats.total}/${config.messaging.maxMessagesPerHour} messages per hour`);
    }
    
    // Check per-address message limit
    const perAddressCount = hourlyStats.perAddress[toAddress] || 0;
    if (perAddressCount >= config.messaging.maxMessagesToAddressPerHour) {
      throw new Error(`Message rate limit to ${toAddress} exceeded: ${perAddressCount}/${config.messaging.maxMessagesToAddressPerHour} messages per hour`);
    }
  }

  /**
   * Update message count for rate limiting
   * @param {string} fromAddress - Sender address
   * @param {string} toAddress - Recipient address
   */
  updateMessageCount(fromAddress, toAddress) {
    let hourlyStats = this.messageCounts.hourly.get(fromAddress);
    
    if (!hourlyStats) {
      hourlyStats = { total: 0, perAddress: {} };
      this.messageCounts.hourly.set(fromAddress, hourlyStats);
    }
    
    // Update counts
    hourlyStats.total++;
    hourlyStats.perAddress[toAddress] = (hourlyStats.perAddress[toAddress] || 0) + 1;
  }

  /**
   * Reset message rate limiting counters
   */
  resetMessageCounts() {
    this.messageCounts.hourly.clear();
  }

  /**
   * Get messages for an address
   * @param {string} address - Address to get messages for
   * @param {boolean} onlyNew - Whether to get only unread messages
   * @param {string} fromAddress - Optional filter by sender
   * @returns {Array} - Array of messages
   */
  async getMessages(address, onlyNew = false, fromAddress = null) {
    // Get messages from blockchain
    const messages = await this.blockchain.getMessages(address, onlyNew, fromAddress);
    
    // Decrypt messages
    const privateKey = await this.wallet.getPrivateKey(address);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Decrypt each message
    const decryptedMessages = [];
    for (const msg of messages) {
      try {
        const decryptedContent = await Encryption.decryptMessage(
          msg.content,
          privateKey,
          await this.getPublicKeyForAddress(msg.from)
        );
        
        decryptedMessages.push({
          ...msg,
          content: decryptedContent
        });
        
        // Mark as read if it was unread
        if (!msg.read) {
          await this.blockchain.markMessageAsRead(address, msg.id);
        }
      } catch (err) {
        console.error(`Error decrypting message ${msg.id}:`, err);
        // Include with error message
        decryptedMessages.push({
          ...msg,
          content: '[Encrypted message - cannot decrypt]'
        });
      }
    }
    
    return decryptedMessages;
  }

  /**
   * Create a message group
   * @param {string} ownerAddress - Group owner address
   * @param {string} name - Group name
   * @param {boolean} isPrivate - Whether the group is private
   * @returns {string} - Group ID
   */
  async createGroup(ownerAddress, name, isPrivate = false) {
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
    const group = new Group(name, ownerAddress, isPrivate);
    
    // Save group
    await this.db.put(`GROUP_${group.id}`, JSON.stringify(group.toJSON()));
    
    // Add to group list
    await this.addToGroupList(group.id);
    
    // Broadcast group creation
    await this.broadcastGroup(group);
    
    return group.id;
  }

  /**
   * Create a broadcast channel
   * @param {string} ownerAddress - Channel owner address
   * @param {string} name - Channel name
   * @param {boolean} isPrivate - Whether the channel is private
   * @returns {string} - Channel ID
   */
  async createChannel(ownerAddress, name, isPrivate = false) {
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
    const channel = new Channel(name, ownerAddress, isPrivate);
    
    // Save channel
    await this.db.put(`CHANNEL_${channel.id}`, JSON.stringify(channel.toJSON()));
    
    // Add to channel list
    await this.addToChannelList(channel.id);
    
    // Broadcast channel creation
    await this.broadcastChannel(channel);
    
    return channel.id;
  }

  /**
   * Add group ID to group list
   * @param {string} groupId - Group ID
   */
  async addToGroupList(groupId) {
    try {
      let groups = [];
      try {
        const groupsData = await this.db.get('GROUPS');
        groups = JSON.parse(groupsData);
      } catch (err) {
        if (err.type !== 'NotFoundError') {
          throw err;
        }
      }
      
      if (!groups.includes(groupId)) {
        groups.push(groupId);
      }
      
      await this.db.put('GROUPS', JSON.stringify(groups));
    } catch (err) {
      console.error('Error adding to group list:', err);
    }
  }

  /**
   * Add channel ID to channel list
   * @param {string} channelId - Channel ID
   */
  async addToChannelList(channelId) {
    try {
      let channels = [];
      try {
        const channelsData = await this.db.get('CHANNELS');
        channels = JSON.parse(channelsData);
      } catch (err) {
        if (err.type !== 'NotFoundError') {
          throw err;
        }
      }
      
      if (!channels.includes(channelId)) {
        channels.push(channelId);
      }
      
      await this.db.put('CHANNELS', JSON.stringify(channels));
    } catch (err) {
      console.error('Error adding to channel list:', err);
    }
  }

  /**
   * Load groups from storage
   */
  async loadGroups() {
    try {
      const groupsData = await this.db.get('GROUPS');
      const groupIds = JSON.parse(groupsData);
      
      for (const groupId of groupIds) {
        try {
          const groupData = await this.db.get(`GROUP_${groupId}`);
          const group = Group.fromJSON(JSON.parse(groupData));
          this.messageGroups.set(groupId, group);
        } catch (err) {
          console.error(`Error loading group ${groupId}:`, err);
        }
      }
      
      console.log(`Loaded ${this.messageGroups.size} groups`);
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        console.error('Error loading groups:', err);
      }
    }
  }

  /**
   * Load channels from storage
   */
  async loadChannels() {
    try {
      const channelsData = await this.db.get('CHANNELS');
      const channelIds = JSON.parse(channelsData);
      
      for (const channelId of channelIds) {
        try {
          const channelData = await this.db.get(`CHANNEL_${channelId}`);
          const channel = Channel.fromJSON(JSON.parse(channelData));
          this.messageChannels.set(channelId, channel);
        } catch (err) {
          console.error(`Error loading channel ${channelId}:`, err);
        }
      }
      
      console.log(`Loaded ${this.messageChannels.size} channels`);
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        console.error('Error loading channels:', err);
      }
    }
  }

  /**
   * Get address balance
   * @param {string} address - Address to get balance for
   * @returns {number} - Balance in DOU
   */
  async getAddressBalance(address) {
    return await this.blockchain.getAddressBalance(address);
  }

  /**
   * Broadcast a transaction to the network
   * @param {Transaction} transaction - Transaction to broadcast
   */
  async broadcastTransaction(transaction) {
    await this.libp2p.pubsub.publish(
      'doucya:transactions',
      uint8ArrayFromString(JSON.stringify(transaction.toJSON()))
    );
  }

  /**
   * Broadcast a group to the network
   * @param {Group} group - Group to broadcast
   */
  async broadcastGroup(group) {
    await this.libp2p.pubsub.publish(
      'doucya:groups',
      uint8ArrayFromString(JSON.stringify(group.toJSON()))
    );
  }

  /**
   * Broadcast a channel to the network
   * @param {Channel} channel - Channel to broadcast
   */
  async broadcastChannel(channel) {
    await this.libp2p.pubsub.publish(
      'doucya:channels',
      uint8ArrayFromString(JSON.stringify(channel.toJSON()))
    );
  }

  /**
   * Register as a validator
   * @param {string} address - Address to register as validator
   * @param {number} amount - Amount to stake
   * @param {number} fee - Transaction fee
   * @returns {string} - Transaction hash
   */
  async becomeValidator(address, amount, fee = 0.1) {
    // Validate address
    if (!Address.isValidAddress(address)) {
      throw new Error('Invalid address format');
    }
    
    // Check if amount is sufficient
    if (amount < this.validatorManager.minimumDeposit) {
      throw new Error(`Minimum stake is ${this.validatorManager.minimumDeposit} DOU`);
    }
    
    // Check if we have the private key
    const privateKey = await this.wallet.getPrivateKey(address);
    if (!privateKey) {
      throw new Error('Address not found in wallet');
    }
    
    // Check balance
    const balance = await this.blockchain.getAddressBalance(address);
    if (balance < amount + fee) {
      throw new Error(`Insufficient balance: ${balance} DOU (need ${amount + fee} DOU)`);
    }
    
    // Create transaction
    const tx = Transaction.createValidatorRegister(address, amount, fee);
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    // Broadcast to network
    await this.broadcastTransaction(tx);
    
    // Also broadcast validator info
    await this.libp2p.pubsub.publish(
      'doucya:validators',
      uint8ArrayFromString(JSON.stringify({
        action: 'register',
        address,
        amount
      }))
    );
    
    return txHash;
  }

  /**
   * Stop being a validator
   * @param {string} address - Validator address
   * @param {number} fee - Transaction fee
   * @returns {string} - Transaction hash
   */
  async stopValidating(address, fee = 0.1) {
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
    
    // Check balance for fee
    const balance = await this.blockchain.getAddressBalance(address);
    if (balance < fee) {
      throw new Error(`Insufficient balance for fee: ${balance} DOU (need ${fee} DOU)`);
    }
    
    // Create transaction
    const tx = Transaction.createValidatorWithdraw(address, fee);
    
    // Sign transaction
    await tx.sign(async (data) => {
      return Address.sign(data, privateKey);
    });
    
    // Add to blockchain
    const txHash = this.blockchain.addTransaction(tx);
    
    // Broadcast to network
    await this.broadcastTransaction(tx);
    
    // Also broadcast validator info
    await this.libp2p.pubsub.publish(
      'doucya:validators',
      uint8ArrayFromString(JSON.stringify({
        action: 'withdraw',
        address
      }))
    );
    
    return txHash;
  }

  /**
   * Stop the node
   */
  async stop() {
    // Stop blockchain
    this.blockchain.stop();
    
    // Stop libp2p
    if (this.libp2p && this.libp2p.isStarted()) {
      await this.libp2p.stop();
    }
    
    // Close database
    await this.db.close();
    
    console.log('Node stopped');
  }
}

module.exports = Node;

/**
 * P2P Node implementation for DoucyA blockchain
 * Using compatible libp2p libraries
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

class P2PNode {
  /**
   * Create a new DoucyA node with p2p functionality
   * @param {Object} wallet - Wallet for the node
   */
  constructor(wallet) {
    this.libp2p = null;
    this.wallet = wallet;
    this.db = new LevelDB(config.storage.dbPath);
    this.blockchain = new Blockchain(this.db);
    this.validatorManager = new ValidatorManager(this.blockchain, this.db);
    this.protocol = null; // Will be initialized after libp2p is created
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
    
    console.log('P2P Node initialized');
  }

  /**
   * Start the node
   * @param {number} port - Port to listen on
   * @param {Array} bootstrapNodes - Libp2p multiaddrs of bootstrap nodes
   */
  async start(port = config.network.defaultPort, bootstrapNodes = config.network.bootstrapNodes) {
    await this.initialize();
    
    console.log(`Starting P2P node on port ${port}...`);
    console.log(`Bootstrap nodes: ${bootstrapNodes.length > 0 ? bootstrapNodes.join(', ') : 'None'}`);
    
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
    
    // Initialize protocol handler
    this.protocol = new Protocol(this);
    await this.protocol.initialize();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Start the node
    await this.libp2p.start();
    console.log('P2P Node started with peer ID:', this.libp2p.peerId.toString());
    
    // Subscribe to blockchain topics
    await this.libp2p.pubsub.subscribe('doucya:blocks');
    await this.libp2p.pubsub.subscribe('doucya:transactions');
    await this.libp2p.pubsub.subscribe('doucya:validators');
    
    // Start the blockchain
    const addresses = await this.wallet.listAddresses();
    let validatorAddress = null;
    
    // Check if any of our addresses are validators
    for (const address of addresses) {
      if (await this.validatorManager.isValidator(address)) {
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
    
    // Check for initial token distribution if this is a new node
    await this.checkInitialDistribution();
    
    console.log('P2P Node fully initialized and running');
    return this.libp2p.peerId.toString();
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
  async handlePeerConnect(connection) {
    const peerId = connection.remotePeer.toString();
    console.log('Connected to peer:', peerId);
    
    // Add peer to our list
    this.peers.set(peerId, {
      id: peerId,
      connectedAt: Date.now()
    });
    
    // Sync blockchain and validators with new peer
    try {
      await this.syncWithPeer(peerId);
      console.log(`Successfully synced with peer ${peerId}`);
    } catch (err) {
      console.error(`Error syncing with peer ${peerId}:`, err.message);
    }
  }

  /**
   * Handle disconnect from a peer
   * @param {Connection} connection - Libp2p connection
   */
  async handlePeerDisconnect(connection) {
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
      
      console.log(`Received block #${block.height} from network`);
      
      // Verify the block before adding it
      const latestBlock = await this.blockchain.getLatestBlock().catch(() => ({ height: -1, hash: null }));
      
      // Ignore blocks we already have
      if (latestBlock && block.height <= latestBlock.height) {
        console.log(`Ignoring block #${block.height} as we already have it`);
        return;
      }
      
      // Check if block builds on our chain
      if (block.height > latestBlock.height + 1) {
        // We're behind, need to sync
        console.log(`Received block #${block.height} but we're at ${latestBlock.height}, syncing...`);
        await this.syncBlockchain();
        return;
      }
      
      // Verify block is valid
      if (latestBlock.height >= 0 && block.previousHash !== latestBlock.hash) {
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
      console.error('Error processing block message:', err.message);
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
      
      console.log(`Received transaction ${tx.hash} from network`);
      
      // Check if we already have this transaction
      try {
        await this.blockchain.getTransaction(tx.hash);
        // We already have this transaction, ignore
        console.log(`Ignoring transaction ${tx.hash} as we already have it`);
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
      await this.blockchain.addTransaction(tx);
      console.log(`Added transaction ${tx.hash} from peer to pending pool`);
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
      
      console.log(`Received validator update: ${validatorData.action} for ${validatorData.address}`);
      
      // Update validator information
      if (validatorData.action === 'register') {
        await this.validatorManager.registerValidator(
          validatorData.address,
          validatorData.amount
        );
        console.log(`Registered validator ${validatorData.address} with stake ${validatorData.amount}`);
      } else if (validatorData.action === 'withdraw') {
        await this.validatorManager.removeValidator(validatorData.address);
        console.log(`Removed validator ${validatorData.address}`);
      }
      
      // Save validator state
      await this.validatorManager.save();
    } catch (err) {
      console.error('Error processing validator message:', err);
    }
  }

  /**
   * Broadcast a transaction to the network
   * @param {Transaction} transaction - Transaction to broadcast
   */
  async broadcastTransaction(transaction) {
    if (!this.libp2p || !this.libp2p.isStarted()) {
      console.log('Not broadcasting transaction - p2p node not started');
      return;
    }
    
    try {
      const txData = uint8ArrayFromString(JSON.stringify(transaction));
      await this.libp2p.pubsub.publish('doucya:transactions', txData);
      console.log(`Broadcasted transaction ${transaction.hash} to network`);
    } catch (err) {
      console.error('Error broadcasting transaction:', err);
    }
  }

  /**
   * Broadcast a block to the network
   * @param {Block} block - Block to broadcast
   */
  async broadcastBlock(block) {
    if (!this.libp2p || !this.libp2p.isStarted()) {
      console.log('Not broadcasting block - p2p node not started');
      return;
    }
    
    try {
      const blockData = uint8ArrayFromString(JSON.stringify(block.toJSON()));
      await this.libp2p.pubsub.publish('doucya:blocks', blockData);
      console.log(`Broadcasted block #${block.height} to network`);
    } catch (err) {
      console.error('Error broadcasting block:', err);
    }
  }

  /**
   * Sync blockchain with a specific peer
   * @param {string} peerId - Peer ID to sync with
   */
  async syncWithPeer(peerId) {
    console.log(`Syncing with peer ${peerId}...`);
    
    try {
      // Get latest block height from peer
      const response = await this.protocol.request(peerId, '/doucya/sync/height');
      const peerHeight = parseInt(response.height, 10);
      
      let ourHeight = 0;
      try {
        // Get our latest block
        const latestBlock = await this.blockchain.getLatestBlock();
        ourHeight = latestBlock.height;
      } catch (err) {
        // No blocks yet
        ourHeight = -1;
      }
      
      console.log(`Peer ${peerId} height: ${peerHeight}, our height: ${ourHeight}`);
      
      if (peerHeight > ourHeight) {
        console.log(`Peer ${peerId} has higher block height (${peerHeight} vs ${ourHeight})`);
        
        // Request blocks we don't have
        for (let i = ourHeight + 1; i <= peerHeight; i++) {
          console.log(`Requesting block #${i} from peer ${peerId}`);
          
          const blockResponse = await this.protocol.request(peerId, '/doucya/sync/block', { height: i });
          const block = Block.fromJSON(blockResponse);
          
          // Verify and add the block
          await this.blockchain.saveBlock(block);
          console.log(`Synced block #${i} from peer ${peerId}`);
        }
        
        console.log(`Successfully synced ${peerHeight - ourHeight} blocks from peer ${peerId}`);
      }
      
      // Sync validators
      console.log('Syncing validators...');
      const validatorsResponse = await this.protocol.request(peerId, '/doucya/sync/validators');
      for (const [address, amount] of Object.entries(validatorsResponse.validators)) {
        if (!await this.validatorManager.isValidator(address)) {
          await this.validatorManager.registerValidator(address, amount);
          console.log(`Added validator ${address} with stake ${amount}`);
        }
      }
      
      await this.validatorManager.save();
      console.log('Validator sync complete');
    } catch (err) {
      console.error(`Error syncing with peer ${peerId}:`, err);
      throw err; // Rethrow so caller knows it failed
    }
  }

  /**
   * Sync blockchain with random peer from the network
   */
  async syncBlockchain() {
    // Skip if no peers
    if (this.peers.size === 0) {
      console.log('No peers to sync with');
      return;
    }
    
    // Pick a random peer to sync with
    const peerIds = Array.from(this.peers.keys());
    const randomPeerId = peerIds[Math.floor(Math.random() * peerIds.length)];
    
    console.log(`Syncing blockchain with random peer: ${randomPeerId}`);
    await this.syncWithPeer(randomPeerId);
  }

  /**
   * Check for initial token distribution for this node
   */
  async checkInitialDistribution() {
    try {
      // Check if we already received initial tokens
      const receivedInitial = await this.db.get('RECEIVED_INITIAL_TOKENS');
      if (receivedInitial === 'true') {
        console.log('Already received initial token distribution');
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
      console.log(`Created new address ${address} for initial token distribution`);
    }
    
    // Request initial tokens from a connected peer
    if (this.peers.size > 0) {
      console.log('Requesting initial token distribution...');
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
            console.log(`Failed to get initial tokens from peer ${peerId}, trying next peer...`);
          }
        }
      } catch (err) {
        console.error('Failed to request initial tokens:', err);
      }
    } else {
      console.log('No peers connected to request initial tokens');
    }
  }

  /**
   * Reset message rate limiting counters
   */
  resetMessageCounts() {
    this.messageCounts.hourly.clear();
    console.log('Message rate limiting counters reset');
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
   * Get address balance
   * @param {string} address - Address to check
   * @returns {Promise<number>} - Address balance
   */
  async getAddressBalance(address) {
    return await this.blockchain.getAddressBalance(address);
  }
  
  /**
   * Get transactions for an address
   * @param {string} address - Address
   * @returns {Promise<Array>} - Array of transaction hashes
   */
  async getAddressTransactions(address) {
    return await this.blockchain.getAddressTransactions(address);
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
    
    console.log(`Creating transaction to send ${amount} DOU from ${fromAddress} to ${toAddress} with fee ${fee}`);
    
    // For proper p2p mode, create real transaction
    try {
      // Create transaction
      const tx = Transaction.createTransfer(fromAddress, toAddress, amount, fee);
      
      // Sign transaction
      await tx.sign(async (data) => {
        return Address.sign(data, privateKey);
      });
      
      // Add to blockchain's pending transactions
      await this.blockchain.addTransaction(tx);
      
      // Broadcast to network if we're connected
      if (this.libp2p && this.libp2p.isStarted() && this.peers.size > 0) {
        await this.broadcastTransaction(tx);
      } else {
        console.log('Not broadcasting transaction - no connected peers');
        
        // This is temporary until we have enough validators - directly update balances
        // This simulates what would happen when the transaction is included in a block
        const newSenderBalance = balance - (amount + fee);
        await this.db.put(`BALANCE_${fromAddress}`, newSenderBalance.toString());
        
        // Add to recipient
        const recipientBalance = await this.blockchain.getAddressBalance(toAddress);
        const newRecipientBalance = recipientBalance + amount;
        await this.db.put(`BALANCE_${toAddress}`, newRecipientBalance.toString());
        
        console.log(`Direct balance update (simulating block inclusion):`);
        console.log(`${fromAddress}: ${balance} → ${newSenderBalance} DOU`);
        console.log(`${toAddress}: ${recipientBalance} → ${newRecipientBalance} DOU`);
      }
      
      // Add to transaction histories
      await this.addToAddressTransactions(fromAddress, tx.hash);
      await this.addToAddressTransactions(toAddress, tx.hash);
      
      console.log(`Transaction ${tx.hash} created and processed`);
      return tx.hash;
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
   * Stop the node
   */
  async stop() {
    if (this.libp2p && this.libp2p.isStarted()) {
      console.log('Stopping P2P Node...');
      await this.libp2p.stop();
      console.log('Libp2p node stopped');
    }
    
    await this.blockchain.stop();
    await this.db.close();
    console.log('P2P Node stopped');
  }
}

module.exports = P2PNode;
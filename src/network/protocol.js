/**
 * Protocol handler for DoucyA blockchain
 */

'use strict';

// Without using the it-pipe library
const uint8ArrayFromString = require('uint8arrays/from-string');
const uint8ArrayToString = require('uint8arrays/to-string');
const config = require('../config');
const { randomBytes } = require('crypto');

class Protocol {
  /**
   * Create a new protocol handler
   * @param {Object} node - Node instance
   */
  constructor(node) {
    this.node = node;
    this.pendingRequests = new Map();
    this.requestTimeout = 30000; // 30 seconds
  }

  /**
   * Initialize protocol handlers
   */
  async initialize() {
    // Check if we're in P2P mode or simulation mode
    if (this.node.usingP2P && this.node.libp2p && typeof this.node.libp2p.handle === 'function') {
      // Real P2P mode - set up actual protocol handlers
      this.node.libp2p.handle(`${config.network.protocolPrefix}/sync/height`, this.handleSyncHeight.bind(this));
      this.node.libp2p.handle(`${config.network.protocolPrefix}/sync/block`, this.handleSyncBlock.bind(this));
      this.node.libp2p.handle(`${config.network.protocolPrefix}/sync/validators`, this.handleSyncValidators.bind(this));
      this.node.libp2p.handle(`${config.network.protocolPrefix}/address/pubkey`, this.handleAddressPubkey.bind(this));
      this.node.libp2p.handle(`${config.network.protocolPrefix}/initial-tokens`, this.handleInitialTokens.bind(this));
      this.node.libp2p.handle(`${config.network.protocolPrefix}/request`, this.handleRequest.bind(this));
      this.node.libp2p.handle(`${config.network.protocolPrefix}/response`, this.handleResponse.bind(this));
    } else {
      // Simulation mode - nothing to do here as we're using SimpleNode functionality
      console.log('P2P Protocol in simulation mode - no handlers registered');
    }
  }

  /**
   * Handle sync height request
   * @param {Object} params - Request parameters
   */
  async handleSyncHeight({ connection, stream }) {
    try {
      const latestBlock = await this.node.blockchain.getLatestBlock();
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ height: latestBlock.height }))],
        stream.sink
      );
    } catch (err) {
      console.error('Error handling sync height request:', err);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ error: err.message }))],
        stream.sink
      );
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle sync block request
   * @param {Object} params - Request parameters
   */
  async handleSyncBlock({ connection, stream }) {
    try {
      const data = await this.readStream(stream);
      const request = JSON.parse(uint8ArrayToString(data));
      
      // Get the requested block
      const block = await this.node.blockchain.getBlock(request.height);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify(block.toJSON()))],
        stream.sink
      );
    } catch (err) {
      console.error('Error handling sync block request:', err);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ error: err.message }))],
        stream.sink
      );
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle sync validators request
   * @param {Object} params - Request parameters
   */
  async handleSyncValidators({ connection, stream }) {
    try {
      const validatorsObj = {};
      for (const [address, amount] of this.node.validatorManager.getAllValidators()) {
        validatorsObj[address] = amount;
      }
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ validators: validatorsObj }))],
        stream.sink
      );
    } catch (err) {
      console.error('Error handling sync validators request:', err);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ error: err.message }))],
        stream.sink
      );
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle address public key request
   * @param {Object} params - Request parameters
   */
  async handleAddressPubkey({ connection, stream }) {
    try {
      const data = await this.readStream(stream);
      const request = JSON.parse(uint8ArrayToString(data));
      
      // Try to get public key for address
      let publicKey = null;
      try {
        publicKey = await this.node.db.get(`PUBKEY_${request.address}`);
      } catch (err) {
        // Not found, respond with null
      }
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ publicKey }))],
        stream.sink
      );
    } catch (err) {
      console.error('Error handling address pubkey request:', err);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ error: err.message }))],
        stream.sink
      );
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle initial tokens request
   * @param {Object} params - Request parameters
   */
  async handleInitialTokens({ connection, stream }) {
    try {
      const data = await this.readStream(stream);
      const request = JSON.parse(uint8ArrayToString(data));
      
      // Check if we've given out the maximum initial tokens
      let initialCount = 0;
      try {
        initialCount = parseInt(await this.node.db.get('INITIAL_TOKENS_COUNT'), 10);
      } catch (err) {
        // Not found, start from 0
      }
      
      if (initialCount >= config.blockchain.maxInitialNodes) {
        await pipe(
          [uint8ArrayFromString(JSON.stringify({ 
            success: false, 
            reason: 'Maximum initial tokens already distributed' 
          }))],
          stream.sink
        );
        return;
      }
      
      // Create mint transaction for the requesting address
      const tx = {
        type: 'MINT',
        to: request.address,
        amount: config.blockchain.initialSupply,
        timestamp: Date.now(),
        data: { source: 'initial_distribution' }
      };
      
      // Add to blockchain
      await this.node.blockchain.addTransaction(tx);
      
      // Increment count
      await this.node.db.put('INITIAL_TOKENS_COUNT', (initialCount + 1).toString());
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ 
          success: true,
          amount: config.blockchain.initialSupply 
        }))],
        stream.sink
      );
    } catch (err) {
      console.error('Error handling initial tokens request:', err);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ 
          success: false, 
          reason: err.message 
        }))],
        stream.sink
      );
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle general request
   * @param {Object} params - Request parameters
   */
  async handleRequest({ connection, stream }) {
    try {
      const data = await this.readStream(stream);
      const request = JSON.parse(uint8ArrayToString(data));
      
      // Process request based on type
      let response;
      
      switch (request.type) {
        case 'getBlock':
          const block = await this.node.blockchain.getBlock(request.data.blockId);
          response = { block: block.toJSON() };
          break;
          
        case 'getTransaction':
          const tx = await this.node.blockchain.getTransaction(request.data.txHash);
          response = { transaction: tx.toJSON() };
          break;
          
        case 'getBalance':
          const balance = await this.node.blockchain.getAddressBalance(request.data.address);
          response = { balance };
          break;
          
        default:
          response = { error: 'Unknown request type' };
      }
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({
          id: request.id,
          response
        }))],
        stream.sink
      );
    } catch (err) {
      console.error('Error handling request:', err);
      
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ 
          error: err.message 
        }))],
        stream.sink
      );
    } finally {
      await stream.close();
    }
  }

  /**
   * Handle response
   * @param {Object} params - Request parameters
   */
  async handleResponse({ connection, stream }) {
    try {
      const data = await this.readStream(stream);
      const response = JSON.parse(uint8ArrayToString(data));
      
      // Check if we have a pending request with this ID
      if (this.pendingRequests.has(response.id)) {
        const { resolve, reject, timer } = this.pendingRequests.get(response.id);
        
        // Clear timeout
        clearTimeout(timer);
        
        // Remove from pending requests
        this.pendingRequests.delete(response.id);
        
        // Resolve or reject the promise
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.response);
        }
      }
    } catch (err) {
      console.error('Error handling response:', err);
    } finally {
      await stream.close();
    }
  }

  /**
   * Send a request to a peer
   * @param {string} peerId - Peer ID
   * @param {string} protocol - Protocol path
   * @param {Object} data - Request data
   * @returns {Promise} - Promise that resolves with the response
   */
  async request(peerId, protocol, data = {}) {
    // Create a request ID
    const requestId = randomBytes(16).toString('hex');
    
    // Create a promise that will be resolved when we get a response
    const promise = new Promise((resolve, reject) => {
      // Set a timeout to reject the promise if we don't get a response
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);
      
      // Store the promise callbacks and timer
      this.pendingRequests.set(requestId, { resolve, reject, timer });
    });
    
    try {
      // Open a stream to the peer
      const protocolPath = `/doucya/1.0.0${protocol}`;
      const { stream } = await this.node.libp2p.dialProtocol(peerId, protocolPath);
      
      // Send the request
      await pipe(
        [uint8ArrayFromString(JSON.stringify({ id: requestId, ...data }))],
        stream.sink
      );
      
      // Wait for the response
      const responseData = await this.readStream(stream);
      const response = JSON.parse(uint8ArrayToString(responseData));
      
      // Clear the pending request
      if (this.pendingRequests.has(requestId)) {
        const { timer } = this.pendingRequests.get(requestId);
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
      }
      
      // Check for error
      if (response.error) {
        throw new Error(response.error);
      }
      
      return response;
    } catch (err) {
      // Clear the pending request
      if (this.pendingRequests.has(requestId)) {
        const { timer } = this.pendingRequests.get(requestId);
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
      }
      
      throw err;
    }
  }

  /**
   * Read all data from a stream
   * @param {Object} stream - Libp2p stream
   * @returns {Uint8Array} - Concatenated data
   */
  async readStream(stream) {
    let result;
    for await (const data of stream.source) {
      if (!result) {
        result = data;
      } else {
        // Concatenate the chunks
        const newResult = new Uint8Array(result.length + data.length);
        newResult.set(result);
        newResult.set(data, result.length);
        result = newResult;
      }
    }
    return result;
  }
}

module.exports = Protocol;

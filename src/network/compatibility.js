/**
 * LibP2P Compatibility Layer for DoucyA Blockchain
 * 
 * This module provides compatibility between CommonJS and ESM modules
 * for the LibP2P implementation in DoucyA blockchain.
 */

'use strict';

/**
 * Create a compatible libp2p node with proper error handling
 * @param {Object} options - Configuration options
 * @returns {Object} - A libp2p node or a compatibility layer
 */
async function createCompatibleNode(options = {}) {
  try {
    // Try to initialize a real libp2p node
    const libp2p = require('libp2p');
    const node = await libp2p.create(options);
    return {
      real: true,
      node
    };
  } catch (err) {
    console.log(`Note: Could not initialize real libp2p node: ${err.message}`);
    console.log('Using simulated P2P node instead');
    
    // Return a compatibility layer with the same API but no real P2P functionality
    return {
      real: false,
      node: {
        isStarted: () => false,
        peerId: {
          toString: () => 'p2p-simulation-mode'
        },
        pubsub: {
          publish: async () => {},
          subscribe: async () => {},
          on: () => {},
          unsubscribe: async () => {}
        },
        connectionManager: {
          on: () => {}
        },
        start: async () => {},
        stop: async () => {},
        handle: () => {},
        registrar: {
          handle: () => {}
        }
      }
    };
  }
}

module.exports = {
  createCompatibleNode
};
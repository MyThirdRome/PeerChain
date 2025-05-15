/**
 * Configuration settings for the DoucyA blockchain
 */

'use strict';

module.exports = {
  // Blockchain settings
  blockchain: {
    genesisTimestamp: Date.now(),
    blockTime: 60000, // 60 seconds per block
    initialSupply: 15000, // Initial DOU tokens for first 10 nodes
    maxInitialNodes: 10, // Maximum number of nodes that get initial supply
    validatorMinDeposit: 50, // Minimum deposit to be a validator
    validatorDepositIncreaseRate: 0.1, // 10% yearly increase
    validatorAPY: 0.17, // 17% annually
  },
  
  // Network settings
  network: {
    defaultPort: 8765,
    bootstrapNodes: [],
    protocolPrefix: '/doucya/1.0.0',
    discoveryInterval: 10000, // 10 seconds
    announceInterval: 60000, // 1 minute
  },

  // Messaging settings
  messaging: {
    sendReward: 0.75, // DOU reward for sending a message
    receiveReward: 0.25, // DOU reward for receiving a message
    maxMessagesPerHour: 200, // Maximum messages per hour
    maxMessagesToAddressPerHour: 30, // Maximum messages to a single address per hour
    nonWhitelistedFee: 0.75, // Fee for sending to non-whitelisted address
  },

  // Storage settings
  storage: {
    dbPath: './doucya-data',
    walletPath: './doucya-wallet',
  },

  // Address settings
  address: {
    prefix: 'Dou',
    suffix: 'cyA',
    length: 16, // Total address length (including prefix and suffix)
  },

  // Crypto settings
  crypto: {
    curve: 'secp256k1',
    hashAlgorithm: 'sha256',
    keyEncoding: 'hex',
  }
};

/**
 * DoucyA Blockchain CLI Interface
 */

'use strict';

const { Command } = require('commander');
const SimpleNode = require('./network/simple-node');
const P2PNode = require('./network/p2p-node'); 
const Wallet = require('./storage/wallet');
const BlockchainExplorer = require('./explorer/explorer');
const Address = require('./blockchain/address');
const config = require('./config');

class CLI {
  constructor() {
    this.program = new Command();
    this.node = null;
    this.wallet = null;
    this.explorer = null;
  }

  async initialize() {
    this.wallet = new Wallet(config.storage.walletPath);
    await this.wallet.initialize();
    
    // Use requested node type or SimpleNode by default
    const useP2P = process.env.USE_P2P_NODE === 'true';
    
    if (useP2P) {
      console.log('Using P2PNode with libp2p networking');
      this.node = new P2PNode(this.wallet);
    } else {
      console.log('Using SimpleNode (local mode without libp2p)');
      this.node = new SimpleNode(this.wallet);
    }
    
    this.explorer = new BlockchainExplorer(this.node);
  }

  setupCommands() {
    this.program
      .name('doucya')
      .description('DoucyA blockchain CLI - a libp2p based blockchain for peer-to-peer texting')
      .version('1.0.0');

    // Node commands
    this.program
      .command('start')
      .description('Start a DoucyA blockchain node')
      .option('-p, --port <port>', 'Port to listen on', config.network.defaultPort)
      .option('-b, --bootstrap <addresses>', 'Comma-separated list of bootstrap node addresses')
      .option('-n, --network', 'Use libp2p networking', false)
      .action(async (options) => {
        // Set environment variable to indicate we want P2PNode if --network was specified
        if (options.network) {
          process.env.USE_P2P_NODE = 'true';
          console.log('Starting in network mode with libp2p');
        } else {
          console.log('Starting in local mode (no networking)');
        }
        
        await this.initialize();
        
        let bootstrapNodes = [];
        if (options.bootstrap) {
          bootstrapNodes = options.bootstrap.split(',').map(addr => addr.trim());
        }
        
        if (options.network) {
          // Use the P2P node with networking
          const peerId = await this.node.start(options.port, bootstrapNodes);
          console.log(`\nNode started on port ${options.port} with libp2p networking`);
          console.log(`Peer ID: ${peerId}`);
          console.log(`\nOther nodes can connect using bootstrap address:`);
          console.log(`/ip4/<YOUR_IP>/tcp/${options.port}/p2p/${peerId}`);
        } else {
          // Use simple node without networking
          await this.node.start();
          console.log('Node started (simple mode without networking)');
        }
        
        console.log('\nPress Ctrl+C to stop the node');
      });

    // Address commands
    this.program
      .command('create-address')
      .description('Create a new DoucyA address')
      .action(async () => {
        await this.initialize();
        const { address, privateKey } = await this.wallet.createAddress();
        console.log('New address created:');
        console.log(`Address: ${address}`);
        console.log(`Private key: ${privateKey}`);
        console.log('IMPORTANT: Save your private key in a secure location!');
      });

    this.program
      .command('import-address')
      .description('Import an address using private key')
      .argument('<privateKey>', 'Private key of the address')
      .action(async (privateKey) => {
        await this.initialize();
        const address = await this.wallet.importAddress(privateKey);
        console.log(`Address ${address} imported successfully`);
      });

    this.program
      .command('list-addresses')
      .description('List all addresses in the wallet')
      .action(async () => {
        await this.initialize();
        const addresses = await this.wallet.listAddresses();
        console.log('Your addresses:');
        addresses.forEach(addr => {
          console.log(`- ${addr}`);
        });
      });

    this.program
      .command('show-private-key')
      .description('Show the private key for an address')
      .argument('<address>', 'DoucyA address')
      .action(async (address) => {
        await this.initialize();
        try {
          const privateKey = await this.wallet.getPrivateKey(address);
          console.log(`Private key for address ${address}:`);
          console.log(privateKey);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    // Balance and transaction commands
    this.program
      .command('balance')
      .description('Check balance of an address')
      .argument('[address]', 'DoucyA address (defaults to all wallet addresses)')
      .action(async (address) => {
        await this.initialize();
        
        if (address) {
          const balance = await this.node.getAddressBalance(address);
          console.log(`Balance for ${address}: ${balance} DOU`);
        } else {
          const addresses = await this.wallet.listAddresses();
          for (const addr of addresses) {
            const balance = await this.node.getAddressBalance(addr);
            console.log(`${addr}: ${balance} DOU`);
          }
        }
      });

    this.program
      .command('send')
      .description('Send DOU tokens to another address')
      .argument('<fromAddress>', 'Sender address')
      .argument('<toAddress>', 'Recipient address')
      .argument('<amount>', 'Amount of DOU to send')
      .option('-f, --fee <fee>', 'Transaction fee (higher fee = higher priority)', '0.1')
      .option('-n, --network', 'Use libp2p networking', false)
      .action(async (fromAddress, toAddress, amount, options) => {
        // Set environment variable to indicate we want P2PNode if --network was specified
        if (options.network) {
          process.env.USE_P2P_NODE = 'true';
          console.log('Using network mode with libp2p for transaction');
        }
        
        await this.initialize();
        try {
          const txHash = await this.node.sendTokens(fromAddress, toAddress, amount, options.fee);
          console.log(`Transaction sent: ${txHash}`);
          
          // Display the new balances
          const senderBalance = await this.node.getAddressBalance(fromAddress);
          const recipientBalance = await this.node.getAddressBalance(toAddress);
          console.log(`New sender balance (${fromAddress}): ${senderBalance} DOU`);
          console.log(`New recipient balance (${toAddress}): ${recipientBalance} DOU`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });
    
    this.program
      .command('send-detailed')
      .description('Send DOU tokens with detailed transaction info')
      .argument('<fromAddress>', 'Sender address')
      .argument('<toAddress>', 'Recipient address')
      .argument('<amount>', 'Amount of DOU to send')
      .option('-f, --fee <fee>', 'Transaction fee (higher fee = higher priority)', '0.1')
      .action(async (fromAddress, toAddress, amount, options) => {
        await this.initialize();
        try {
          console.log(`Preparing to send ${amount} DOU from ${fromAddress} to ${toAddress}...`);
          
          // Check initial balances
          const initialSenderBalance = await this.node.getAddressBalance(fromAddress);
          const initialRecipientBalance = await this.node.getAddressBalance(toAddress);
          console.log(`Initial sender balance: ${initialSenderBalance} DOU`);
          console.log(`Initial recipient balance: ${initialRecipientBalance} DOU`);
          
          // Send the transaction
          console.log(`Sending transaction with fee: ${options.fee} DOU...`);
          const startTime = Date.now();
          const txHash = await this.node.sendTokens(fromAddress, toAddress, amount, options.fee);
          const endTime = Date.now();
          
          console.log(`\nTransaction completed in ${endTime - startTime}ms`);
          console.log(`Transaction hash: ${txHash}`);
          console.log(`Transaction type: TRANSFER`);
          console.log(`Amount: ${amount} DOU`);
          console.log(`Fee: ${options.fee} DOU`);
          console.log(`Total cost: ${parseFloat(amount) + parseFloat(options.fee)} DOU`);
          console.log(`Timestamp: ${new Date().toLocaleString()}`);
          
          // Display the new balances
          const senderBalance = await this.node.getAddressBalance(fromAddress);
          const recipientBalance = await this.node.getAddressBalance(toAddress);
          console.log(`\nNew sender balance (${fromAddress}): ${senderBalance} DOU`);
          console.log(`New recipient balance (${toAddress}): ${recipientBalance} DOU`);
          
          // Confirmation
          console.log(`\nTransaction successfully recorded on the blockchain!`);
          console.log(`You can view details anytime with: tx ${txHash}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    // Explorer commands
    this.program
      .command('explore')
      .description('Get blockchain information')
      .action(async () => {
        await this.initialize();
        try {
          const info = await this.explorer.getBlockchainInfo();
          console.log('Blockchain Information:');
          console.log(`Height: ${info.height}`);
          console.log(`Latest Block Hash: ${info.latestBlockHash}`);
          console.log(`Timestamp: ${new Date(info.timestamp).toLocaleString()}`);
          console.log(`Transactions: ${info.transactions}`);
          console.log(`Validator: ${info.validator}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });
      
    this.program
      .command('tx')
      .description('View transaction details')
      .argument('<hash>', 'Transaction hash')
      .action(async (hash) => {
        await this.initialize();
        try {
          const tx = await this.explorer.getTransaction(hash);
          console.log(`Transaction: ${tx.hash}`);
          console.log(`Type: ${tx.type}`);
          if (tx.from) console.log(`From: ${tx.from}`);
          if (tx.to) console.log(`To: ${tx.to}`);
          if (tx.amount) console.log(`Amount: ${tx.amount} DOU`);
          if (tx.fee) console.log(`Fee: ${tx.fee} DOU`);
          console.log(`Timestamp: ${new Date(tx.timestamp).toLocaleString()}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });
    
    this.program
      .command('address-info')
      .description('Get detailed address information')
      .argument('<address>', 'DoucyA address')
      .action(async (address) => {
        await this.initialize();
        try {
          const info = await this.explorer.getAddressInfo(address);
          console.log(`Address: ${info.address}`);
          console.log(`Balance: ${info.balance} DOU`);
          console.log(`Transaction Count: ${info.transactionCount}`);
          
          if (info.transactions.length > 0) {
            console.log('\nRecent Transactions:');
            for (const tx of info.transactions.slice(0, 5)) { // Show only last 5
              console.log(`- Hash: ${tx.hash}`);
              console.log(`  Type: ${tx.type}`);
              if (tx.from && tx.from !== address) console.log(`  From: ${tx.from}`);
              if (tx.to && tx.to !== address) console.log(`  To: ${tx.to}`);
              if (tx.amount) console.log(`  Amount: ${tx.amount} DOU`);
              console.log(`  Time: ${new Date(tx.timestamp).toLocaleString()}`);
              console.log();
            }
            
            if (info.transactions.length > 5) {
              console.log(`... and ${info.transactions.length - 5} more transactions`);
            }
          }
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });
    
    // Admin commands
    this.program
      .command('mint')
      .description('Mint tokens to an address (admin only)')
      .argument('<address>', 'Address to mint tokens to')
      .argument('<amount>', 'Amount of DOU to mint')
      .action(async (address, amount) => {
        await this.initialize();
        try {
          // For test purposes, we'll directly modify the balance in the DB
          const db = this.node.db;
          const currentBalanceStr = await db.get(`BALANCE_${address}`).catch(() => '0');
          const currentBalance = parseInt(currentBalanceStr) || 0;
          const newBalance = currentBalance + parseInt(amount);
          
          await db.put(`BALANCE_${address}`, newBalance.toString());
          console.log(`Minted ${amount} DOU to ${address}`);
          console.log(`New balance: ${newBalance} DOU`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });
    
    // Messaging commands
    this.program
      .command('whitelist')
      .description('Add an address to your whitelist')
      .argument('<fromAddress>', 'Your address')
      .argument('<toAddress>', 'Address to whitelist')
      .action(async (fromAddress, toAddress) => {
        await this.initialize();
        try {
          await this.node.addToWhitelist(fromAddress, toAddress);
          console.log(`Address ${toAddress} added to whitelist for ${fromAddress}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('unwhitelist')
      .description('Remove an address from your whitelist')
      .argument('<fromAddress>', 'Your address')
      .argument('<toAddress>', 'Address to remove from whitelist')
      .action(async (fromAddress, toAddress) => {
        await this.initialize();
        try {
          await this.node.removeFromWhitelist(fromAddress, toAddress);
          console.log(`Address ${toAddress} removed from whitelist for ${fromAddress}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('list-whitelist')
      .description('List all whitelisted addresses')
      .argument('<address>', 'Your address')
      .action(async (address) => {
        await this.initialize();
        try {
          const whitelist = await this.node.getWhitelist(address);
          console.log(`Whitelisted addresses for ${address}:`);
          whitelist.forEach(addr => {
            console.log(`- ${addr}`);
          });
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('send-message')
      .description('Send a message to another address')
      .argument('<fromAddress>', 'Sender address')
      .argument('<toAddress>', 'Recipient address')
      .argument('<message>', 'Message content')
      .action(async (fromAddress, toAddress, message) => {
        await this.initialize();
        try {
          const result = await this.node.sendMessage(fromAddress, toAddress, message);
          if (result.status === 'success') {
            console.log(`Message sent successfully. Message ID: ${result.messageId}`);
            if (result.reward) {
              console.log(`You earned ${result.reward} DOU for sending this message`);
            } else if (result.fee) {
              console.log(`You paid ${result.fee} DOU fee (recipient not whitelisted)`);
            }
          }
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('read-messages')
      .description('Read messages for an address')
      .argument('<address>', 'Your address')
      .option('-n, --new', 'Show only new messages')
      .option('-f, --from <fromAddress>', 'Filter messages from a specific address')
      .action(async (address, options) => {
        await this.initialize();
        try {
          const messages = await this.node.getMessages(address, options.new, options.from);
          if (messages.length === 0) {
            console.log('No messages found');
            return;
          }
          
          console.log(`Messages for ${address}:`);
          messages.forEach(msg => {
            console.log('-----------------------------------');
            console.log(`From: ${msg.from}`);
            console.log(`Date: ${new Date(msg.timestamp).toLocaleString()}`);
            console.log(`Message: ${msg.content}`);
            if (msg.reward) {
              console.log(`Reward: ${msg.reward} DOU`);
            }
          });
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    // Group and channel commands
    this.program
      .command('create-group')
      .description('Create a new messaging group')
      .argument('<ownerAddress>', 'Group owner address')
      .argument('<groupName>', 'Name of the group')
      .option('-p, --private', 'Make the group private (invite-only)')
      .action(async (ownerAddress, groupName, options) => {
        await this.initialize();
        try {
          const groupId = await this.node.createGroup(ownerAddress, groupName, options.private);
          console.log(`Group "${groupName}" created with ID: ${groupId}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('create-channel')
      .description('Create a new broadcast channel')
      .argument('<ownerAddress>', 'Channel owner address')
      .argument('<channelName>', 'Name of the channel')
      .option('-p, --private', 'Make the channel private (invite-only)')
      .action(async (ownerAddress, channelName, options) => {
        await this.initialize();
        try {
          const channelId = await this.node.createChannel(ownerAddress, channelName, options.private);
          console.log(`Channel "${channelName}" created with ID: ${channelId}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    // Validator commands
    this.program
      .command('become-validator')
      .description('Register as a validator')
      .argument('<address>', 'Validator address')
      .argument('<amount>', 'Amount to stake (minimum 50 DOU)')
      .action(async (address, amount) => {
        await this.initialize();
        try {
          const txHash = await this.node.becomeValidator(address, parseFloat(amount));
          console.log(`Validator registration successful. Transaction: ${txHash}`);
          console.log(`Staked amount: ${amount} DOU`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('stop-validating')
      .description('Stop being a validator')
      .argument('<address>', 'Validator address')
      .action(async (address) => {
        await this.initialize();
        try {
          const txHash = await this.node.stopValidating(address);
          console.log(`Successfully stopped validating. Transaction: ${txHash}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    // Blockchain explorer commands
    this.program
      .command('network-info')
      .description('Display network information')
      .action(async () => {
        await this.initialize();
        const networkInfo = await this.explorer.getNetworkInfo();
        console.log('DoucyA Blockchain Network Information:');
        console.log(`Block height: ${networkInfo.blockHeight}`);
        console.log(`Peer count: ${networkInfo.peerCount}`);
        console.log(`Validator count: ${networkInfo.validatorCount}`);
        console.log(`Total supply: ${networkInfo.totalSupply} DOU`);
        console.log(`Network hash rate: ${networkInfo.hashRate}`);
      });

    this.program
      .command('block')
      .description('Display block information')
      .argument('<blockId>', 'Block number or hash')
      .action(async (blockId) => {
        await this.initialize();
        try {
          const block = await this.explorer.getBlock(blockId);
          console.log(`Block #${block.height} (${block.hash}):`);
          console.log(`Timestamp: ${new Date(block.timestamp).toLocaleString()}`);
          console.log(`Previous hash: ${block.previousHash}`);
          console.log(`Validator: ${block.validator}`);
          console.log(`Transactions: ${block.transactions.length}`);
          console.log(`Size: ${block.size} bytes`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });

    this.program
      .command('transaction')
      .description('Display transaction information')
      .argument('<txHash>', 'Transaction hash')
      .action(async (txHash) => {
        await this.initialize();
        try {
          const tx = await this.explorer.getTransaction(txHash);
          console.log(`Transaction ${tx.hash}:`);
          console.log(`Type: ${tx.type}`);
          console.log(`Block: ${tx.blockHeight}`);
          console.log(`Timestamp: ${new Date(tx.timestamp).toLocaleString()}`);
          console.log(`From: ${tx.from}`);
          if (tx.to) console.log(`To: ${tx.to}`);
          if (tx.amount) console.log(`Amount: ${tx.amount} DOU`);
          console.log(`Fee: ${tx.fee} DOU`);
          console.log(`Status: ${tx.status}`);
        } catch (err) {
          console.error(`Error: ${err.message}`);
        }
      });
  }

  async run() {
    this.setupCommands();
    await this.program.parseAsync(process.argv);
  }
}

module.exports = new CLI();

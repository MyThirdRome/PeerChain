# DoucyA Blockchain

A libp2p-based blockchain platform designed for secure peer-to-peer messaging and decentralized token transactions with a Proof-of-Stake (PoS) validation mechanism.

## Features

- Secure cryptocurrency (DOU) for transactions
- Peer-to-peer messaging with blockchain validation
- Decentralized network using libp2p
- Proof-of-Stake consensus mechanism
- CLI-based wallet and blockchain explorer
- Simple address management

## Complete Installation Guide

### For Ubuntu/Debian Systems

```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Install dependencies
sudo apt install -y curl git build-essential

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version

# Clone the repository
git clone https://github.com/yourusername/doucya-blockchain.git
cd doucya-blockchain

# Install project dependencies
npm install
```

### For RHEL/CentOS Systems

```bash
# Update system packages
sudo yum update -y

# Install dependencies
sudo yum install -y curl git gcc-c++ make

# Install Node.js and npm
curl -fsSL https://rpm.nodesource.com/setup_16.x | sudo bash -
sudo yum install -y nodejs

# Verify installation
node --version
npm --version

# Clone the repository
git clone https://github.com/yourusername/doucya-blockchain.git
cd doucya-blockchain

# Install project dependencies
npm install
```

### For macOS

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js and npm
brew install node@16

# Verify installation
node --version
npm --version

# Clone the repository
git clone https://github.com/yourusername/doucya-blockchain.git
cd doucya-blockchain

# Install project dependencies
npm install
```

## Complete Command Reference

### Node Management

```bash
# Start a node in local mode (no networking)
node src/index.js start

# Start a node in P2P network mode
node src/index.js start --network

# Start a node with a specific port
node src/index.js start --port 9000

# Connect to a specific bootstrap node
node src/index.js start --network --bootstrap /ip4/192.168.1.100/tcp/8765/p2p/PEER_ID_VALUE

# Connect to multiple bootstrap nodes (comma-separated)
node src/index.js start --network --bootstrap "/ip4/192.168.1.100/tcp/8765/p2p/PEER_ID_1,/ip4/192.168.1.101/tcp/8765/p2p/PEER_ID_2"
```

### Wallet Management

```bash
# Create a new address
node src/index.js create-address

# Import an existing private key
node src/index.js import-key YOUR_PRIVATE_KEY

# List all addresses in your wallet
node src/index.js list-addresses

# Get detailed information about a specific address
node src/index.js address-info DOU_ADDRESS
```

### Transaction Operations

```bash
# Check balance of a specific address
node src/index.js balance DOU_ADDRESS

# Check balances of all addresses in your wallet
node src/index.js balance

# Send tokens (local mode)
node src/index.js send FROM_ADDRESS TO_ADDRESS AMOUNT

# Send tokens with custom fee
node src/index.js send FROM_ADDRESS TO_ADDRESS AMOUNT --fee 0.2

# Send tokens in network mode
node src/index.js send FROM_ADDRESS TO_ADDRESS AMOUNT --network

# Check transaction details
node src/index.js tx TRANSACTION_HASH

# Send a secure message to another address
node src/index.js message FROM_ADDRESS TO_ADDRESS "Your message here"
```

### Blockchain Explorer

```bash
# View blockchain information
node src/index.js explore

# View blockchain with detailed transaction information
node src/index.js explore --details
```

### Validation & Mining

```bash
# Register as a validator (stake DOU tokens)
node src/index.js register-validator ADDRESS AMOUNT

# Withdraw from being a validator
node src/index.js withdraw-validator ADDRESS

# List all active validators
node src/index.js list-validators

# Mint tokens (for testing)
node src/index.js mint ADDRESS AMOUNT
```

### Network Operations

```bash
# Send tokens over the network
node src/index.js send FROM_ADDRESS TO_ADDRESS AMOUNT --network

# View network statistics
node src/index.js network-stats

# Manually sync with the network
node src/index.js sync
```

## Setting Up a Multi-Node Network

To create a peer-to-peer network with multiple nodes:

1. **First Node Setup:**

```bash
# Server 1: Start the first node
node src/index.js start --network
```

2. **Get the Peer ID:**
   Note the Peer ID from the console output, which will look similar to:
   ```
   Node started on port 8765 with libp2p networking
   Peer ID: p2p-simulation-mode
   Other nodes can connect using bootstrap address:
   /ip4/<YOUR_IP>/tcp/8765/p2p/p2p-simulation-mode
   ```

3. **Second Node Setup:**
   On a different server, start a node that connects to the first:

```bash
# Server 2: Start a node connecting to Server 1
node src/index.js start --network --bootstrap /ip4/<SERVER1_IP>/tcp/8765/p2p/<SERVER1_PEER_ID>
```

4. **Additional Nodes:**
   Add more nodes to the network by connecting to any existing node:

```bash
# Server 3: Connect to either Server 1 or Server 2
node src/index.js start --network --bootstrap /ip4/<ANY_EXISTING_NODE_IP>/tcp/8765/p2p/<ANY_EXISTING_NODE_PEER_ID>
```

## Network Configuration

The network configuration is located in `src/config.js`. You can modify parameters such as:

- Default port
- Bootstrap nodes
- Protocol prefixes
- Network discovery intervals

## Data Storage

Blockchain data is stored in the `./doucya-data` directory:
- Wallet information
- Blockchain state
- Transaction history

## License

MIT
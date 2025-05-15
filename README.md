# DoucyA Blockchain

A libp2p-based blockchain platform designed for secure peer-to-peer messaging and decentralized token transactions with a Proof-of-Stake (PoS) validation mechanism.

## Features

- Secure cryptocurrency (DOU) for transactions
- Peer-to-peer messaging with blockchain validation
- Decentralized network using libp2p
- Proof-of-Stake consensus mechanism
- CLI-based wallet and blockchain explorer
- Simple address management

## Installation

### Prerequisites

- Node.js (v14+)
- npm

### Setup

1. Clone the repository:

```bash
git clone https://github.com/yourusername/doucya-blockchain.git
cd doucya-blockchain
```

2. Install dependencies:

```bash
npm install
```

## Usage

### Creating a Wallet Address

Create a new DOU wallet address:

```bash
node src/index.js create-address
```

This will generate a new address and add it to your wallet.

### Check Balance

Check the balance of an address:

```bash
node src/index.js balance <address>
```

If no address is provided, it will show balances for all addresses in your wallet.

### Send Tokens

Send DOU tokens from one address to another:

```bash
node src/index.js send <fromAddress> <toAddress> <amount>
```

Example:
```bash
node src/index.js send Doue8eylmv193cyA Dout5i4l7qiqwcyA 50
```

### View Transaction Details

View details about a specific transaction:

```bash
node src/index.js tx <transactionHash>
```

### Explore the Blockchain

Use the blockchain explorer to view the current state:

```bash
node src/index.js explore
```

### P2P Network Mode

#### Starting a Node

Start a node in P2P network mode:

```bash
node src/index.js start --network
```

This will start a node with libp2p networking enabled. The output will display your Peer ID and instructions for connecting other nodes.

#### Connecting to an Existing Node

To connect to an existing node:

```bash
node src/index.js start --network --bootstrap /ip4/<IP_ADDRESS>/tcp/<PORT>/p2p/<PEER_ID>
```

Replace `<IP_ADDRESS>`, `<PORT>`, and `<PEER_ID>` with the appropriate values from the node you want to connect to.

#### Network Transactions

Send tokens over the network:

```bash
node src/index.js send <fromAddress> <toAddress> <amount> --network
```

## Development Setup (For Fresh Servers)

For a fresh installation on a new server:

1. Install Node.js and npm
   
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # OR for RHEL/CentOS
   curl -fsSL https://rpm.nodesource.com/setup_16.x | sudo bash -
   sudo yum install -y nodejs
   ```

2. Clone the repository

   ```bash
   git clone https://github.com/yourusername/doucya-blockchain.git
   cd doucya-blockchain
   ```

3. Install dependencies

   ```bash
   npm install
   ```

4. Start a node in network mode

   ```bash
   node src/index.js start --network
   ```

5. Note your Peer ID and network address that is shown in the console output

6. On other servers, start nodes that connect to your first node:

   ```bash
   node src/index.js start --network --bootstrap /ip4/<FIRST_NODE_IP>/tcp/8765/p2p/<FIRST_NODE_PEER_ID>
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
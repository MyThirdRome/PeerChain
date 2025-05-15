#!/usr/bin/env node

/**
 * DoucyA Blockchain - Main Entry Point
 * A libp2p based blockchain for peer-to-peer texting with DOU cryptocurrency
 */

'use strict';

const cli = require('./cli');

// Start the CLI application
cli.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

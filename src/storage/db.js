/**
 * LevelDB database wrapper for DoucyA blockchain
 */

'use strict';

const level = require('level');
const fs = require('fs');
const path = require('path');

class LevelDB {
  /**
   * Create a new LevelDB instance
   * @param {string} dbPath - Path to the database
   */
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.isOpen = false;
  }

  /**
   * Open the database
   * @returns {Promise} Promise that resolves when database is open
   */
  async open() {
    if (this.isOpen) {
      return;
    }
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }
    
    // Open the database
    this.db = level(this.dbPath, {
      valueEncoding: 'json'
    });
    
    this.isOpen = true;
    console.log(`Database opened at ${this.dbPath}`);
  }

  /**
   * Close the database
   * @returns {Promise} Promise that resolves when database is closed
   */
  async close() {
    if (!this.isOpen) {
      return;
    }
    
    await this.db.close();
    this.isOpen = false;
    console.log('Database closed');
  }

  /**
   * Put a key-value pair in the database
   * @param {string} key - Key
   * @param {any} value - Value
   * @returns {Promise} Promise that resolves when value is stored
   */
  async put(key, value) {
    if (!this.isOpen) {
      await this.open();
    }
    
    try {
      await this.db.put(key, value);
      return true;
    } catch (err) {
      console.error(`Error storing ${key}:`, err);
      throw err;
    }
  }

  /**
   * Get a value from the database
   * @param {string} key - Key
   * @returns {Promise<any>} Promise that resolves with the value
   */
  async get(key) {
    if (!this.isOpen) {
      await this.open();
    }
    
    try {
      return await this.db.get(key);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete a key-value pair from the database
   * @param {string} key - Key
   * @returns {Promise} Promise that resolves when value is deleted
   */
  async del(key) {
    if (!this.isOpen) {
      await this.open();
    }
    
    try {
      await this.db.del(key);
      return true;
    } catch (err) {
      console.error(`Error deleting ${key}:`, err);
      throw err;
    }
  }

  /**
   * Check if a key exists in the database
   * @param {string} key - Key
   * @returns {Promise<boolean>} Promise that resolves with whether the key exists
   */
  async exists(key) {
    if (!this.isOpen) {
      await this.open();
    }
    
    try {
      await this.db.get(key);
      return true;
    } catch (err) {
      if (err.type === 'NotFoundError') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Get all keys in the database with a prefix
   * @param {string} prefix - Key prefix
   * @returns {Promise<Array>} Promise that resolves with array of keys
   */
  async getKeys(prefix) {
    if (!this.isOpen) {
      await this.open();
    }
    
    const keys = [];
    
    return new Promise((resolve, reject) => {
      this.db.createKeyStream({
        gte: prefix,
        lte: prefix + '\uffff'
      })
      .on('data', (key) => {
        keys.push(key);
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('end', () => {
        resolve(keys);
      });
    });
  }

  /**
   * Get all key-value pairs in the database with a prefix
   * @param {string} prefix - Key prefix
   * @returns {Promise<Object>} Promise that resolves with key-value pairs
   */
  async getAll(prefix) {
    if (!this.isOpen) {
      await this.open();
    }
    
    const result = {};
    
    return new Promise((resolve, reject) => {
      this.db.createReadStream({
        gte: prefix,
        lte: prefix + '\uffff'
      })
      .on('data', (data) => {
        result[data.key] = data.value;
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('end', () => {
        resolve(result);
      });
    });
  }

  /**
   * Update a value in the database using a function
   * @param {string} key - Key
   * @param {Function} updateFn - Function that takes the current value and returns the new value
   * @returns {Promise<any>} Promise that resolves with the new value
   */
  async update(key, updateFn) {
    if (!this.isOpen) {
      await this.open();
    }
    
    try {
      let value;
      try {
        value = await this.get(key);
      } catch (err) {
        if (err.type === 'NotFoundError') {
          value = undefined;
        } else {
          throw err;
        }
      }
      
      const newValue = updateFn(value);
      await this.put(key, newValue);
      return newValue;
    } catch (err) {
      console.error(`Error updating ${key}:`, err);
      throw err;
    }
  }

  /**
   * Perform a batch operation
   * @param {Array} operations - Array of operations
   * @returns {Promise} Promise that resolves when batch is complete
   */
  async batch(operations) {
    if (!this.isOpen) {
      await this.open();
    }
    
    try {
      await this.db.batch(operations);
      return true;
    } catch (err) {
      console.error('Error performing batch operation:', err);
      throw err;
    }
  }
}

module.exports = LevelDB;

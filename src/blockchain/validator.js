/**
 * Validator management for DoucyA blockchain
 */

'use strict';

const config = require('../config');

class ValidatorManager {
  /**
   * Create a new validator manager
   * @param {Object} blockchain - Blockchain instance
   * @param {Object} db - LevelDB database instance
   */
  constructor(blockchain, db) {
    this.blockchain = blockchain;
    this.db = db;
    this.validators = new Map();
    this.minimumDeposit = config.blockchain.validatorMinDeposit;
    this.lastYearlyUpdate = Date.now();
  }

  /**
   * Initialize the validator manager
   */
  async initialize() {
    try {
      // Load validators from the database
      const validatorsData = await this.db.get('VALIDATORS');
      if (validatorsData) {
        const validatorsObj = JSON.parse(validatorsData);
        for (const [address, amount] of Object.entries(validatorsObj)) {
          this.validators.set(address, amount);
        }
        console.log(`Loaded ${this.validators.size} validators`);
      }
      
      // Load last yearly update timestamp
      const lastUpdateData = await this.db.get('VALIDATOR_LAST_UPDATE');
      if (lastUpdateData) {
        this.lastYearlyUpdate = parseInt(lastUpdateData, 10);
      }
      
      // Load minimum deposit
      const minDepositData = await this.db.get('VALIDATOR_MIN_DEPOSIT');
      if (minDepositData) {
        this.minimumDeposit = parseFloat(minDepositData);
      }
    } catch (err) {
      if (err.type !== 'NotFoundError') {
        throw err;
      }
    }
  }

  /**
   * Save validators state
   */
  async save() {
    const validatorsObj = {};
    for (const [address, amount] of this.validators.entries()) {
      validatorsObj[address] = amount;
    }
    
    await this.db.put('VALIDATORS', JSON.stringify(validatorsObj));
    await this.db.put('VALIDATOR_LAST_UPDATE', this.lastYearlyUpdate.toString());
    await this.db.put('VALIDATOR_MIN_DEPOSIT', this.minimumDeposit.toString());
  }

  /**
   * Register a new validator
   * @param {string} address - Validator address
   * @param {number} amount - Staked amount
   * @throws {Error} - If amount is below minimum deposit
   */
  registerValidator(address, amount) {
    if (amount < this.minimumDeposit) {
      throw new Error(`Staked amount ${amount} is below minimum deposit ${this.minimumDeposit}`);
    }
    
    const currentStake = this.validators.get(address) || 0;
    this.validators.set(address, currentStake + amount);
  }

  /**
   * Remove a validator
   * @param {string} address - Validator address
   * @returns {number} - The staked amount
   * @throws {Error} - If address is not a validator
   */
  removeValidator(address) {
    if (!this.validators.has(address)) {
      throw new Error(`Address ${address} is not a validator`);
    }
    
    const amount = this.validators.get(address);
    this.validators.delete(address);
    return amount;
  }

  /**
   * Check if an address is a validator
   * @param {string} address - Address to check
   * @returns {boolean} - Whether address is a validator
   */
  isValidator(address) {
    return this.validators.has(address);
  }

  /**
   * Get validator's staked amount
   * @param {string} address - Validator address
   * @returns {number} - Staked amount
   */
  getValidatorStake(address) {
    return this.validators.get(address) || 0;
  }

  /**
   * Get all validators
   * @returns {Map} - Map of validator addresses to staked amounts
   */
  getAllValidators() {
    return this.validators;
  }

  /**
   * Process monthly rewards for all validators
   * @returns {Array} - Array of reward transactions
   */
  processMonthlyRewards() {
    const rewards = [];
    const monthlyRate = config.blockchain.validatorAPY / 12;
    
    for (const [address, stake] of this.validators.entries()) {
      const reward = stake * monthlyRate;
      
      const rewardTx = {
        type: 'REWARD',
        to: address,
        amount: reward,
        data: { type: 'VALIDATOR_MONTHLY_REWARD' }
      };
      
      rewards.push(rewardTx);
    }
    
    return rewards;
  }

  /**
   * Update minimum deposit (yearly 10% increase)
   * @returns {boolean} - Whether an update occurred
   */
  updateMinimumDeposit() {
    const now = Date.now();
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    
    if (now - this.lastYearlyUpdate >= oneYear) {
      // Increase by 10%
      this.minimumDeposit *= (1 + config.blockchain.validatorDepositIncreaseRate);
      this.lastYearlyUpdate = now;
      
      console.log(`Validator minimum deposit increased to ${this.minimumDeposit} DOU`);
      return true;
    }
    
    return false;
  }

  /**
   * Check and remove validators that don't meet the minimum deposit
   * @returns {Array} - Array of removed validators
   */
  checkMinimumDeposit() {
    const removedValidators = [];
    
    for (const [address, stake] of this.validators.entries()) {
      if (stake < this.minimumDeposit) {
        removedValidators.push({
          address,
          stake
        });
        
        this.validators.delete(address);
      }
    }
    
    return removedValidators;
  }

  /**
   * Select a validator for the next block
   * @returns {string} - Validator address
   */
  selectNextValidator() {
    if (this.validators.size === 0) {
      return null;
    }
    
    // Convert validators map to array
    const validatorEntries = Array.from(this.validators.entries());
    
    // Calculate total stake
    const totalStake = validatorEntries.reduce(
      (total, [_, stake]) => total + stake, 
      0
    );
    
    // Generate a random number between 0 and total stake
    const random = Math.random() * totalStake;
    
    // Select validator based on stake weight
    let cumulativeStake = 0;
    for (const [address, stake] of validatorEntries) {
      cumulativeStake += stake;
      if (random <= cumulativeStake) {
        return address;
      }
    }
    
    // Fallback to first validator
    return validatorEntries[0][0];
  }
}

module.exports = ValidatorManager;

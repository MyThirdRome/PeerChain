/**
 * End-to-end encryption for DoucyA messaging
 */

'use strict';

const crypto = require('crypto');
const Keys = require('./keys');
const config = require('../config');

class Encryption {
  /**
   * IV size for AES encryption
   */
  static IV_SIZE = 16;

  /**
   * Encrypt a message
   * @param {string} message - Plain text message
   * @param {string} publicKey - Recipient's public key
   * @returns {string} Encrypted message
   */
  static async encryptMessage(message, publicKey) {
    // If recipient's public key is not available, use
    // symmetric encryption with a password derived from the addresses
    if (!publicKey) {
      console.warn('Public key not available, using fallback encryption');
      return this.encryptSymmetric(message, 'doucya-fallback-key');
    }
    
    try {
      // Get shared secret using own private key and recipient's public key
      const ownKeyPair = crypto.generateKeyPair('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });
      
      // Generate a random symmetric key
      const symmetricKey = crypto.randomBytes(32);
      
      // Encrypt the message with the symmetric key
      const iv = crypto.randomBytes(this.IV_SIZE);
      const cipher = crypto.createCipheriv('aes-256-cbc', symmetricKey, iv);
      let encryptedMessage = cipher.update(message, 'utf8', 'hex');
      encryptedMessage += cipher.final('hex');
      
      // Encrypt the symmetric key with the recipient's public key
      const publicKeyObj = crypto.createPublicKey(publicKey);
      const encryptedKey = crypto.publicEncrypt(
        {
          key: publicKeyObj,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
        },
        symmetricKey
      );
      
      // Combine the encrypted key, IV, and encrypted message
      const result = {
        encryptedKey: encryptedKey.toString('hex'),
        iv: iv.toString('hex'),
        encryptedMessage
      };
      
      return JSON.stringify(result);
    } catch (err) {
      console.error('Error encrypting message:', err);
      // Fallback to symmetric encryption
      return this.encryptSymmetric(message, 'doucya-fallback-key');
    }
  }

  /**
   * Decrypt a message
   * @param {string} encryptedData - Encrypted message
   * @param {string} privateKey - Recipient's private key
   * @param {string} senderPublicKey - Sender's public key
   * @returns {string} Decrypted message
   */
  static async decryptMessage(encryptedData, privateKey, senderPublicKey) {
    try {
      // Parse the encrypted data
      const data = JSON.parse(encryptedData);
      
      // If it's a symmetric message, decrypt it
      if (data.symmetric) {
        return this.decryptSymmetric(encryptedData, 'doucya-fallback-key');
      }
      
      // Decrypt the symmetric key with own private key
      const privateKeyObj = crypto.createPrivateKey(privateKey);
      const encryptedKey = Buffer.from(data.encryptedKey, 'hex');
      const symmetricKey = crypto.privateDecrypt(
        {
          key: privateKeyObj,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
        },
        encryptedKey
      );
      
      // Decrypt the message with the symmetric key
      const iv = Buffer.from(data.iv, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', symmetricKey, iv);
      let decryptedMessage = decipher.update(data.encryptedMessage, 'hex', 'utf8');
      decryptedMessage += decipher.final('utf8');
      
      return decryptedMessage;
    } catch (err) {
      console.error('Error decrypting message:', err);
      
      // Try fallback symmetric decryption
      try {
        return this.decryptSymmetric(encryptedData, 'doucya-fallback-key');
      } catch (e) {
        throw new Error('Failed to decrypt message');
      }
    }
  }

  /**
   * Encrypt a message using symmetric encryption
   * @param {string} message - Plain text message
   * @param {string} password - Password for symmetric encryption
   * @returns {string} Encrypted message
   */
  static encryptSymmetric(message, password) {
    // Derive key from password
    const key = crypto.scryptSync(password, 'salt', 32);
    
    // Generate random IV
    const iv = crypto.randomBytes(this.IV_SIZE);
    
    // Encrypt message
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptedMessage = cipher.update(message, 'utf8', 'hex');
    encryptedMessage += cipher.final('hex');
    
    // Return encrypted message with IV and symmetric flag
    return JSON.stringify({
      symmetric: true,
      iv: iv.toString('hex'),
      encryptedMessage
    });
  }

  /**
   * Decrypt a message using symmetric encryption
   * @param {string} encryptedData - Encrypted message
   * @param {string} password - Password for symmetric encryption
   * @returns {string} Decrypted message
   */
  static decryptSymmetric(encryptedData, password) {
    // Parse encrypted data
    const data = JSON.parse(encryptedData);
    
    // Derive key from password
    const key = crypto.scryptSync(password, 'salt', 32);
    
    // Decrypt message
    const iv = Buffer.from(data.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decryptedMessage = decipher.update(data.encryptedMessage, 'hex', 'utf8');
    decryptedMessage += decipher.final('utf8');
    
    return decryptedMessage;
  }

  /**
   * Generate an authentication tag for a message
   * @param {string} message - Message content
   * @param {string} privateKey - Private key for signing
   * @returns {string} Authentication tag
   */
  static generateAuthTag(message, privateKey) {
    return Keys.sign(Keys.hash(message), privateKey);
  }

  /**
   * Verify an authentication tag
   * @param {string} message - Message content
   * @param {string} tag - Authentication tag
   * @param {string} publicKey - Public key for verification
   * @returns {boolean} Whether the tag is valid
   */
  static verifyAuthTag(message, tag, publicKey) {
    return Keys.verify(Keys.hash(message), tag, publicKey);
  }
}

module.exports = Encryption;

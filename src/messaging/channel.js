/**
 * Channel class for DoucyA blockchain
 */

'use strict';

const crypto = require('crypto');
const config = require('../config');

class Channel {
  /**
   * Create a new channel
   * @param {string} name - Channel name
   * @param {string} owner - Channel owner address
   * @param {boolean} isPrivate - Whether the channel is private
   */
  constructor(name, owner, isPrivate = false) {
    this.id = this.generateId(name, owner);
    this.name = name;
    this.owner = owner;
    this.isPrivate = isPrivate;
    this.subscribers = [owner]; // Owner is automatically a subscriber
    this.admins = [owner]; // Owner is automatically an admin
    this.created = Date.now();
    this.posts = [];
    this.invites = []; // Addresses invited to the channel
    this.banned = []; // Banned addresses
  }

  /**
   * Generate a unique channel ID
   * @param {string} name - Channel name
   * @param {string} owner - Owner address
   * @returns {string} - Channel ID
   */
  generateId(name, owner) {
    const data = `CHANNEL:${name}:${owner}:${Date.now()}`;
    return crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Add a subscriber to the channel
   * @param {string} address - Address to add
   * @returns {boolean} - Whether the subscriber was added
   */
  addSubscriber(address) {
    // Check if channel is private and address is invited
    if (this.isPrivate && !this.invites.includes(address)) {
      return false;
    }
    
    // Check if address is banned
    if (this.banned.includes(address)) {
      return false;
    }
    
    // Add address to subscribers if not already a subscriber
    if (!this.subscribers.includes(address)) {
      this.subscribers.push(address);
      
      // Remove from invites if present
      const inviteIndex = this.invites.indexOf(address);
      if (inviteIndex !== -1) {
        this.invites.splice(inviteIndex, 1);
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Remove a subscriber from the channel
   * @param {string} address - Address to remove
   * @param {string} removedBy - Address removing the subscriber
   * @returns {boolean} - Whether the subscriber was removed
   */
  removeSubscriber(address, removedBy) {
    // Subscribers can remove themselves, otherwise only admins can remove subscribers
    if (address !== removedBy && !this.admins.includes(removedBy)) {
      return false;
    }
    
    // Owner cannot be removed
    if (address === this.owner) {
      return false;
    }
    
    // Remove address from subscribers
    const subscriberIndex = this.subscribers.indexOf(address);
    if (subscriberIndex !== -1) {
      this.subscribers.splice(subscriberIndex, 1);
      
      // Also remove from admins if they're an admin
      const adminIndex = this.admins.indexOf(address);
      if (adminIndex !== -1) {
        this.admins.splice(adminIndex, 1);
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Make a subscriber an admin
   * @param {string} address - Address to make admin
   * @param {string} promotedBy - Address promoting the subscriber
   * @returns {boolean} - Whether the subscriber was made admin
   */
  makeAdmin(address, promotedBy) {
    // Only admins can make other admins
    if (!this.admins.includes(promotedBy)) {
      return false;
    }
    
    // Address must be a subscriber
    if (!this.subscribers.includes(address)) {
      return false;
    }
    
    // Add address to admins if not already an admin
    if (!this.admins.includes(address)) {
      this.admins.push(address);
      return true;
    }
    
    return false;
  }

  /**
   * Remove admin status from a subscriber
   * @param {string} address - Address to remove admin status from
   * @param {string} demotedBy - Address demoting the admin
   * @returns {boolean} - Whether the admin was demoted
   */
  removeAdmin(address, demotedBy) {
    // Only the owner can demote admins
    if (demotedBy !== this.owner) {
      return false;
    }
    
    // Owner cannot be demoted
    if (address === this.owner) {
      return false;
    }
    
    // Remove address from admins
    const adminIndex = this.admins.indexOf(address);
    if (adminIndex !== -1) {
      this.admins.splice(adminIndex, 1);
      return true;
    }
    
    return false;
  }

  /**
   * Invite an address to the channel
   * @param {string} address - Address to invite
   * @param {string} invitedBy - Address inviting the subscriber
   * @returns {boolean} - Whether the address was invited
   */
  invite(address, invitedBy) {
    // Only admins can invite
    if (!this.admins.includes(invitedBy)) {
      return false;
    }
    
    // Don't invite if already a subscriber
    if (this.subscribers.includes(address)) {
      return false;
    }
    
    // Don't invite if banned
    if (this.banned.includes(address)) {
      return false;
    }
    
    // Add address to invites if not already invited
    if (!this.invites.includes(address)) {
      this.invites.push(address);
      return true;
    }
    
    return false;
  }

  /**
   * Ban an address from the channel
   * @param {string} address - Address to ban
   * @param {string} bannedBy - Address banning the subscriber
   * @returns {boolean} - Whether the address was banned
   */
  ban(address, bannedBy) {
    // Only admins can ban
    if (!this.admins.includes(bannedBy)) {
      return false;
    }
    
    // Owner cannot be banned
    if (address === this.owner) {
      return false;
    }
    
    // Remove from subscribers and admins
    const subscriberIndex = this.subscribers.indexOf(address);
    if (subscriberIndex !== -1) {
      this.subscribers.splice(subscriberIndex, 1);
    }
    
    const adminIndex = this.admins.indexOf(address);
    if (adminIndex !== -1) {
      this.admins.splice(adminIndex, 1);
    }
    
    // Remove from invites
    const inviteIndex = this.invites.indexOf(address);
    if (inviteIndex !== -1) {
      this.invites.splice(inviteIndex, 1);
    }
    
    // Add to banned if not already banned
    if (!this.banned.includes(address)) {
      this.banned.push(address);
      return true;
    }
    
    return false;
  }

  /**
   * Unban an address
   * @param {string} address - Address to unban
   * @param {string} unbannedBy - Address unbanning the subscriber
   * @returns {boolean} - Whether the address was unbanned
   */
  unban(address, unbannedBy) {
    // Only admins can unban
    if (!this.admins.includes(unbannedBy)) {
      return false;
    }
    
    // Remove from banned
    const bannedIndex = this.banned.indexOf(address);
    if (bannedIndex !== -1) {
      this.banned.splice(bannedIndex, 1);
      return true;
    }
    
    return false;
  }

  /**
   * Add a post to the channel
   * @param {Object} post - Post object
   * @returns {boolean} - Whether the post was added
   */
  addPost(post) {
    // Only admins can post
    if (!this.admins.includes(post.author)) {
      return false;
    }
    
    // Add post
    this.posts.push(post);
    return true;
  }

  /**
   * Get posts in the channel
   * @param {number} limit - Maximum number of posts to get
   * @param {number} offset - Offset to start from
   * @returns {Array} - Array of posts
   */
  getPosts(limit = 50, offset = 0) {
    // Sort posts by timestamp
    const sortedPosts = this.posts.sort((a, b) => b.timestamp - a.timestamp);
    
    // Return slice of posts
    return sortedPosts.slice(offset, offset + limit);
  }

  /**
   * Check if an address is a subscriber
   * @param {string} address - Address to check
   * @returns {boolean} - Whether the address is a subscriber
   */
  isSubscriber(address) {
    return this.subscribers.includes(address);
  }

  /**
   * Check if an address is an admin
   * @param {string} address - Address to check
   * @returns {boolean} - Whether the address is an admin
   */
  isAdmin(address) {
    return this.admins.includes(address);
  }

  /**
   * Check if an address is banned
   * @param {string} address - Address to check
   * @returns {boolean} - Whether the address is banned
   */
  isBanned(address) {
    return this.banned.includes(address);
  }

  /**
   * Check if an address is invited
   * @param {string} address - Address to check
   * @returns {boolean} - Whether the address is invited
   */
  isInvited(address) {
    return this.invites.includes(address);
  }

  /**
   * Convert channel to JSON object
   * @returns {Object} - Channel as JSON object
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      owner: this.owner,
      isPrivate: this.isPrivate,
      subscribers: this.subscribers,
      admins: this.admins,
      created: this.created,
      invites: this.invites,
      banned: this.banned,
      postCount: this.posts.length
    };
  }

  /**
   * Create a channel from JSON object
   * @param {Object} data - Channel data
   * @returns {Channel} - Channel instance
   */
  static fromJSON(data) {
    const channel = new Channel(data.name, data.owner, data.isPrivate);
    
    channel.id = data.id;
    channel.subscribers = data.subscribers || [data.owner];
    channel.admins = data.admins || [data.owner];
    channel.created = data.created || Date.now();
    channel.invites = data.invites || [];
    channel.banned = data.banned || [];
    channel.posts = data.posts || [];
    
    return channel;
  }
}

module.exports = Channel;

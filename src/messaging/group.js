/**
 * Group class for DoucyA blockchain
 */

'use strict';

const crypto = require('crypto');
const config = require('../config');

class Group {
  /**
   * Create a new group
   * @param {string} name - Group name
   * @param {string} owner - Group owner address
   * @param {boolean} isPrivate - Whether the group is private
   */
  constructor(name, owner, isPrivate = false) {
    this.id = this.generateId(name, owner);
    this.name = name;
    this.owner = owner;
    this.isPrivate = isPrivate;
    this.members = [owner]; // Owner is automatically a member
    this.admins = [owner]; // Owner is automatically an admin
    this.created = Date.now();
    this.messages = [];
    this.invites = []; // Addresses invited to the group
    this.banned = []; // Banned addresses
  }

  /**
   * Generate a unique group ID
   * @param {string} name - Group name
   * @param {string} owner - Owner address
   * @returns {string} - Group ID
   */
  generateId(name, owner) {
    const data = `GROUP:${name}:${owner}:${Date.now()}`;
    return crypto
      .createHash(config.crypto.hashAlgorithm)
      .update(data)
      .digest('hex');
  }

  /**
   * Add a member to the group
   * @param {string} address - Address to add
   * @param {string} invitedBy - Address that invited the member
   * @returns {boolean} - Whether the member was added
   */
  addMember(address, invitedBy) {
    // Check if group is private and address is invited
    if (this.isPrivate && !this.invites.includes(address)) {
      return false;
    }
    
    // Check if address is banned
    if (this.banned.includes(address)) {
      return false;
    }
    
    // Add address to members if not already a member
    if (!this.members.includes(address)) {
      this.members.push(address);
      
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
   * Remove a member from the group
   * @param {string} address - Address to remove
   * @param {string} removedBy - Address removing the member
   * @returns {boolean} - Whether the member was removed
   */
  removeMember(address, removedBy) {
    // Only admins can remove members
    if (!this.admins.includes(removedBy)) {
      return false;
    }
    
    // Owner cannot be removed
    if (address === this.owner) {
      return false;
    }
    
    // Remove address from members
    const memberIndex = this.members.indexOf(address);
    if (memberIndex !== -1) {
      this.members.splice(memberIndex, 1);
      
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
   * Make a member an admin
   * @param {string} address - Address to make admin
   * @param {string} promotedBy - Address promoting the member
   * @returns {boolean} - Whether the member was made admin
   */
  makeAdmin(address, promotedBy) {
    // Only admins can make other admins
    if (!this.admins.includes(promotedBy)) {
      return false;
    }
    
    // Address must be a member
    if (!this.members.includes(address)) {
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
   * Remove admin status from a member
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
   * Invite an address to the group
   * @param {string} address - Address to invite
   * @param {string} invitedBy - Address inviting the member
   * @returns {boolean} - Whether the address was invited
   */
  invite(address, invitedBy) {
    // Only admins can invite
    if (!this.admins.includes(invitedBy)) {
      return false;
    }
    
    // Don't invite if already a member
    if (this.members.includes(address)) {
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
   * Ban an address from the group
   * @param {string} address - Address to ban
   * @param {string} bannedBy - Address banning the member
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
    
    // Remove from members and admins
    const memberIndex = this.members.indexOf(address);
    if (memberIndex !== -1) {
      this.members.splice(memberIndex, 1);
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
   * @param {string} unbannedBy - Address unbanning the member
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
   * Add a message to the group
   * @param {Object} message - Message object
   * @returns {boolean} - Whether the message was added
   */
  addMessage(message) {
    // Check if sender is a member
    if (!this.members.includes(message.from)) {
      return false;
    }
    
    // Add message
    this.messages.push(message);
    return true;
  }

  /**
   * Get messages in the group
   * @param {number} limit - Maximum number of messages to get
   * @param {number} offset - Offset to start from
   * @returns {Array} - Array of messages
   */
  getMessages(limit = 50, offset = 0) {
    // Sort messages by timestamp
    const sortedMessages = this.messages.sort((a, b) => b.timestamp - a.timestamp);
    
    // Return slice of messages
    return sortedMessages.slice(offset, offset + limit);
  }

  /**
   * Check if an address is a member
   * @param {string} address - Address to check
   * @returns {boolean} - Whether the address is a member
   */
  isMember(address) {
    return this.members.includes(address);
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
   * Convert group to JSON object
   * @returns {Object} - Group as JSON object
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      owner: this.owner,
      isPrivate: this.isPrivate,
      members: this.members,
      admins: this.admins,
      created: this.created,
      invites: this.invites,
      banned: this.banned,
      messageCount: this.messages.length
    };
  }

  /**
   * Create a group from JSON object
   * @param {Object} data - Group data
   * @returns {Group} - Group instance
   */
  static fromJSON(data) {
    const group = new Group(data.name, data.owner, data.isPrivate);
    
    group.id = data.id;
    group.members = data.members || [data.owner];
    group.admins = data.admins || [data.owner];
    group.created = data.created || Date.now();
    group.invites = data.invites || [];
    group.banned = data.banned || [];
    group.messages = data.messages || [];
    
    return group;
  }
}

module.exports = Group;

/**
 * In-memory state tracking for users (e.g., WAITING_UTR)
 * { [chatId]: { step: 'WAITING_UTR', orderId: '...' } }
 */
const userStates = {};

module.exports = userStates;

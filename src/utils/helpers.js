const config = require("../../config");

/**
 * Safe wrapper — logs errors and sends a user-friendly message
 */
async function safeExec(bot, chatId, fn) {
  try {
    await fn();
  } catch (err) {
    if (err.message && (err.message.includes("message to edit not found") || err.message.includes("message is not modified"))) {
      return; // Ignore these specific Telegram errors
    }
    console.error(`[BOT ERROR] chatId=${chatId}`, err.message || err);
    await bot.sendMessage(
      chatId,
      "⚠️ Something went wrong. Please try again in a moment.\nIf this keeps happening, contact " +
      config.SUPPORT_USERNAME
    );
  }
}

/**
 * Robust message editor/sender
 */
async function editOrSendMessage(bot, chatId, messageId, text, options = {}) {
  try {
    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
    } else {
      await bot.sendMessage(chatId, text, options);
    }
  } catch (err) {
    // Fallback if edit fails
    if (err.message && (err.message.includes("message to edit not found") || err.message.includes("message_id_invalid"))) {
      await bot.sendMessage(chatId, text, options);
    } else if (err.message && err.message.includes("message is not modified")) {
      // Do nothing, UI is already correct
    } else {
      throw err;
    }
  }
}

/**
 * Escape Markdown special characters
 */
function escapeMarkdown(text) {
  if (!text) return "";
  return String(text).replace(/([*_`\[\]()])/g, "\\$1");
}

module.exports = {
  safeExec,
  editOrSendMessage,
  escapeMarkdown,
};

const userStates = require("../state");

/**
 * Inline Callback Router
 */
async function handleCallback(bot, query, store, utils, components) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;

  try {
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.warn("[CALLBACK] Failed to answer query:", err.message);
  }

  // Compatibility for old messages from the multi-coupon version
  if (data.startsWith("QTY_SELECT:") || data.startsWith("QTY_CUSTOM:")) {
    const productId = data.split(":")[1];
    return utils.safeExec(bot, chatId, () =>
      components.payments.handleBuyProduct(bot, chatId, productId, store, utils.formatPrice)
    );
  }

  if (data.startsWith("CAT:")) {
    const categoryKey = data.split(":")[1];
    return utils.safeExec(bot, chatId, () =>
      components.catalog.sendProductList(bot, chatId, categoryKey, store, utils.formatPrice, messageId)
    );
  }


  if (data.startsWith("BUY:")) {
    const productId = data.split(":")[1];
    return utils.safeExec(bot, chatId, () =>
      components.payments.handleBuyProduct(bot, chatId, productId, store, utils.formatPrice)
    );
  }

  if (data === "BACK_CATALOG") {
    return utils.safeExec(bot, chatId, () => components.catalog.sendCategoryMenu(bot, chatId, store, messageId));
  }

  // --- MANUAL VERIFICATION HANDLERS ---

  if (data.startsWith("ENTER_UTR:")) {
    const orderId = data.split(":")[1];
    userStates[chatId] = { step: "WAITING_UTR", orderId };
    return bot.sendMessage(chatId, "⌨️ *Please enter your 12-digit UTR number:*", { parse_mode: "Markdown" });
  }


  // --- ADDED CANCEL HANDLER HERE ---
  if (data.startsWith("CANCEL:")) {
    const orderId = data.split(":")[1];

    return utils.safeExec(bot, chatId, async () => {
      // 1. Mark the order as failed in the database
      await store.markOrderFailed(orderId);

      // 2. Clear any waiting state for this user
      if (userStates[chatId] && userStates[chatId].orderId === orderId) {
        delete userStates[chatId];
      }

      // 3. Delete the QR Code message so the user's chat stays clean
      try {
        await bot.deleteMessage(chatId, messageId);
      } catch (err) {
        // Fallback: If deleting fails, at least remove the buttons
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: chatId, message_id: messageId }
        );
      }

      // 4. Send a fresh confirmation message
      await bot.sendMessage(
        chatId,
        `❌ *Order Cancelled*\n\nYour order \`${orderId}\` has been successfully cancelled.\n\nTap 🛒 *Browse Coupons* to start over.`,
        { parse_mode: "Markdown" }
      );
    });
  }

  if (data.startsWith("APPROVE:")) {
    const orderId = data.split(":")[1];
    return utils.safeExec(bot, chatId, () => components.admin.handleAdminApproval(bot, orderId, store, messageId));
  }

  if (data.startsWith("REJECT:")) {
    const orderId = data.split(":")[1];
    // Show reason options to admin
    return bot.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: "❌ Invalid UTR", callback_data: `REASON:${orderId}:INVALID_UTR` }],
        [{ text: "❌ Amount Mismatch", callback_data: `REASON:${orderId}:AMOUNT_MISMATCH` }],
        [{ text: "❌ Payment Not Received", callback_data: `REASON:${orderId}:NOT_RECEIVED` }],
        [{ text: "⬅️ Back", callback_data: `BACK_REJECT:${orderId}` }],
      ]
    }, { chat_id: chatId, message_id: messageId });
  }

  if (data.startsWith("REASON:")) {
    const [, orderId, reasonKey] = data.split(":");
    return utils.safeExec(bot, chatId, () => components.admin.handleAdminRejection(bot, orderId, reasonKey, store, messageId));
  }

  if (data.startsWith("BACK_REJECT:")) {
    const orderId = data.split(":")[1];
    return bot.editMessageReplyMarkup({
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `APPROVE:${orderId}` },
          { text: "❌ Reject", callback_data: `REJECT:${orderId}` },
        ],
      ],
    }, { chat_id: chatId, message_id: messageId });
  }

  // --- ADMIN MANAGEMENT HANDLERS ---

  if (data.startsWith("ADMIN_")) {
    // Handle admin flow states
    if (data.startsWith("ADMIN_ADD_STOCK:")) {
      const productId = data.split(":")[1];
      userStates[chatId] = { step: "ADMIN_WAITING_STOCK", productId };
      return bot.sendMessage(chatId, `🔢 *Adding Stock to:* \`${productId}\`\n\nPlease paste your coupon codes (one per line):`, { parse_mode: "Markdown" });
    }

    if (data.startsWith("ADMIN_EDIT_PRICE:")) {
      const productId = data.split(":")[1];
      userStates[chatId] = { step: "ADMIN_WAITING_PRICE", productId };
      return bot.sendMessage(chatId, `💰 *Editing Price for:* \`${productId}\`\n\nPlease enter the new price in Rupees (e.g., 149):`, { parse_mode: "Markdown" });
    }

    if (data.startsWith("ADMIN_EDIT_NAME:")) {
      const productId = data.split(":")[1];
      userStates[chatId] = { step: "ADMIN_WAITING_NAME", productId };
      return bot.sendMessage(chatId, `📝 *Editing Name for:* \`${productId}\`\n\nPlease enter the new product name:`, { parse_mode: "Markdown" });
    }

    if (data.startsWith("ADMIN_EDIT_CAT:")) {
      const productId = data.split(":")[1];
      userStates[chatId] = { step: "ADMIN_WAITING_CAT_UPDATE", productId };
      return bot.sendMessage(chatId, `🏷️ *Editing Category for:* \`${productId}\`\n\nPlease enter the new category key (e.g., myntra, deals):`, { parse_mode: "Markdown" });
    }

    if (data === "ADMIN_ADD_PRODUCT") {
      userStates[chatId] = { step: "ADMIN_WAITING_PROD_ID" };
      return bot.sendMessage(chatId, `➕ *Adding New Product*\n\nPlease enter a unique Product ID (e.g., MYNTRA_50):`, { parse_mode: "Markdown" });
    }

    return utils.safeExec(bot, chatId, () => components.admin.handleAdminAction(bot, chatId, data, store, messageId));
  }
}

module.exports = {
  handleCallback,
};

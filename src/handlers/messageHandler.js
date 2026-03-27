const config = require("../../config");
const Order = require("../../models/Order");
const userStates = require("../state");

/**
 * Main Message Router
 */
async function handleMessage(bot, msg, store, utils, components) {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  await store.upsertUser(msg);

  const state = userStates[chatId];
  if (state && state.step === "WAITING_UTR") {
    const utr = text.trim();
    if (!/^\d{12}$/.test(utr)) {
      return bot.sendMessage(chatId, "❌ *Invalid UTR!* Please enter a valid 12-digit numeric UTR number.", { parse_mode: "Markdown" });
    }

    // Check for duplicate UTR
    const duplicateUtr = await Order.exists({
      utrNumber: utr,
      status: { $in: ["verification", "paid", "delivered"] }
    });

    if (duplicateUtr) {
      return bot.sendMessage(chatId, "❌ *Duplicate UTR!* This UTR number has already been used or is currently pending verification.", { parse_mode: "Markdown" });
    }

    const orderId = state.orderId;
    delete userStates[chatId];

    await store.updateOrderByUTR(orderId, utr);
    const order = await Order.findOne({ orderId });
    const product = await store.getProduct(order.productId);

    await bot.sendMessage(
      chatId,
      `✅ *UTR Submitted!*\n\n` +
      `Order ID: \`${orderId}\`\n` +
      `Status: Verification Pending\n\n` +
      `Admin will verify your payment shortly.`,
      { parse_mode: "Markdown" }
    );

    // Notify Admin
    if (config.ADMIN_CHAT_ID) {
      const adminText =
        `🔔 *New Payment Verification*\n\n` +
        `👤 *User ID:* \`${chatId}\`\n` +
        `📦 *Coupon:* ${product ? product.name : order.productId}\n` +
        `💰 *Amount:* ${utils.formatPrice(order.totalPrice || 0)}\n` +
        `🔖 *Order Number:* \`${orderId}\`\n` +
        `🔢 *UTR:* \`${utr}\`\n\n` +
        `Please approve or reject:`;

      await bot.sendMessage(config.ADMIN_CHAT_ID, adminText, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `APPROVE:${orderId}` },
              { text: "❌ Reject", callback_data: `REJECT:${orderId}` },
            ],
          ],
        },
      });
    }
    return;
  }

  // --- ADMIN STATE HANDLERS ---
  if (state && state.step.startsWith("ADMIN_")) {
    // Only allow admin to use these states
    if (String(chatId) !== String(config.ADMIN_CHAT_ID)) {
      delete userStates[chatId];
      return;
    }

    const { step, productId } = state;

    if (step === "ADMIN_WAITING_STOCK") {
      const coupons = text.split("\n").map(s => s.trim()).filter(Boolean);
      if (coupons.length === 0) return bot.sendMessage(chatId, "❌ No valid coupons found. Please try again.");

      await store.addCouponsToPool(productId, coupons);
      delete userStates[chatId];
      await bot.sendMessage(chatId, `✅ Successfully added *${coupons.length}* coupons to \`${productId}\`.`, { parse_mode: "Markdown" });
      return components.admin.handleAdminAction(bot, chatId, `ADMIN_PROD:${productId}`, store);
    }

    if (step === "ADMIN_WAITING_PRICE") {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) return bot.sendMessage(chatId, "❌ Invalid price. Please enter a number.");

      await store.updateProduct(productId, { price: Math.round(price * 100) });
      delete userStates[chatId];
      await bot.sendMessage(chatId, `✅ Price updated to *₹${price}* for \`${productId}\`.`, { parse_mode: "Markdown" });
      return components.admin.handleAdminAction(bot, chatId, `ADMIN_PROD:${productId}`, store);
    }

    if (step === "ADMIN_WAITING_NAME") {
      const newName = text.trim();
      if (!newName) return bot.sendMessage(chatId, "❌ Invalid name. Please try again.");

      await store.updateProduct(productId, { name: newName });
      delete userStates[chatId];
      await bot.sendMessage(chatId, `✅ Name updated to *${newName}* for \`${productId}\`.`, { parse_mode: "Markdown" });
      return components.admin.handleAdminAction(bot, chatId, `ADMIN_PROD:${productId}`, store);
    }

    if (step === "ADMIN_WAITING_CAT_UPDATE") {
      const newCat = text.trim().toLowerCase();
      if (!newCat) return bot.sendMessage(chatId, "❌ Invalid category. Please try again.");

      await store.updateProduct(productId, { category: newCat, categoryLabel: text.trim() });
      delete userStates[chatId];
      await bot.sendMessage(chatId, `✅ Category updated to *${text.trim()}* for \`${productId}\`.`, { parse_mode: "Markdown" });
      return components.admin.handleAdminAction(bot, chatId, `ADMIN_PROD:${productId}`, store);
    }

    // Add Product Flow
    if (step === "ADMIN_WAITING_PROD_ID") {
      const id = text.trim().toUpperCase().replace(/\s+/g, "_");
      userStates[chatId] = { step: "ADMIN_WAITING_PROD_NAME", newProd: { id } };
      return bot.sendMessage(chatId, `🏷️ *Product ID:* \`${id}\`\n\nNext, enter the *Product Name* (e.g., Myntra ₹500 Coupon):`, { parse_mode: "Markdown" });
    }

    if (step === "ADMIN_WAITING_PROD_NAME") {
      state.newProd.name = text.trim();
      state.step = "ADMIN_WAITING_PROD_CAT";
      return bot.sendMessage(chatId, `📁 *Product Name:* ${state.newProd.name}\n\nEnter the *Category Key* (e.g., myntra, amazon):`, { parse_mode: "Markdown" });
    }

    if (step === "ADMIN_WAITING_PROD_CAT") {
      state.newProd.category = text.trim().toLowerCase();
      state.newProd.categoryLabel = text.trim(); // Default label
      state.step = "ADMIN_WAITING_PROD_PRICE";
      return bot.sendMessage(chatId, `💰 *Category:* ${state.newProd.category}\n\nEnter the *Price in Rupees* (e.g., 299):`, { parse_mode: "Markdown" });
    }

    if (step === "ADMIN_WAITING_PROD_PRICE") {
      const priceVal = parseFloat(text);
      if (isNaN(priceVal)) return bot.sendMessage(chatId, "❌ Invalid price. Enter a number.");

      state.newProd.price = Math.round(priceVal * 100);
      const newProd = state.newProd;
      delete userStates[chatId];

      try {
        await store.createProduct(newProd);
        await bot.sendMessage(chatId, `✅ *Product Created!*\n\nID: \`${newProd.id}\`\nName: ${newProd.name}\nPrice: ₹${priceVal}`, { parse_mode: "Markdown" });
        return components.admin.handleAdminAction(bot, chatId, "ADMIN_CATALOG", store);
      } catch (err) {
        return bot.sendMessage(chatId, `❌ *Error:* ${err.message}`);
      }
    }
    return;
  }

  switch (text) {
    case "🛒 Browse Coupons":
      return utils.safeExec(bot, chatId, () => components.catalog.sendCategoryMenu(bot, chatId, store));

    case "📦 My Orders":
      return utils.safeExec(bot, chatId, () => components.orders.sendMyOrders(bot, chatId, store, utils.formatPrice, utils.statusBadge));

    case "💬 Support":
      return utils.safeExec(bot, chatId, () => sendSupport(bot, chatId, utils.mainMenuKeyboard));

    case "❓ Help":
      return utils.safeExec(bot, chatId, () => components.start.handleHelp(bot, chatId, utils.mainMenuKeyboard));

    default:
      return bot.sendMessage(
        chatId,
        "Use the menu buttons below to navigate the store 👇",
        utils.mainMenuKeyboard()
      );
  }
}

/**
 * Support message
 */
async function sendSupport(bot, chatId, mainMenuKeyboard) {
  const supportText =
    `💬 *Contact & Support*\n\n` +
    `Have a question or issue? We're here to help!\n\n` +
    `📝 Message us with your Order ID\n` +
    `👤 Support: ${config.SUPPORT_USERNAME}\n` +
    `⏰ Response time: Usually within 1-2 hours\n\n` +

    `📜 *Terms & Conditions*\n\n` +
    `1. Only one coupon code can be purchased at a time.\n` +
    `2. If payment is made for more than one code in a single transaction, no guarantee will be provided.\n` +
    `3. No replacement will be given, as all coupon codes are already verified and checked.\n` +
    `4. If the coupon fails for any reason, please contact on Telegram: ${config.SUPPORT_USERNAME}`;

  await bot.sendMessage(chatId, supportText, {
    parse_mode: "Markdown",
    ...mainMenuKeyboard(),
  });
}

module.exports = {
  handleMessage,
};

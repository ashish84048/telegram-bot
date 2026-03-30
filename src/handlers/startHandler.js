const config = require("../../config");
const { escapeMarkdown } = require("../utils/helpers");

/**
 * /start handler
 */
async function handleStart(bot, msg, store, utils, components) {
  const chatId = msg.chat.id;
  await store.upsertUser(msg);

  const name = escapeMarkdown(msg.from.first_name || "there");
  const userOrders = await store.getUserOrders(chatId);
  const isReturning = userOrders.length > 0;

  const greeting = isReturning
    ? `👋 Welcome back, *${name}*! Great to see you again.`
    : `🎉 Hello, *${name}*! Welcome to *${config.SHOP_NAME}*!`;

  const welcomeText =
    `${greeting}

🔥 *What we offer:*
👗 Myntra coupons —
• Flat ₹100 off
• Flat ₹150 off

⚡ *Instant delivery after payment*

Use the menu below to get started! ⬇️`;

  await bot.sendMessage(chatId, welcomeText, {
    parse_mode: "Markdown",
    ...utils.mainMenuKeyboard(),
  });
}

/**
 * /help handler
 */
async function handleHelp(bot, chatId, store, utils, components) {
  const helpText =
    `❓ *How ${config.SHOP_NAME} Works*\n\n` +
    `*Step 1 —* Tap 🛒 *Browse Coupons*\n` +
    `*Step 2 —* Pick a category (Myntra, Amazon…)\n` +
    `*Step 3 —* Select the coupon you want\n` +
    `*Step 4 —* Pay securely via UPI\n` +
    `*Step 5 —* Your coupon arrives *instantly* 🎉\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 *My Orders* — See all your past purchases\n` +
    `💬 *Support* — Get help from our team\n\n` +
    `Need help? Contact ${config.SUPPORT_USERNAME}`;

  await bot.sendMessage(chatId, helpText, {
    parse_mode: "Markdown",
    ...utils.mainMenuKeyboard(),
  });
}

/**
 * /myid handler
 */
async function handleMyId(bot, chatId) {
  await bot.sendMessage(chatId, `🆔 Your numeric Telegram ID is: \`${chatId}\`\n\nCopy this and paste it into your \`.env\` file as \`ADMIN_CHAT_ID\`.`, { parse_mode: "Markdown" });
}

module.exports = {
  handleStart,
  handleHelp,
  handleMyId,
};

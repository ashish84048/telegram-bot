require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const store = require("./store");
const config = require("./config");

// UTILS
const formatters = require("./src/utils/formatters");
const keyboards = require("./src/utils/keyboards");
const helpers = require("./src/utils/helpers");

// COMPONENTS
const catalog = require("./src/components/catalog");
const payments = require("./src/components/payments");
const orders = require("./src/components/orders");

// HANDLERS
const startHandler = require("./src/handlers/startHandler");
const messageHandler = require("./src/handlers/messageHandler");
const callbackHandler = require("./src/handlers/callbackHandler");
const adminHandler = require("./src/handlers/adminHandler");

// ╔══════════════════════════════════════════════════════╗
// ║          🏪 GOLU OFFERS — TELEGRAM BOT              ║
// ╚══════════════════════════════════════════════════════╝

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// Injection containers for easier passing
const utils = {
  ...formatters,
  ...keyboards,
  ...helpers,
};

const components = {
  catalog,
  payments,
  orders,
  start: startHandler,
  admin: adminHandler,
};

// ─────────────────────────────────────────────────────────
// HANDLER REGISTRATION
// ─────────────────────────────────────────────────────────

// Commands
bot.onText(/\/start/, (msg) => startHandler.handleStart(bot, msg, store, keyboards.mainMenuKeyboard));
bot.onText(/\/help/, (msg) => startHandler.handleHelp(bot, msg.chat.id, store, keyboards.mainMenuKeyboard));
bot.onText(/\/myid/, (msg) => startHandler.handleMyId(bot, msg.chat.id));
bot.onText(/\/admin/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    return adminHandler.sendAdminMenu(bot, msg.chat.id, store);
  }
  bot.sendMessage(msg.chat.id, "⛔ *Unauthorized:* This command is for admins only.", { parse_mode: "Markdown" });
});

// Main Message Router
bot.on("message", async (msg) => {
  try {
    await messageHandler.handleMessage(bot, msg, store, utils, components);
  } catch (err) {
    console.error("[MESSAGE ERROR]", err.message || err);
  }
});

// Callback Query Router
bot.on("callback_query", async (query) => {
  try {
    await callbackHandler.handleCallback(bot, query, store, utils, components);
  } catch (err) {
    console.error("[CALLBACK ERROR]", err.message || err);
  }
});

// ─────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────

bot.on("polling_error", (err) => {
  console.error("[POLLING ERROR]", err.code, err.message);
});

bot.on("error", (err) => {
  console.error("[BOT ERROR]", err.message);
});

// ─────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────

(async () => {
  await db.connect();
  await store.initCatalog();

  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  ${config.SHOP_NAME} Bot is LIVE! 🚀   ║`);
  console.log(`╚══════════════════════════════════╝\n`);
})();
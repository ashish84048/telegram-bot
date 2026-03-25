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
// STATE & MAINTENANCE OVERRIDES
// ─────────────────────────────────────────────────────────
let isBotOnline = true;

const checkMaintenance = (chatId) => {
  if (isBotOnline || String(chatId) === String(config.ADMIN_CHAT_ID)) return true;
  bot.sendMessage(chatId, "🛠️ *Maintenance Mode*\n\nThe bot is currently offline for updates. Please check back later.", { parse_mode: "Markdown" });
  return false;
};

// ─────────────────────────────────────────────────────────
// HANDLER REGISTRATION
// ─────────────────────────────────────────────────────────

// Commands
bot.onText(/\/start/, (msg) => {
  if (!checkMaintenance(msg.chat.id)) return;
  startHandler.handleStart(bot, msg, store, keyboards.mainMenuKeyboard);
});

bot.onText(/\/help/, (msg) => {
  if (!checkMaintenance(msg.chat.id)) return;
  startHandler.handleHelp(bot, msg.chat.id, store, keyboards.mainMenuKeyboard);
});

bot.onText(/\/myid/, (msg) => {
  if (!checkMaintenance(msg.chat.id)) return;
  startHandler.handleMyId(bot, msg.chat.id);
});

bot.onText(/\/admin/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    return adminHandler.sendAdminMenu(bot, msg.chat.id, store);
  }
  bot.sendMessage(msg.chat.id, "⛔ *Unauthorized:* This command is for admins only.", { parse_mode: "Markdown" });
});

bot.onText(/\/offline/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    isBotOnline = false;
    bot.sendMessage(msg.chat.id, "🔴 Bot is now OFFLINE. Users will see maintenance mode.");
  }
});

bot.onText(/\/online/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    isBotOnline = true;
    bot.sendMessage(msg.chat.id, "🟢 Bot is now ONLINE. Users can use the bot normally.");
  }
});

// Main Message Router
bot.on("message", async (msg) => {
  try {
    if (!msg.text || msg.text.startsWith("/")) return; // Handled by onText
    if (!checkMaintenance(msg.chat.id)) return;

    await messageHandler.handleMessage(bot, msg, store, utils, components);
  } catch (err) {
    console.error("[MESSAGE ERROR]", err.message || err);
  }
});

// Callback Query Router
bot.on("callback_query", async (query) => {
  try {
    if (!isBotOnline && String(query.message.chat.id) !== String(config.ADMIN_CHAT_ID)) {
      return bot.answerCallbackQuery(query.id, { text: "🛠️ Bot is currently offline for maintenance.", show_alert: true });
    }
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
// RENDER KEEP-ALIVE (EXPRESS SERVER + HEARTBEAT)
// ─────────────────────────────────────────────────────────
const express = require("express");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

function startHeartbeat() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  const serviceName = process.env.RENDER_SERVICE_NAME;

  // Determine URL to ping
  let urlToPing;
  if (externalUrl) {
    urlToPing = externalUrl;
  } else if (serviceName) {
    urlToPing = `https://${serviceName}.onrender.com`;
  } else {
    urlToPing = `http://localhost:${PORT}`;
  }

  // Ensure it has /health route
  if (!urlToPing.endsWith("/health")) {
    urlToPing = `${urlToPing}/health`;
  }

  const protocol = urlToPing.startsWith("https") ? https : http;

  console.log(`[HEARTBEAT] ❤️ Auto-ping started targeting: ${urlToPing} every 4 minutes`);

  // Ping every 4 minutes (240,000 ms)
  setInterval(() => {
    protocol.get(urlToPing, (res) => {
      if (res.statusCode === 200) {
        console.log(`[HEARTBEAT] ✅ Keep-alive ping successful at ${new Date().toISOString()}`);
      } else {
        console.log(`[HEARTBEAT] ⚠️ Ping returned status code: ${res.statusCode}`);
      }
    }).on("error", (err) => {
      console.error(`[HEARTBEAT] ❌ Ping failed: ${err.message}`);
    });
  }, 780000);
}

// ─────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────

(async () => {
  await db.connect();
  await store.initCatalog();

  // Start Express server for keep-alive
  app.listen(PORT, () => {
    console.log(`[SERVER] 🟢 Express server running on port ${PORT}`);
    startHeartbeat();
  });

  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  ${config.SHOP_NAME} Bot is LIVE! 🚀   ║`);
  console.log(`╚══════════════════════════════════╝\n`);
})();
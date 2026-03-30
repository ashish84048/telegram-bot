require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const winston = require("winston");
const https = require("https"); // Native module for heartbeat
const http = require("http");
const mongoose = require("mongoose");

const db = require("./db");
const store = require("./store");
const config = require("./config");

// MODELS (Required for stats/admin routes)
const Product = require("./models/Product");
const Order = require("./models/Order");
const User = require("./models/User");

// UTILS & HELPERS
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

/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           🚀 GOLU OFFERS — ALL-IN-ONE SERVER         ║
 * ║           Bot + Dashboard + Webhook + API            ║
 * ╚══════════════════════════════════════════════════════╝
 */

// --- LOGGING CONFIGURATION ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// --- BOT INITIALIZATION ---
const isProduction = process.env.NODE_ENV === 'production';
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

const bot = new TelegramBot(config.BOT_TOKEN, { 
  polling: !isProduction 
});

// Automate Webhook setup in Production
if (isProduction && RENDER_URL) {
  const webhookUrl = `${RENDER_URL.endsWith('/') ? RENDER_URL.slice(0, -1) : RENDER_URL}/api/webhook`;
  bot.setWebHook(webhookUrl)
    .then(() => console.log(`🚀 Bot Webhook set to: ${webhookUrl}`))
    .catch(err => console.error(`❌ Webhook setup failed: ${err.message}`));
} else if (!isProduction) {
  console.log("🤖 Bot is running in LOCAL POLLING mode");
}

const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || "golu-admin-secret-2024";

// Injection containers for handlers
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

// --- BOT HANDLERS ---

bot.onText(/\/start/, (msg) => {
  startHandler.handleStart(bot, msg, store, utils, components);
});

bot.onText(/\/help/, (msg) => {
  startHandler.handleHelp(bot, msg.chat.id, store, utils, components);
});

bot.onText(/\/admin/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    adminHandler.sendAdminMenu(bot, msg.chat.id, store);
  }
});

bot.onText(/\/stats/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    adminHandler.showStats(bot, msg.chat.id, store);
  }
});

let isBotOnline = true;
bot.onText(/\/offline/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    isBotOnline = false;
    bot.sendMessage(msg.chat.id, "📴 Bot is now OFFLINE. Users will see maintenance mode.");
  }
});

bot.onText(/\/online/, (msg) => {
  if (String(msg.chat.id) === String(config.ADMIN_CHAT_ID)) {
    isBotOnline = true;
    bot.sendMessage(msg.chat.id, "🔛 Bot is now ONLINE. Users can use the bot normally.");
  }
});

const checkMaintenance = (chatId) => {
  if (isBotOnline || String(chatId) === String(config.ADMIN_CHAT_ID)) return true;
  bot.sendMessage(chatId, "🛠️ *Maintenance Mode*\n\nThe bot is currently offline for updates. Please check back later.", { parse_mode: "Markdown" });
  return false;
};

bot.on("message", async (msg) => {
  try {
    if (!msg.text || msg.text.startsWith("/")) return; 
    if (!checkMaintenance(msg.chat.id)) return;
    await messageHandler.handleMessage(bot, msg, store, utils, components);
  } catch (err) {
    logger.error("[MESSAGE ERROR]", { message: err.message });
  }
});

bot.on("callback_query", async (query) => {
  try {
    const chatId = query.message?.chat?.id;
    if (!isBotOnline && String(chatId) !== String(config.ADMIN_CHAT_ID)) {
      return bot.answerCallbackQuery(query.id, { text: "🛠️ Bot is currently offline for maintenance.", show_alert: true });
    }
    await callbackHandler.handleCallback(bot, query, store, utils, components);
  } catch (err) {
    logger.error("[CALLBACK ERROR]", { message: err.message });
  }
});

bot.on("error", (err) => logger.error("[BOT ERROR]", { message: err.message }));

// --- EXPRESS SERVER ---
const app = express();

// API Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

app.use(cors());
app.use(express.json());

// Serve static dashboard files
app.use(express.static(path.join(__dirname, "public")));

// DB Middleware
app.use(async (req, res, next) => {
  try {
    await db.connect();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

// --- DASHBOARD AUTH MIDDLEWARE ---
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || token !== DASHBOARD_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// --- API ROUTES ---

app.post("/api/webhook", async (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.status(200).send("OK");
  } catch (err) {
    res.status(500).send("Error");
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    bot: isBotOnline ? "online" : "offline",
    mode: isProduction ? "webhook" : "polling",
    timestamp: new Date().toISOString()
  });
});

// DASHBOARD STATS
app.get("/api/stats", requireAuth, async (req, res) => {
  try {
    const [totalOrders, pendingOrders, deliveredOrders, failedOrders, totalUsers, products] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: "delivered" }),
      Order.countDocuments({ status: "failed" }),
      User.countDocuments(),
      Product.find({ active: true }).lean(),
    ]);

    const revenueAgg = await Order.aggregate([
      { $match: { status: "delivered" } },
      { $group: { _id: null, total: { $sum: "$totalPrice" } } },
    ]);

    const totalRevenuePaise = revenueAgg[0]?.total || 0;
    const totalStock = products.reduce((sum, p) => sum + p.pool.length, 0);

    res.json({
      totalOrders, pendingOrders, deliveredOrders, failedOrders,
      totalUsers, totalStock, totalRevenue: totalRevenuePaise / 100,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const products = await Product.find().lean();
    res.json(products.map(p => ({ ...p, stock: p.pool.length, pool: undefined })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products", requireAuth, async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, pool: [] });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products/:id/coupons", requireAuth, async (req, res) => {
  try {
    const product = await store.addCouponsToPool(req.params.id, req.body.coupons);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Added coupons", stock: product.pool.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const filter = status ? { status } : {};
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(Number(skip)).limit(Number(limit)).lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ total, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders/:orderId/deliver", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    await store.markOrderPaid(orderId);
    const result = await store.deliverCoupons(orderId);

    if (result.outOfStock) return res.status(400).json({ error: "Out of stock" });

    const order = await Order.findOne({ orderId }).lean();
    if (order && order.coupons?.length > 0) {
      const product = await store.getProduct(order.productId);
      const couponsText = order.coupons.map(c => `\`${c}\``).join("\n");
      await bot.sendMessage(order.userId, `🎁 *Payment Confirmed*\n\nYour coupons for *${product ? product.name : order.productId}*:\n\n${couponsText}\n\nOrder ID: \`${orderId}\``, { parse_mode: "Markdown" })
        .catch(e => logger.error(`Bot notify failed: ${e.message}`));
    }
    res.json({ success: true, coupons: result.coupons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SELF-PING HEARTBEAT (To avoid Render's free tier spin-down) ---
function startHeartbeat() {
  let url = process.env.RENDER_EXTERNAL_URL;
  if (!url) {
    console.warn("⚠️ RENDER_EXTERNAL_URL not set. Heartbeat disabled.");
    return;
  }

  // Ensure URL starts with http/https
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }


  // Ping every 10 minutes (600,000 ms)
  // Render's free tier spins down after 15 minutes of inactivity.
  setInterval(() => {
    const protocol = url.startsWith("https") ? https : http;
    protocol.get(`${url}/health`, (res) => {
      console.log(`💓 Heartbeat: [${new Date().toISOString()}] - Status: ${res.statusCode}`);
    }).on("error", (err) => {
      console.error(`💔 Heartbeat Failed: ${err.message}`);
    });
  }, 10 * 60 * 1000);

  console.log("🚀 Heartbeat service started.");
}


// STARTUP
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await db.connect();
    await store.initCatalog();

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 All-in-one server running on port ${PORT}`);
      if (isProduction) {
        startHeartbeat();
      }
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      console.log("SIGTERM signal received: closing HTTP server");
      server.close(() => {
        console.log("HTTP server closed");
        mongoose.connection.close(false, () => {
          console.log("MongoDB connection closed");
          process.exit(0);
        });
      });
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
})();

module.exports = app;

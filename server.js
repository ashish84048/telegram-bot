require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const rateLimit = require("express-rate-limit");
const winston = require("winston");

const db = require("./db");
const store = require("./store");
const Product = require("./models/Product");
const Order = require("./models/Order");
const User = require("./models/User");

// ╔══════════════════════════════════════════════════════╗
// ║       🏪 GOLU OFFERS — WEBHOOK + DASHBOARD SERVER   ║
// ╚══════════════════════════════════════════════════════╝

// ─── LOGGING CONFIGURATION ─────────────────────────────
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

// Output to console in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

const bot = new TelegramBot(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || "golu-admin-secret-2024";

// ─── MIDDLEWARE ────────────────────────────────────────

// API Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

app.use(cors());
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Apply limiter to all API routes
app.use("/api/", apiLimiter);

// Serve admin dashboard static files
app.use(express.static(path.join(__dirname, "public")));

// ─── DASHBOARD AUTH MIDDLEWARE ────────────────────────────

function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || token !== DASHBOARD_SECRET) {
    logger.warn(`Unauthorized dashboard access attempt from IP: ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized — invalid or missing Bearer token" });
  }
  next();
}

// ─── MANUAL TEST ROUTE ──────────────────────────────
app.get("/api/test-deliver/:orderId", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    logger.info(`[MANUAL TEST] Triggering delivery for: ${orderId}`);

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: "Order not found" });

    await store.markOrderPaid(orderId);
    const result = await store.deliverCoupons(orderId);

    if (result.outOfStock) {
      return res.json({ status: "out_of_stock", message: "Product out of stock" });
    }

    const couponsText = result.coupons.map(c => `\`${c}\``).join(", ");
    await bot.sendMessage(order.userId, `🎁 *Manual Delivery (Test)*\n\nYour Coupon(s): ${couponsText}`, { parse_mode: "Markdown" });

    res.json({ status: "success", coupons: result.coupons });
  } catch (err) {
    logger.error(`Manual test failed for ${req.params.orderId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH CHECK & HEARTBEAT ──────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Golu Offers Webhook + Dashboard",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

function startHeartbeat() {
  const protocol = (process.env.RENDER_EXTERNAL_URL || "").startsWith("https") ? require("https") : require("http");
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}/health`;

  logger.info(`💓 Heartbeat started: Pinging ${url} every 12s`);

  setInterval(() => {
    protocol.get(url, (res) => { }).on("error", (err) => {
      if (!err.message.includes("ECONNREFUSED")) {
        logger.error(`[HEARTBEAT] Ping failed: ${err.message}`);
      }
    });
  }, 12000);
}

// ─── DASHBOARD API ROUTES ──────────────────────────────

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
      totalOrders,
      pendingOrders,
      deliveredOrders,
      failedOrders,
      totalUsers,
      totalStock,
      totalRevenue: totalRevenuePaise / 100,
    });
  } catch (err) {
    logger.error(`Stats fetch error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const products = await Product.find().lean();
    const result = products.map((p) => ({
      ...p,
      stock: p.pool.length,
      pool: undefined,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products", requireAuth, async (req, res) => {
  try {
    const { id, name, price, category } = req.body;
    if (!id || !name || !price || !category) return res.status(400).json({ error: "Missing fields" });

    const product = await Product.create({ ...req.body, pool: [] });
    logger.info(`Admin: Created product ${id}`);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/products/:id/coupons", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { coupons } = req.body;
    const product = await store.addCouponsToPool(id, coupons);
    if (!product) return res.status(404).json({ error: "Product not found" });

    logger.info(`Admin: Added ${coupons.length} coupons to ${id}`);
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
    logger.info(`[FORCE DELIVER] Admin manual fulfill: ${orderId}`);

    await store.markOrderPaid(orderId);
    const result = await store.deliverCoupons(orderId);

    if (result.outOfStock) {
      return res.status(400).json({ error: "Product is out of stock." });
    }

    const order = await Order.findOne({ orderId }).lean();
    if (order && order.coupons?.length > 0) {
      const product = await store.getProduct(order.productId);
      const couponsText = order.coupons.map(c => `\`${c}\``).join("\n");

      await bot.sendMessage(
        order.userId,
        `🎁 *Payment Confirmed (Manual)*\n\n` +
        `Your coupons for *${product ? product.name : order.productId}*:\n\n` +
        `${couponsText}\n\n` +
        `Order ID: \`${orderId}\``,
        { parse_mode: "Markdown" }
      ).catch(e => logger.error(`Bot notify failed: ${e.message}`));
    }

    res.json({ success: true, coupons: result.coupons });
  } catch (err) {
    logger.error(`Manual fulfillment error for ${req.params.orderId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── 404 & STARTUP ─────────────────────────────────────

app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });

(async () => {
  try {
    await db.connect();
    await store.initCatalog();

    app.listen(PORT, () => {
      logger.info(`╔══════════════════════════════════╗`);
      logger.info(`║  Express Server LIVE on port ${PORT} ║`);
      logger.info(`╚══════════════════════════════════╝`);
      startHeartbeat();
    });
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }
})();
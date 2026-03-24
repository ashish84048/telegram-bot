require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const db = require("./db");
const store = require("./store");
const Product = require("./models/Product");
const Order = require("./models/Order");
const User = require("./models/User");

// ╔══════════════════════════════════════════════════════╗
// ║       🏪 GOLU OFFERS — WEBHOOK + DASHBOARD SERVER   ║
// ╚══════════════════════════════════════════════════════╝

const bot = new TelegramBot(process.env.BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || "golu-admin-secret-2024";

// ─── MIDDLEWARE ────────────────────────────────────────
app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Serve admin dashboard static files
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

// Signature verification removed as Razorpay is replaced by manual verification.

// ─── MANUAL TEST ROUTE ──────────────────────────────
// Use this to manually trigger delivery if webhooks are failing to reach you locally.
// Access: http://localhost:3000/api/test-deliver/ORD-xxxx
app.get("/api/test-deliver/:orderId", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`[MANUAL TEST] Triggering delivery for: ${orderId}`);
    
    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: "Order not found" });

    await store.markOrderPaid(orderId);
    const result = await store.deliverCoupons(orderId);
    
    if (result.outOfStock) {
      return res.json({ status: "out_of_stock", message: "Delivery logic worked but product is out of stock" });
    }
    
    const couponsText = result.coupons.map(c => `\`${c}\``).join(", ");
    await bot.sendMessage(order.userId, `🎁 *Manual Delivery (Test)*\n\nYour Coupon(s): ${couponsText}`, { parse_mode: "Markdown" });

    res.json({ status: "success", coupons: result.coupons, message: "Manual delivery success!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function alertAdmin(message) {
  if (!ADMIN_CHAT_ID) return;
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, `🔔 *ADMIN ALERT*\n\n${message}`, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("[ADMIN ALERT FAILED]", err.message);
  }
}

// ─── DASHBOARD AUTH MIDDLEWARE ────────────────────────────

function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || token !== DASHBOARD_SECRET) {
    return res.status(401).json({ error: "Unauthorized — invalid or missing Bearer token" });
  }
  next();
}

// ─────────────────────────────────────────────────────────
// HEALTH CHECK & HEARTBEAT
// ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Golu Offers Webhook + Dashboard",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Automatically ping the health endpoint every 12 seconds
 * to keep the service warm and monitor connectivity.
 */
function startHeartbeat() {
  const protocol = (process.env.RENDER_EXTERNAL_URL || "").startsWith("https") ? require("https") : require("http");
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}/health`;

  console.log(`💓 Heartbeat started: Pinging ${url} every 12s`);
  
  setInterval(() => {
    protocol.get(url, (res) => {
      // console.log(`[HEARTBEAT] Pinged ${url} - Status: ${res.statusCode}`);
    }).on("error", (err) => {
      if (!err.message.includes("ECONNREFUSED")) {
        console.error(`[HEARTBEAT] Ping failed: ${err.message}`);
      }
    });
  }, 12000);
}

// ─────────────────────────────────────────────────────────
// DASHBOARD API ROUTES
// ─────────────────────────────────────────────────────────

// GET /api/stats — Overview numbers
app.get("/api/stats", requireAuth, async (req, res) => {
  try {
    const [
      totalOrders,
      pendingOrders,
      deliveredOrders,
      failedOrders,
      totalUsers,
      products,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: "delivered" }),
      Order.countDocuments({ status: "failed" }),
      User.countDocuments(),
      Product.find({ active: true }).lean(),
    ]);

    // Revenue = sum of product.price for all delivered orders
    const revenueAgg = await Order.aggregate([
      { $match: { status: "delivered" } },
      {
        $lookup: {
          from: "products",
          localField: "productId",
          foreignField: "id",
          as: "product",
        },
      },
      { $unwind: { path: "$product", preserveNullAndEmpty: true } },
      { $group: { _id: null, total: { $sum: "$product.price" } } },
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
      totalRevenue: totalRevenuePaise / 100, // in ₹
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products — List all products
app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const products = await Product.find().lean();
    const result = products.map((p) => ({
      ...p,
      stock: p.pool.length,
      pool: undefined, // don't leak all coupon codes in list view
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products — Create a new product
app.post("/api/products", requireAuth, async (req, res) => {
  try {
    const { id, name, description, price, emoji, category, categoryLabel } = req.body;
    if (!id || !name || !price || !category) {
      return res.status(400).json({ error: "id, name, price, category are required" });
    }
    const existing = await Product.findOne({ id });
    if (existing) return res.status(409).json({ error: `Product '${id}' already exists` });

    const product = await Product.create({
      id,
      name,
      description: description || "",
      price: Number(price),
      emoji: emoji || "🎁",
      category,
      categoryLabel: categoryLabel || category,
      pool: [],
    });
    res.status(201).json({ ...product.toObject(), stock: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/:id/coupons — Bulk-add coupons to a product pool
app.post("/api/products/:id/coupons", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { coupons } = req.body; // array of strings

    if (!Array.isArray(coupons) || coupons.length === 0) {
      return res.status(400).json({ error: "coupons must be a non-empty array of strings" });
    }

    const trimmed = coupons.map((c) => String(c).trim()).filter(Boolean);
    const product = await Product.findOneAndUpdate(
      { id },
      { $push: { pool: { $each: trimmed } } },
      { returnDocument: 'after' }
    ).lean();

    if (!product) return res.status(404).json({ error: `Product '${id}' not found` });

    res.json({
      message: `Added ${trimmed.length} coupons to ${product.name}`,
      stock: product.pool.length,
      added: trimmed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/products/:id/coupons — Remove specific coupons from pool
app.delete("/api/products/:id/coupons", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { coupons } = req.body;

    if (!Array.isArray(coupons) || coupons.length === 0) {
      return res.status(400).json({ error: "coupons must be a non-empty array" });
    }

    const product = await Product.findOneAndUpdate(
      { id },
      { $pullAll: { pool: coupons } },
      { returnDocument: 'after' }
    ).lean();

    if (!product) return res.status(404).json({ error: `Product '${id}' not found` });
    res.json({ message: `Removed coupons`, stock: product.pool.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/products/:id — Toggle active status or update fields
app.patch("/api/products/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    if (req.body.active !== undefined) updates.active = req.body.active;
    if (req.body.name) updates.name = req.body.name;
    if (req.body.price) updates.price = Number(req.body.price);

    const product = await Product.findOneAndUpdate({ id }, { $set: updates }, { returnDocument: 'after' }).lean();
    if (!product) return res.status(404).json({ error: `Product '${id}' not found` });
    res.json({ ...product, stock: product.pool.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders — List orders with optional filters
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const { status, limit = 50, skip = 0, userId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.userId = userId;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit))
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.json({ total, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:orderId/deliver — Force fulfill an order (admin only)
app.post("/api/orders/:orderId/deliver", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log(`[FORCE DELIVER] Manual trigger for: ${orderId}`);
    
    // First, mark as paid if it's still pending
    await store.markOrderPaid(orderId);
    
    // Deliver coupons
    const result = await store.deliverCoupons(orderId);
    
    if (result.outOfStock) {
      return res.status(400).json({ error: "Product is out of stock. Cannot deliver." });
    }
    
    // Find order to get userId and productId
    const order = await Order.findOne({ orderId }).lean();
    if (order && order.coupons && order.coupons.length > 0) {
      const product = await store.getProduct(order.productId);
      const productName = product ? product.name : order.productId;
      const couponsText = order.coupons.map(c => `\`${c}\``).join("\n");
      
      // Send codes to user via bot
      await bot.sendMessage(
        order.userId,
        `🎁 *Payment Confirmed (Manual)*\n\n` +
        `Your coupons for *${productName}* are ready:\n\n` +
        `${couponsText}\n\n` +
        `Order ID: \`${orderId}\``,
        { parse_mode: "Markdown" }
      ).catch(e => console.error("[BOT] Failed to send manual delivery message:", e.message));
    }
    
    res.json({ success: true, coupons: result.coupons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users — List users
app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;
    const [users, total] = await Promise.all([
      User.find().sort({ createdAt: -1 }).skip(Number(skip)).limit(Number(limit)).lean(),
      User.countDocuments(),
    ]);
    res.json({ total, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// RAZORPAY WEBHOOK
// ─────────────────────────────────────────────────────────

// Razorpay Webhook removed. Manual verification is now handled via the bot.

// ─────────────────────────────────────────────────────────
// 404 CATCH-ALL
// ─────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────

(async () => {
  await db.connect();
  await store.initCatalog();

  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════╗`);
    console.log(`║  🏪 Golu Offers Webhook LIVE 🚀  ║`);
    console.log(`║  Dashboard: localhost:${PORT}/dashboard ║`);
    console.log(`╚══════════════════════════════════╝\n`);
    
    startHeartbeat(); // Start self-pinging every 12s
  });
})();
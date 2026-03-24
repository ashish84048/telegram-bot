/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║          🏪 GOLU OFFERS — DATA STORE (MongoDB)           ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const mongoose = require("mongoose");
const Product = require("./models/Product");
const Order = require("./models/Order");
const User = require("./models/User");
const winston = require("winston");

// Configure Winston Logger for auditing
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

// Seed data remains the same
const SEED_CATALOG = [
  {
    id: "MYNTRA_100",
    name: "Myntra ₹100 Off Coupon",
    description: "Flat ₹100 off",
    price: 3000,
    emoji: "👗",
    category: "myntra",
    categoryLabel: "👗 Myntra",
    pool: ["MYNTRA2024A", "MYNTRA2024B", "MYNTRA2024C"],
  },
  {
    id: "MYNTRA_150",
    name: "Myntra ₹150 Off Coupon",
    description: "Flat ₹150 off on orders above ₹499",
    price: 4000,
    emoji: "🛍️",
    category: "myntra",
    categoryLabel: "👗 Myntra",
    pool: ["MYN200DEAL1", "MYN200DEAL2"],
  },
];

async function initCatalog() {
  try {
    const count = await Product.countDocuments();
    if (count === 0) {
      await Product.insertMany(SEED_CATALOG);
      logger.info(`✅ Seeded ${SEED_CATALOG.length} products to MongoDB`);
    }
  } catch (err) {
    if (err.code !== 11000) {
      logger.error("[INIT CATALOG ERROR]", { message: err.message });
    }
  }
}

// ─── CATALOG / PRODUCT HELPERS ─────────────────────────────

async function getCatalog() {
  const products = await Product.find({ active: true }).lean();
  const catalog = {};
  for (const p of products) {
    if (!catalog[p.category]) {
      catalog[p.category] = { label: p.categoryLabel, products: [] };
    }
    catalog[p.category].products.push(p);
  }
  return catalog;
}

async function getProduct(productId) {
  return Product.findOne({ id: productId, active: true }).lean();
}

// ─── USER HELPERS ──────────────────────────────────────────

async function upsertUser(msg) {
  const chatId = String(msg.chat.id);
  const user = await User.findOneAndUpdate(
    { id: chatId },
    {
      $set: {
        name: msg.from.first_name || "",
        username: msg.from.username || null,
      },
      $setOnInsert: { id: chatId },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();
  return user;
}

// ─── ORDER HELPERS ─────────────────────────────────────────

async function createOrder({ userId, productId, quantity = 1 }) {
  const product = await Product.findOne({ id: productId });
  if (!product) throw new Error("Product not found");

  const orderId = `ORD-${Date.now()}-${userId}`;
  const totalPrice = product.price * quantity;

  // includes default expiresAt from model
  const order = await Order.create({
    orderId,
    userId: String(userId),
    productId,
    quantity,
    totalPrice,
    status: "pending",
  });

  logger.info(`Order Created: ${orderId}`, { userId, productId });
  return order.toObject();
}

async function hasPendingOrder(userId, productId) {
  return Order.exists({
    userId: String(userId),
    productId,
    status: "pending",
  });
}

async function getUserOrders(userId) {
  return Order.find({ userId: String(userId) })
    .sort({ createdAt: -1 })
    .lean();
}

async function markOrderFailed(orderId) {
  logger.warn(`Order Failed: ${orderId}`);
  return Order.updateOne({ orderId }, { $set: { status: "failed" } });
}

async function updateOrderByUTR(orderId, utrNumber) {
  return Order.updateOne(
    { orderId },
    { $set: { utrNumber, status: "verification" } }
  );
}

async function markOrderPaid(orderId) {
  return Order.updateOne({ orderId }, { $set: { status: "paid" } });
}

/**
 * Refactored deliverCoupons using Sessions for Atomicity
 */
async function deliverCoupons(orderId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findOne({ orderId }).session(session);
    if (!order) {
      await session.abortTransaction();
      return { coupons: [], outOfStock: true };
    }

    // Return if already delivered to prevent double-spending
    if (order.status === "delivered" && order.coupons?.length > 0) {
      await session.abortTransaction();
      return { coupons: order.coupons, outOfStock: false };
    }

    const quantity = order.quantity || 1;
    const product = await Product.findOne({ id: order.productId }).session(session);

    if (!product || product.pool.length < quantity) {
      await Order.updateOne({ orderId }, { $set: { status: "failed" } }).session(session);
      await session.commitTransaction();
      logger.error(`Stock mismatch for order ${orderId}`);
      return { coupons: [], outOfStock: true };
    }

    const couponsToDeliver = product.pool.slice(0, quantity);

    // Atomically pull from pool and increment sold count
    await Product.updateOne(
      { id: order.productId },
      {
        $pullAll: { pool: couponsToDeliver },
        $inc: { sold: quantity }
      }
    ).session(session);

    // Update order status and REMOVE expiresAt
    await Order.updateOne(
      { orderId },
      {
        $set: { coupons: couponsToDeliver, status: "delivered" },
        $unset: { expiresAt: "" }
      }
    ).session(session);

    await session.commitTransaction();
    logger.info(`Coupons Delivered: ${orderId}`, { coupons: couponsToDeliver });
    return { coupons: couponsToDeliver, outOfStock: false };

  } catch (err) {
    await session.abortTransaction();
    logger.error(`Transaction failed for order ${orderId}`, { error: err.message });
    throw err;
  } finally {
    session.endSession();
  }
}

// ─── ADMIN HELPERS ─────────────────────────────────────────

async function getAllProducts() {
  return Product.find().lean();
}

async function getAdminStats() {
  const [totalOrders, totalUsers, products] = await Promise.all([
    Order.countDocuments(),
    User.countDocuments(),
    Product.find().lean(),
  ]);

  const deliveredOrders = await Order.find({ status: "delivered" }).lean();
  const totalRevenuePaise = deliveredOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
  const totalStock = products.reduce((sum, p) => sum + p.pool.length, 0);

  return {
    totalOrders,
    totalUsers,
    totalStock,
    totalRevenue: totalRevenuePaise / 100,
  };
}

async function updateProduct(productId, updates) {
  logger.info(`Product Updated: ${productId}`, updates);
  return Product.findOneAndUpdate({ id: productId }, { $set: updates }, { new: true }).lean();
}

async function addCouponsToPool(productId, coupons) {
  logger.info(`Stock Added: ${productId}`, { count: coupons.length });
  return Product.findOneAndUpdate(
    { id: productId },
    { $push: { pool: { $each: coupons } } },
    { new: true }
  ).lean();
}

async function getRecentOrders(limit = 10) {
  return Order.find().sort({ createdAt: -1 }).limit(limit).lean();
}

async function createProduct(productData) {
  logger.info(`New Product Created: ${productData.id}`);
  return Product.create(productData);
}

async function deleteCoupon(productId, coupon) {
  return Product.findOneAndUpdate(
    { id: productId },
    { $pull: { pool: coupon } },
    { new: true }
  ).lean();
}

async function getLowStockProducts(threshold = 5) {
  return Product.find({
    active: true,
    $expr: { $lt: [{ $size: "$pool" }, threshold] }
  }).lean();
}

module.exports = {
  initCatalog,
  getCatalog,
  getProduct,
  upsertUser,
  createOrder,
  hasPendingOrder,
  getUserOrders,
  markOrderPaid,
  markOrderFailed,
  updateOrderByUTR,
  deliverCoupons,
  getAllProducts,
  getAdminStats,
  updateProduct,
  addCouponsToPool,
  getRecentOrders,
  createProduct,
  deleteCoupon,
  getLowStockProducts,
};
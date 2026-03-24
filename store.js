/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║          🏪 GOLU OFFERS — DATA STORE (MongoDB)           ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const Product = require("./models/Product");
const Order = require("./models/Order");
const User = require("./models/User");

// ─── CATALOG SEED DATA ─────────────────────────────────────
// Inserted once if the products collection is empty.
const SEED_CATALOG = [
  {
    id: "MYNTRA_99",
    name: "Myntra ₹100 Off Coupon",
    description: "Flat ₹100 off on orders above ₹399",
    price: 9900,
    emoji: "👗",
    category: "myntra",
    categoryLabel: "👗 Myntra",
    pool: ["MYNTRA2024A", "MYNTRA2024B", "MYNTRA2024C"],
  },
  {
    id: "MYNTRA_199",
    name: "Myntra ₹200 Off Coupon",
    description: "Flat ₹200 off on orders above ₹799",
    price: 19900,
    emoji: "🛍️",
    category: "myntra",
    categoryLabel: "👗 Myntra",
    pool: ["MYN200DEAL1", "MYN200DEAL2"],
  },
  {
    id: "AMAZON_149",
    name: "Amazon ₹150 Off Coupon",
    description: "₹150 off on Amazon Fresh & Pantry",
    price: 14900,
    emoji: "📦",
    category: "amazon",
    categoryLabel: "📦 Amazon",
    pool: ["AMZ150FRESH1", "AMZ150FRESH2", "AMZ150FRESH3"],
  },
  {
    id: "SWIGGY_49",
    name: "Swiggy ₹60 Off Coupon",
    description: "₹60 off on first 3 orders",
    price: 4900,
    emoji: "🍔",
    category: "swiggy",
    categoryLabel: "🍔 Swiggy",
    pool: ["SWG60OFF1", "SWG60OFF2", "SWG60OFF3", "SWG60OFF4"],
  },
  {
    id: "ZOMATO_49",
    name: "Zomato ₹75 Off Coupon",
    description: "₹75 off on orders above ₹199",
    price: 4900,
    emoji: "🍕",
    category: "zomato",
    categoryLabel: "🍕 Zomato",
    pool: ["ZOM75DEAL1", "ZOM75DEAL2"],
  },
];

/**
 * Seed the product catalog if the collection is empty.
 * Called once on startup after DB connects.
 */
async function initCatalog() {
  try {
    const count = await Product.countDocuments();
    if (count === 0) {
      await Product.insertMany(SEED_CATALOG);
      console.log(`✅ Seeded ${SEED_CATALOG.length} products to MongoDB`);
    }
  } catch (err) {
    if (err.code === 11000) {
      console.log(`✅ Catalog already seeded by another process.`);
    } else {
      console.error("[INIT CATALOG ERROR]", err.message);
    }
  }
}

// ─── CATALOG / PRODUCT HELPERS ─────────────────────────────

/**
 * Build catalog shape used by index.js (matches old store.catalog format)
 * { [category]: { label, products: [...] } }
 */
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

/**
 * Get a single product by its string ID
 */
async function getProduct(productId) {
  return Product.findOne({ id: productId, active: true }).lean();
}

// ─── USER HELPERS ──────────────────────────────────────────

/**
 * Register or update a Telegram user
 */
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

/**
 * Create a new order
 */
async function createOrder({ userId, productId, quantity = 1 }) {
  const product = await Product.findOne({ id: productId });
  if (!product) throw new Error("Product not found");

  const orderId = `ORD-${Date.now()}-${userId}`;
  const totalPrice = product.price * quantity;

  const order = await Order.create({
    orderId,
    userId: String(userId),
    productId,
    quantity,
    totalPrice,
    status: "pending",
  });
  return order.toObject();
}

/**
 * Check if user has a pending order for a product
 */
async function hasPendingOrder(userId, productId) {
  return Order.exists({
    userId: String(userId),
    productId,
    status: "pending",
  });
}

/**
 * Get all orders for a user, newest first
 */
async function getUserOrders(userId) {
  return Order.find({ userId: String(userId) })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Mark order as failed
 */
async function markOrderFailed(orderId) {
  return Order.updateOne({ orderId }, { $set: { status: "failed" } });
}

/**
 * Update order with UTR and set status to verification
 */
async function updateOrderByUTR(orderId, utrNumber) {
  return Order.updateOne(
    { orderId },
    { $set: { utrNumber, status: "verification" } }
  );
}

/**
 * Mark order as paid (before coupon delivery)
 */
async function markOrderPaid(orderId) {
  return Order.updateOne({ orderId }, { $set: { status: "paid" } });
}

/**
 * Deliver multiple coupons — atomically pops codes from the product pool.
 * Returns { coupons, outOfStock }
 */
async function deliverCoupons(orderId) {
  const order = await Order.findOne({ orderId });
  if (!order) return { coupons: [], outOfStock: true };

  // If already delivered, just return the existing coupons
  if (order.status === "delivered" && order.coupons && order.coupons.length > 0) {
    return { coupons: order.coupons, outOfStock: false };
  }

  const quantity = order.quantity || 1;
  const product = await Product.findOne({ id: order.productId });

  if (!product || product.pool.length < quantity) {
    await Order.updateOne({ orderId }, { $set: { status: "failed" } });
    return { coupons: [], outOfStock: true };
  }

  // Atomic delivery of multiple coupons
  // We identify the coupons to deliver and pull them all at once
  const couponsToDeliver = product.pool.slice(0, quantity);

  const updated = await Product.findOneAndUpdate(
    { id: order.productId, pool: { $all: couponsToDeliver } },
    { 
      $pullAll: { pool: couponsToDeliver },
      $inc: { sold: quantity }
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    // This handles race conditions where pool changed between findOne and findOneAndUpdate
    return { coupons: [], outOfStock: true };
  }

  await Order.updateOne(
    { orderId },
    { $set: { coupons: couponsToDeliver, status: "delivered" } }
  );

  return { coupons: couponsToDeliver, outOfStock: false };
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
  // ADMIN HELPERS
  getAllProducts,
  getAdminStats,
  updateProduct,
  addCouponsToPool,
  getRecentOrders,
  createProduct,
  deleteCoupon,
  getLowStockProducts,
};

/**
 * Get all products (including inactive)
 */
async function getAllProducts() {
  return Product.find().lean();
}

/**
 * Get administrative statistics
 */
async function getAdminStats() {
  const [totalOrders, totalUsers, products] = await Promise.all([
    Order.countDocuments(),
    User.countDocuments(),
    Product.find().lean(),
  ]);

  const deliveredOrders = await Order.find({ status: "delivered" }).lean();
  
  // Revenue = sum of order.totalPrice for all delivered orders
  const totalRevenuePaise = deliveredOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

  const totalStock = products.reduce((sum, p) => sum + p.pool.length, 0);

  return {
    totalOrders,
    totalUsers,
    totalStock,
    totalRevenue: totalRevenuePaise / 100,
  };
}

/**
 * Update product fields
 */
async function updateProduct(productId, updates) {
  return Product.findOneAndUpdate({ id: productId }, { $set: updates }, { new: true }).lean();
}

/**
 * Bulk add coupons
 */
async function addCouponsToPool(productId, coupons) {
  return Product.findOneAndUpdate(
    { id: productId },
    { $push: { pool: { $each: coupons } } },
    { new: true }
  ).lean();
}

/**
 * Get recent orders
 */
async function getRecentOrders(limit = 10) {
  return Order.find().sort({ createdAt: -1 }).limit(limit).lean();
}

/**
 * Create a new product
 */
async function createProduct(productData) {
  return Product.create(productData);
}
/**
 * Delete a single coupon from pool
 */
async function deleteCoupon(productId, coupon) {
  return Product.findOneAndUpdate(
    { id: productId },
    { $pull: { pool: coupon } },
    { new: true }
  ).lean();
}

/**
 * Get products with low stock (< threshold)
 */
async function getLowStockProducts(threshold = 5) {
  return Product.find({
    active: true,
    $expr: { $lt: [{ $size: "$pool" }, threshold] }
  }).lean();
}

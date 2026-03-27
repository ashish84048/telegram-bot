const config = require("../../config");
const Order = require("../../models/Order");
const Product = require("../../models/Product");
const { editOrSendMessage, escapeMarkdown } = require("../utils/helpers");

const REJECTION_REASONS = {
  INVALID_UTR: "The UTR number provided is invalid or incorrect.",
  AMOUNT_MISMATCH: "The payment amount does not match the order price.",
  NOT_RECEIVED: "We haven't received the payment in our bank/wallet yet.",
};

async function handleAdminApproval(bot, orderId, store, adminMessageId = null) {
  const order = await Order.findOne({ orderId });
  if (!order) return console.error(`[ADMIN] Order ${orderId} not found`);

  await store.markOrderPaid(orderId);
  const result = await store.deliverCoupons(orderId);

  if (result.outOfStock) {
    await bot.sendMessage(config.ADMIN_CHAT_ID, `🚨 *APPROVAL FAILED:* Product out of stock for \`${orderId}\``);
    return;
  }

  const couponsText = result.coupons.map(c => `\`${c}\``).join("\n");

  await bot.sendMessage(
    order.userId,
    `🎉 *Payment Verified*\n\n` +
    `Your Coupon Code(s):\n\n` +
    `${couponsText}\n\n` +
    `Thank you for using *Coupon Store*!\n\n` +
    `🤝 Please join https://t.me/earnxupdates for further updates`,
    { parse_mode: "Markdown" }
  );

  // Update admin message to remove buttons
  if (adminMessageId) {
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: config.ADMIN_CHAT_ID, message_id: adminMessageId });
      await bot.sendMessage(config.ADMIN_CHAT_ID, `✅ Order \`${orderId}\` (${order.quantity} units) approved and delivered.`);
    } catch (err) {
      console.error("[ADMIN] Failed to update admin message:", err.message);
    }
  } else {
    await bot.sendMessage(config.ADMIN_CHAT_ID, `✅ Order \`${orderId}\` (${order.quantity} units) approved and delivered.`);
  }
}

async function handleAdminRejection(bot, orderId, reasonKey, store, adminMessageId = null) {
  await store.markOrderFailed(orderId);
  const order = await Order.findOne({ orderId });
  const reasonText = REJECTION_REASONS[reasonKey] || "Payment verification failed.";

  if (order) {
    await bot.sendMessage(
      order.userId,
      `❌ *Payment Not Verified*\n\n` +
      `Reason: ${reasonText}\n\n` +
      `Please check and try again or contact support at ${config.SUPPORT_USERNAME}`,
      { parse_mode: "Markdown" }
    );
  }

  // Update admin message to show only Approve button
  if (adminMessageId) {
    try {
      await bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: "✅ Approve Anyway", callback_data: `APPROVE:${orderId}` }]
        ]
      }, { chat_id: config.ADMIN_CHAT_ID, message_id: adminMessageId });
      await bot.sendMessage(config.ADMIN_CHAT_ID, `❌ Order \`${orderId}\` rejected. Reason: ${reasonKey}`);
    } catch (err) {
      console.error("[ADMIN] Failed to update admin message:", err.message);
    }
  } else {
    await bot.sendMessage(config.ADMIN_CHAT_ID, `❌ Order \`${orderId}\` rejected. Reason: ${reasonKey}`);
  }
}


async function sendAdminMenu(bot, chatId, store, messageId = null) {
  const stats = await store.getAdminStats();
  const lowStock = await store.getLowStockProducts(5);

  let menuText =
    `🛡️ *ADMIN DASHBOARD*\n\n` +
    `💰 *Total Revenue:* ₹${stats.totalRevenue.toLocaleString()}\n` +
    `📦 *Total Stock:* ${stats.totalStock} units\n` +
    `👤 *Total Users:* ${stats.totalUsers}\n` +
    `🛒 *Total Orders:* ${stats.totalOrders}\n\n`;

  if (lowStock.length > 0) {
    menuText += `⚠️ *Low Stock Alert:*\n`;
    lowStock.slice(0, 3).forEach(p => {
      menuText += `• ${p.emoji} ${escapeMarkdown(p.name)} (${p.pool.length} left)\n`;
    });
    if (lowStock.length > 3) menuText += `• ...and ${lowStock.length - 3} more\n`;
    menuText += `\n`;
  }

  menuText += `━━━━━━━━━━━━━━━━━━━━━━\nUse the buttons below to manage the shop:`;

  const keyboard = [
    [{ text: "📦 Manage Catalog", callback_data: "ADMIN_CATALOG" }],
    [{ text: "📜 Recent Orders", callback_data: "ADMIN_ORDERS:0" }],
    [{ text: "➕ Add New Product", callback_data: "ADMIN_ADD_PRODUCT" }],
  ];

  await editOrSendMessage(bot, chatId, messageId, menuText, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard },
  });
}

async function showStats(bot, chatId, store) {
  const stats = await store.getAdminStats();
  const statsText =
    `📊 *Shop Statistics*\n\n` +
    `💰 Revenue: ₹${stats.totalRevenue.toLocaleString()}\n` +
    `📦 Stock: ${stats.totalStock} units\n` +
    `👤 Users: ${stats.totalUsers}\n` +
    `🛒 Orders: ${stats.totalOrders}`;

  await bot.sendMessage(chatId, statsText, { parse_mode: "Markdown" });
}

async function listProductsForAdmin(bot, chatId, store, messageId = null) {
  const products = await store.getAllProducts();
  const text = `📦 *Product Catalog (Admin View)*\n\nSelect a product to manage stock or edit details:`;

  const keyboard = products.map((p) => [
    { text: `${p.active ? "✅" : "❌"} ${p.emoji} ${p.name} (${p.pool.length})`, callback_data: `ADMIN_PROD:${p.id}` },
  ]);

  keyboard.push([{ text: "⬅️ Back to Menu", callback_data: "ADMIN_MENU" }]);

  await editOrSendMessage(bot, chatId, messageId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function listCouponsForProduct(bot, chatId, productId, store, messageId) {
  const product = await Product.findOne({ id: productId }).lean();
  if (!product) return;

  let text = `🔢 *Coupon Pool:* ${product.emoji} ${escapeMarkdown(product.name)}\n\n`;
  const keyboard = [];

  if (product.pool.length === 0) {
    text += `❌ No coupons available in the pool.`;
  } else {
    text += `Listing coupons (tap to delete any):`;
    // Group coupons in rows of 2
    for (let i = 0; i < product.pool.length; i += 2) {
      const row = [];
      row.push({ text: `❌ ${product.pool[i]}`, callback_data: `ADMIN_DEL_C:${productId}:${product.pool[i]}` });
      if (product.pool[i + 1]) {
        row.push({ text: `❌ ${product.pool[i + 1]}`, callback_data: `ADMIN_DEL_C:${productId}:${product.pool[i + 1]}` });
      }
      keyboard.push(row);
    }
  }

  keyboard.push([{ text: "➕ Add More Stock", callback_data: `ADMIN_ADD_STOCK:${productId}` }]);
  keyboard.push([{ text: "⬅️ Back to Product", callback_data: `ADMIN_PROD:${productId}` }]);

  await editOrSendMessage(bot, chatId, messageId, text, {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleAdminAction(bot, chatId, data, store, messageId = null) {
  if (data === "ADMIN_MENU") {
    return sendAdminMenu(bot, chatId, store, messageId);
  }

  if (data === "ADMIN_CATALOG") {
    return listProductsForAdmin(bot, chatId, store, messageId);
  }

  if (data.startsWith("ADMIN_PROD:")) {
    const productId = data.split(":")[1];
    const p = await Product.findOne({ id: productId }).lean();

    const escapedName = escapeMarkdown(p.name);
    const escapedID = escapeMarkdown(p.id);
    const escapedCat = escapeMarkdown(p.categoryLabel);

    const text =
      `🛠️ *Manage Product:* ${p.emoji} ${escapedName}\n\n` +
      `🆔 ID: \`${escapedID}\`\n` +
      `💰 Price: ₹${p.price / 100}\n` +
      `📦 Stock: ${p.pool.length} coupons\n` +
      `🏷️ Category: ${escapedCat}\n` +
      `🔄 Status: ${p.active ? "✅ Active" : "❌ Hidden"}\n\n` +
      `Choose an action:`;

    await editOrSendMessage(bot, chatId, messageId, text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Add Stock", callback_data: `ADMIN_ADD_STOCK:${p.id}` },
            { text: "🔢 View Pool", callback_data: `ADMIN_VIEW_POOL:${p.id}` },
          ],
          [
            { text: p.active ? "🙈 Hide" : "👁️ Show", callback_data: `ADMIN_TOGGLE:${p.id}` },
            { text: "✏️ Edit Price", callback_data: `ADMIN_EDIT_PRICE:${p.id}` },
          ],
          [
            { text: "📝 Edit Name", callback_data: `ADMIN_EDIT_NAME:${p.id}` },
            { text: "🏷️ Edit Cat", callback_data: `ADMIN_EDIT_CAT:${p.id}` },
          ],
          [{ text: "⬅️ Back to Catalog", callback_data: "ADMIN_CATALOG" }],
        ],
      },
    });
  }

  if (data.startsWith("ADMIN_VIEW_POOL:")) {
    return listCouponsForProduct(bot, chatId, data.split(":")[1], store, messageId);
  }

  if (data.startsWith("ADMIN_DEL_C:")) {
    const [, productId, coupon] = data.split(":");
    await store.deleteCoupon(productId, coupon);
    return listCouponsForProduct(bot, chatId, productId, store, messageId);
  }

  if (data.startsWith("ADMIN_TOGGLE:")) {
    const productId = data.split(":")[1];
    const p = await Product.findOne({ id: productId });
    await store.updateProduct(productId, { active: !p.active });
    return handleAdminAction(bot, chatId, `ADMIN_PROD:${productId}`, store, messageId);
  }

  if (data.startsWith("ADMIN_ORDERS:")) {
    const skip = parseInt(data.split(":")[1] || "0");
    const { orders, total } = await getOrdersPaginated(skip);

    let text = `📜 *Recent Orders (${skip + 1}-${Math.min(skip + 10, total)} of ${total})*\n\n`;
    orders.forEach(o => {
      text += `• \`${o.orderId}\` | ${o.status.toUpperCase()} | ${o.utrNumber || 'No UTR'}\n`;
    });

    const keyboard = [];
    if (skip + 10 < total) keyboard.push([{ text: "Next ➡️", callback_data: `ADMIN_ORDERS:${skip + 10}` }]);
    if (skip > 0) keyboard.push([{ text: "⬅️ Previous", callback_data: `ADMIN_ORDERS:${skip - 10}` }]);
    keyboard.push([{ text: "⬅️ Back to Menu", callback_data: "ADMIN_MENU" }]);

    await editOrSendMessage(bot, chatId, messageId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

async function getOrdersPaginated(skip = 0, limit = 10) {
  const [orders, total] = await Promise.all([
    Order.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments()
  ]);
  return { orders, total };
}

module.exports = {
  sendAdminMenu,
  showStats,
  listProductsForAdmin,
  handleAdminApproval,
  handleAdminRejection,
  handleAdminAction,
};

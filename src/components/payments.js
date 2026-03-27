const config = require("../../config");

/**
 * Handle Buy Product flow (Manual UPI instructions)
 */
async function handleBuyProduct(bot, chatId, productId, store, formatPrice) {
  const product = await store.getProduct(productId);
  const quantity = 1;

  if (!product) {
    return bot.sendMessage(chatId, "❌ Product not found. Please try again.");
  }

  if (product.pool.length < 1) {
    return bot.sendMessage(
      chatId,
      `😔 Sorry! *${product.name}* is currently out of stock.\n\n` +
      `Please check back later or choose another product.`,
      { parse_mode: "Markdown" }
    );
  }

  if (await store.hasPendingOrder(chatId, productId)) {
    return bot.sendMessage(
      chatId,
      `⚠️ You already have a *pending payment* for *${product.name}*.\n\n` +
      `Please complete or wait for it to expire before purchasing again.`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    const order = await store.createOrder({
      userId: chatId,
      productId: product.id,
      quantity: 1,
    });

    const fs = require('fs');
    const path = require('path');

    // Path to the static QR code in the root folder
    const qrPath = path.join(__dirname, '..', '..', 'qr_code.jpeg');

    const payText =
      `🛒 *Order Created*\n\n` +
      `📦 *Coupon:* ${product.name}\n` +
      `💰 *Amount:* ${formatPrice(product.price)}\n\n` +

      `🔖 *Order Number:* \`${order.orderId}\`\n\n` +

      `💡 *Instructions:*\n` +
      `1. Scan the QR code above.\n` +
      `2. Pay the exact amount.\n` +
      `3. Copy the 12-digit **UTR Number** from your banking app.\n` +
      `4. Click the button below to submit your UTR.\n\n` +
      `After payment click **Enter UTR Number**`;

    // Create a readable stream for the local photo
    await bot.sendPhoto(chatId, fs.createReadStream(qrPath), {
      caption: payText,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Enter UTR Number", callback_data: `ENTER_UTR:${order.orderId}` }],
          [{ text: "❌ Cancel", callback_data: `CANCEL:${order.orderId}` }],
        ],
      },
    });
  } catch (err) {
    console.error("[BUY ERROR]", err.message || err);
    throw err;
  }
}

module.exports = {
  handleBuyProduct,
};

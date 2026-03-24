/**
 * My Orders
 */
async function sendMyOrders(bot, chatId, store, mainMenuKeyboard, formatPrice, statusBadge) {
  const userOrders = await store.getUserOrders(chatId);

  if (!userOrders.length) {
    return bot.sendMessage(
      chatId,
      `📦 *My Orders*\n\n` +
      `You haven't placed any orders yet.\n\n` +
      `Tap 🛒 *Browse Coupons* to explore deals!`,
      { parse_mode: "Markdown", ...mainMenuKeyboard() }
    );
  }

  const lines = [`📦 *Your Orders* (${userOrders.length} total)\n`];

  const displayOrders = userOrders.slice(0, 5);
  for (let i = 0; i < displayOrders.length; i++) {
    const order = displayOrders[i];
    const product = await store.getProduct(order.productId);
    const productName = product ? product.name : order.productId;
    const date = new Date(order.createdAt).toLocaleDateString("en-IN");

    const quantity = order.quantity || 1;
    const couponsText = order.coupons && order.coupons.length > 0 
      ? `   🎁 Coupons:\n   ${order.coupons.map(c => `\`${c}\``).join("\n   ")}\n` 
      : "";

    lines.push(
      `*${i + 1}. ${productName} (x${quantity})*\n` +
      `   📅 ${date}   ${statusBadge(order.status)}\n` +
      couponsText +
      `   🔖 \`${order.orderId}\``
    );
  }

  if (userOrders.length > 5) {
    lines.push(`\n_Showing latest 5 of ${userOrders.length} orders._`);
  }

  await bot.sendMessage(chatId, lines.join("\n\n"), {
    parse_mode: "Markdown",
    ...mainMenuKeyboard(),
  });
}

module.exports = {
  sendMyOrders,
};

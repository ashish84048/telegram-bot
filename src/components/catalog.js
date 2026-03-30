const { escapeMarkdown } = require("../utils/helpers");

/**
 * Category Menu
 */
async function sendCategoryMenu(bot, chatId, store, utils, components, editMessageId = null) {
  const catalog = await store.getCatalog();

  const buttons = Object.entries(catalog).map(([key, cat]) => [
    {
      text: `${cat.label} (${cat.products.length} deals)`,
      callback_data: `CAT:${key}`,
    },
  ]);

  const opts = {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  };

  const text =
    `🛒 *Browse Our Coupon Catalog*\n\n` +
    `Select a category to see available deals:\n`;

  if (editMessageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: editMessageId,
      ...opts,
    });
  } else {
    await bot.sendMessage(chatId, text, opts);
  }
}

/**
 * Product List
 */
async function sendProductList(bot, chatId, categoryKey, store, utils, components, editMessageId = null) {
  const catalog = await store.getCatalog();
  const category = catalog[categoryKey];

  const { formatPrice } = utils;

  if (!category) {
    return bot.sendMessage(chatId, "❌ Category not found.");
  }

  const lines = [`${category.label} *Deals*\n`];
  const buttons = [];

  for (const product of category.products) {
    const available = product.pool.length;
    const stockLabel =
      available === 0
        ? "❌ Sold Out"
        : available <= 2
          ? `⚠️ Only ${available} left!`
          : `✅ ${available} in stock`;

    lines.push(
      `${product.emoji} *${escapeMarkdown(product.description || '')}*\n` +
      `   💰 Price: ${formatPrice(product.price)}   ${stockLabel}\n\n`
    );

    buttons.push([
      {
        text: available === 0
          ? "❌ Sold Out"
          : `🛍️ Buy ${product.name}`,
        callback_data: available === 0 ? "NOOP" : `BUY:${product.id}`,
      },
    ]);
  }

  buttons.push([{ text: "⬅️ Back to Categories", callback_data: "BACK_CATALOG" }]);

  const text = lines.join("\n");
  const opts = {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: buttons },
  };

  if (editMessageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: editMessageId,
      ...opts,
    });
  } else {
    await bot.sendMessage(chatId, text, opts);
  }
}

module.exports = {
  sendCategoryMenu,
  sendProductList,
};

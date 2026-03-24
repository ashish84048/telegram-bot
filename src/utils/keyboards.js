/**
 * Telegram Keyboards
 */

function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["🛒 Browse Coupons", "📦 My Orders"],
        ["💬 Support", "❓ Help"],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
}

module.exports = {
  mainMenuKeyboard,
};

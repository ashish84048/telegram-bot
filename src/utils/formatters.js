/**
 * Currency and Status Badge formatting
 */

function formatPrice(paise) {
  return `₹${paise / 100}`;
}

function statusBadge(status) {
  const badges = {
    pending: "🕐 Pending Payment",
    verification: "⏳ Verification Pending",
    paid: "✅ Paid",
    delivered: "🎁 Delivered",
    failed: "❌ Failed",
  };
  return badges[status] || status;
}

module.exports = {
  formatPrice,
  statusBadge,
};

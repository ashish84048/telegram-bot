const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    productId: { type: String, required: true },
    utrNumber: { type: String, default: null, unique: true, sparse: true },
    status: {
      type: String,
      enum: ["pending", "verification", "paid", "delivered", "failed"],
      default: "pending",
    },
    quantity: { type: Number, default: 1 },
    totalPrice: { type: Number, required: true },
    coupons: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Fast lookups
orderSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Order", orderSchema);

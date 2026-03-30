/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           🗄️  GOLU OFFERS — MONGODB CONNECTION           ║
 * ╚══════════════════════════════════════════════════════════╝
 */

const mongoose = require("mongoose");
const dns = require("dns");

// Force usage of Google's DNS servers locally to resolve SRV record issues
if (process.env.NODE_ENV !== "production") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

let isConnected = false;

async function connect() {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in environment variables");

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    console.log("✅ MongoDB connected successfully");

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB disconnected");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
      isConnected = true;
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

module.exports = { connect };

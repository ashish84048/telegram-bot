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
  if (!uri) {
    console.error("❌ MONGODB_URI is not set in environment variables");
    process.exit(1);
  }

  try {
    // Optimized connection options for cloud deployment
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000, // 15 seconds
      heartbeatFrequencyMS: 10000,    // 10 seconds
      socketTimeoutMS: 45000,         // 45 seconds
    });

    isConnected = true;
    console.log("✅ MongoDB connected successfully");

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB error:", err.message);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB disconnected. Attempting to reconnect...");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
      isConnected = true;
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    // On Render, we want to fail fast so the service can restart
    process.exit(1);
  }
}


module.exports = { connect };

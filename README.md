# 🏪 Golu Offers — Telegram Coupon Store

India's #1 digital coupon marketplace, powered by a Telegram Bot and a professional Admin Dashboard. Built with Node.js and MongoDB.

## ✨ Features

- **Telegram Bot**: Full catalog browsing, manual UPI payment verification (via UTR), and auto coupon delivery.
- **Admin Dashboard**: Real-time stats (revenue, orders, stock), inventory management, and order verification.
- **Persistent Database**: Powered by MongoDB Atlas for order and user tracking.
- **Manual Verification**: Simple, secure flow for startups without payment gateways.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js v16+
- MongoDB Atlas (or local MongoDB)
- Telegram Bot Token (from @BotFather)

### 2. Setup
Clone the repo and install dependencies:
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file (see `.env.example`):
```env
BOT_TOKEN=your_telegram_bot_token
UPI_ID=ashish@paytm
ADMIN_CHAT_ID=@your_admin_username
MONGODB_URI=your_mongodb_atlas_uri
DASHBOARD_SECRET=your_admin_password
```

### 4. Run
Start both the bot and the dashboard with one command:
```bash
npm start
```

---

## 📊 Administration
Access the dashboard at `http://localhost:3000/dashboard.html` using your `DASHBOARD_SECRET`.
Admin will receive payment verification requests in their Telegram chat.

---

## 🛠️ Tech Stack
- **Bot**: `node-telegram-bot-api`
- **Database**: `MongoDB` + `Mongoose`
- **Payments**: `Manual UPI Verification (UTR)`
- **Server**: `Express.js`
- **Frontend**: `Vanilla JS` + `CSS3` (Inter Font)

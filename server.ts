import express from "express";
import path from "path";
import 'dotenv/config'; // Load .env
import { setupBot } from "./src/backend/bot";
import { db } from "./src/backend/db/firestore";
import { qdrant } from "./src/backend/db/qdrant";
import { storage } from "./src/backend/storage";
import { initTestData } from "./src/backend/initData";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Initialize DB & Storage connections (imports already initialize them if env is present)
  if (db) console.log('Firestore connected');
  if (qdrant) {
    console.log('Qdrant connected');
    await initTestData();
  }
  if (storage) console.log('Storage connected');

  // Initialize Telegram Bot
  const bot = setupBot();

  // Middleware to parse JSON
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/env", (req, res) => {
    res.json({ node_env: process.env.NODE_ENV, appUrl: process.env.APP_URL });
  });

  // Telegram webhook route
  const webhookPath = `/api/bot-webhook`;
  app.post(webhookPath, (req, res) => {
    if (bot) {
      bot.handleUpdate(req.body, res);
    } else {
      res.sendStatus(500);
    }
  });

  // Vite middleware for development (React Frontend if any)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production frontend serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Graceful stop
  process.once('SIGINT', () => {
    if (bot) {
      try {
        bot.stop('SIGINT');
      } catch (e: any) {
        console.log('Bot stopped (SIGINT):', e.message);
      }
    }
  })
  process.once('SIGTERM', () => {
    if (bot && typeof bot.stop === 'function') {
      try {
        bot.stop('SIGTERM');
      } catch (e: any) {
        console.log('Bot stopped (SIGTERM):', e.message);
      }
    }
  })

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();

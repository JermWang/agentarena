import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "./config.js";
import { setupWebSocket } from "./api/ws.js";
import { createRouter } from "./api/routes.js";
import { createChainRouter } from "./chain/routes.js";
import { createSkillsRouter } from "./api/skills-md.js";
import { startDepositWatcher } from "./chain/deposit-watcher.js";
import { generalLimiter } from "./middleware/rate-limit.js";
import { BotWorker } from "./bots/index.js";

const app = express();
const server = createServer(app);

// Render/production runs behind a reverse proxy; trust X-Forwarded-* for client IP.
app.set("trust proxy", 1);

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());
app.use("/api/v1", generalLimiter);

const { pit, fightManager, betManager, broadcastToFight } = setupWebSocket(server);
const router = createRouter({ pit, fightManager, betManager });
app.use("/api/v1", router);
app.use("/api/v1", createChainRouter());
app.use("/api/v1", createSkillsRouter());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

server.listen(config.port, async () => {
  console.log(`Arena server running on port ${config.port}`);

  // Start deposit watcher if configured
  if (config.masterDepositAddress) {
    startDepositWatcher();
    console.log(`Deposit watcher started (${config.arenaTokenMint ? "SPL token" : "native SOL"} mode)`);
  }

  // Start bot worker if enabled
  if (config.botWorker.enabled) {
    const botWorker = new BotWorker();
    await botWorker.start();
  }
});

export { app };

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { createRouter } from "./api/routes.js";
import { setupWebSocket } from "./api/ws.js";
import { Lobby } from "./state/lobby.js";

const PORT = parseInt(process.env.PORT ?? "3001");
const app = express();
const server = createServer(app);

app.use(cors({ origin: ["http://localhost:3000", "http://localhost:3001"] }));
app.use(express.json());

const lobby = new Lobby();
const router = createRouter(lobby);
app.use("/api/v1", router);

const { broadcast, broadcastToFight } = setupWebSocket(server, lobby);

// Wire up the fight update callback to broadcast to spectators
lobby.onFightUpdate = (fightId: string, state: any) => {
  broadcastToFight(fightId, 'fight_update', state);
};

app.get("/health", (_req, res) => res.json({ status: "ok" }));

server.listen(PORT, () => {
  console.log(`Arena server running on port ${PORT}`);
});

export { app, lobby };

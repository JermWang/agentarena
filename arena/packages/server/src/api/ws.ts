import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { Lobby } from "../state/lobby.js";

interface WsClient {
  ws: WebSocket;
  agentId?: string;
  spectating?: string;
}

export function setupWebSocket(server: Server, _lobby: Lobby) {
  const wss = new WebSocketServer({ server, path: "/ws/arena" });
  const clients = new Set<WsClient>();

  function broadcast(event: string, data: unknown) {
    const msg = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  function broadcastToFight(fightId: string, event: string, data: unknown) {
    const msg = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN && client.spectating === fightId) {
        client.ws.send(msg);
      }
    }
  }

  wss.on("connection", (ws) => {
    const client: WsClient = { ws };
    clients.add(client);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case "identify":
            client.agentId = msg.agent_id;
            break;
          case "spectate":
            client.spectating = msg.fight_id;
            break;
          case "chat":
            broadcast("chat", { agent_id: client.agentId ?? "anon", message: msg.message });
            break;
        }
      } catch {
        ws.send(JSON.stringify({ event: "error", data: "Invalid message" }));
      }
    });

    ws.on("close", () => clients.delete(client));
  });

  return { broadcast, broadcastToFight };
}

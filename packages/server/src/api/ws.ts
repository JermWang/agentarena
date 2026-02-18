import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { nanoid } from "nanoid";
import bcrypt from "bcrypt";
import { z } from "zod";
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { prisma } from "../db/client.js";
import { Pit, type PitAgent } from "../state/pit.js";
import { Matchmaker } from "../state/matchmaker.js";
import { FightManager } from "../state/fight-manager.js";
import { BetManager } from "../state/bet-manager.js";
import { ACTIONS } from "../combat/actions.js";
import { isBlockedUsername } from "../middleware/validate.js";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{1,15}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEARTBEAT_INTERVAL = 30_000;
const API_KEY_SCAN_BATCH_SIZE = 500;

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Verify a Solana wallet signature (ed25519)
 */
function verifySolanaSignature(walletAddress: string, message: string, signature: string): boolean {
  try {
    const pubkey = new PublicKey(walletAddress);
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signature);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes());
  } catch {
    return false;
  }
}

// --- Zod schemas for incoming WS messages ---
const RegisterMsg = z.object({
  type: z.literal("register"),
  name: z.string().min(1).max(15).regex(USERNAME_REGEX, "Username must be 1-15 chars, alphanumeric + underscore"),
  character: z.enum(["ronin", "knight", "cyborg", "demon", "phantom"]).default("ronin"),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX).optional(),
  signature: z.string().min(1).optional(),
});

const AuthMsg = z.object({
  type: z.literal("auth"),
  api_key: z.string().min(1),
});

const ChatMsg = z.object({
  type: z.literal("pit_chat"),
  message: z.string().min(1).max(280),
});

const CalloutMsg = z.object({
  type: z.literal("callout"),
  target: z.string().min(1).max(15),
  wager: z.number().min(50000),
  message: z.string().max(280).default(""),
});

const CalloutResponseMsg = z.object({
  type: z.enum(["callout_accept", "callout_decline"]),
  callout_id: z.string(),
});

const ActionMsg = z.object({
  type: z.literal("action"),
  fight_id: z.string(),
  action: z.enum(ACTIONS),
});

const SpectateMsg = z.object({
  type: z.literal("spectate"),
  fight_id: z.string().optional(),
});

// --- Client tracking ---
interface WsClient {
  ws: WebSocket;
  agentId?: string;
  spectating?: string;
  isAlive: boolean;
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws/arena" });
  const clients = new Set<WsClient>();
  const pit = new Pit();
  const matchmaker = new Matchmaker();
  const fightManager = new FightManager();
  const betManager = new BetManager();

  async function findAgentByApiKey(apiKey: string) {
    const digest = hashApiKey(apiKey);
    const digestMatch = await prisma.agent.findFirst({ where: { apiKeyDigest: digest } });
    if (digestMatch && await bcrypt.compare(apiKey, digestMatch.apiKeyHash)) {
      return digestMatch;
    }

    let cursor: string | undefined;
    while (true) {
      const agents = await prisma.agent.findMany({
        take: API_KEY_SCAN_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (agents.length === 0) break;

      for (const agent of agents) {
        if (await bcrypt.compare(apiKey, agent.apiKeyHash)) {
          if (agent.apiKeyDigest !== digest) {
            void prisma.agent.update({
              where: { id: agent.id },
              data: { apiKeyDigest: digest },
            }).catch(() => {});
          }
          return agent;
        }
      }

      cursor = agents[agents.length - 1].id;
    }

    return null;
  }

  // --- Helper: send JSON to a WebSocket ---
  function send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // --- Helper: broadcast to all fight spectators ---
  function broadcastToFight(fightId: string, event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN && client.spectating === fightId) {
        client.ws.send(msg);
      }
    }
  }

  // --- Helper: broadcast to all connected clients ---
  function broadcastToAll(event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
    }
  }

  // --- Helper: send exchange_request to both agents in a fight ---
  function sendExchangeRequests(fightId: string): void {
    const state = fightManager.getFightState(fightId);
    const active = fightManager.activeFights.get(fightId);
    if (!state || !active || state.status !== "waiting_for_actions") return;

    const makeRequest = (isP1: boolean) => ({
      type: "exchange_request",
      fight_id: fightId,
      your_hp: isP1 ? state.p1.hp : state.p2.hp,
      your_stamina: isP1 ? state.p1.stamina : state.p2.stamina,
      opponent_hp: isP1 ? state.p2.hp : state.p1.hp,
      opponent_stamina: isP1 ? state.p2.stamina : state.p1.stamina,
      round: state.round,
      exchange: state.exchange,
      round_wins: isP1 ? state.p1.roundWins : state.p2.roundWins,
      opponent_round_wins: isP1 ? state.p2.roundWins : state.p1.roundWins,
      last_result: state.lastResult,
      timeout_ms: 5000,
    });

    pit.sendToAgent(active.agent1Id, makeRequest(true));
    pit.sendToAgent(active.agent2Id, makeRequest(false));
  }

  // --- Helper: start a fight between two agents ---
  async function startFight(agent1Id: string, agent2Id: string, wager: number): Promise<void> {
    const fightId = nanoid();

    // Persist first so in-memory fights never reference missing DB rows.
    try {
      await prisma.fight.create({
        data: { id: fightId, agent1Id, agent2Id, wagerAmount: wager, status: "active" },
      });
    } catch (e) {
      console.error("Failed to persist fight:", e);
      return;
    }

    fightManager.createFight(fightId, agent1Id, agent2Id, wager);

    // Get agent usernames for display
    const a1 = pit.agents.get(agent1Id);
    const a2 = pit.agents.get(agent2Id);
    const fightStartMsg = {
      type: "fight_start",
      fight_id: fightId,
      round: 1,
      state: fightManager.getFightState(fightId),
    };

    pit.sendToAgent(agent1Id, { ...fightStartMsg, opponent: a2?.username ?? agent2Id });
    pit.sendToAgent(agent2Id, { ...fightStartMsg, opponent: a1?.username ?? agent1Id });

    // Broadcast to spectators
    broadcastToAll("fight_starting", {
      fight_id: fightId,
      agent1: a1?.username ?? agent1Id,
      agent2: a2?.username ?? agent2Id,
      wager,
    });

    // Log to DB
    prisma.pitLog.create({
      data: {
        type: "fight_start",
        fromUsername: a1?.username ?? agent1Id,
        toUsername: a2?.username ?? agent2Id,
        wager: Math.round(wager),
        fightId,
        message: `${a1?.username ?? agent1Id} vs ${a2?.username ?? agent2Id}`,
      },
    }).catch((e) => console.error("[PitLog] fight_start write failed:", e));

    // Send first exchange request
    sendExchangeRequests(fightId);
  }

  // --- Wire up matchmaker ---
  matchmaker.onMatchFound = (agent1Id, agent2Id) => {
    startFight(agent1Id, agent2Id, 0);
  };

  // --- Wire up fight manager events ---
  fightManager.onFightUpdate = (fightId, state) => {
    broadcastToFight(fightId, "fight_update", state);
  };

  fightManager.onExchangeReady = (fightId) => {
    sendExchangeRequests(fightId);
  };

  fightManager.onRoundEnd = async (fightId, state) => {
    const active = fightManager.activeFights.get(fightId);
    if (!active) return;

    // Filter history entries for this round
    const roundExchanges = state.history.filter((h) => h.round === state.round);
    const roundWinner = state.p1.hp <= 0 ? active.agent2Id : state.p2.hp <= 0 ? active.agent1Id : null;

    try {
      const exists = await prisma.fight.findUnique({
        where: { id: fightId },
        select: { id: true },
      });
      if (!exists) {
        // Can happen after admin resets while process still has in-memory fights.
        return;
      }
      await prisma.fightRound.create({
        data: {
          fightId,
          round: state.round,
          exchanges: roundExchanges as any,
          p1Hp: state.p1.hp,
          p2Hp: state.p2.hp,
          winnerId: roundWinner,
        },
      });
    } catch (e) {
      console.error("Failed to persist round:", e);
    }
  };

  fightManager.onFightEnd = async (fightId, winnerId, state) => {
    const active = fightManager.activeFights.get(fightId);
    if (!active) return;

    // Persist fight result
    try {
      await prisma.$transaction(async (tx) => {
        await tx.fight.update({
          where: { id: fightId },
          data: { winnerId, status: "completed", completedAt: new Date() },
        });
        if (winnerId) {
          const loserId = winnerId === active.agent1Id ? active.agent2Id : active.agent1Id;
          await tx.agent.update({ where: { id: winnerId }, data: { wins: { increment: 1 }, elo: { increment: 25 } } });
          await tx.agent.update({ where: { id: loserId }, data: { losses: { increment: 1 }, elo: { decrement: 25 } } });
        }
      });
    } catch (e) {
      console.error("Failed to persist fight result:", e);
    }

    // Resolve side bets
    try {
      await betManager.resolveBets(fightId, winnerId);
    } catch (e) {
      console.error("Failed to resolve bets:", e);
    }

    // Notify agents
    const endMsg = { type: "fight_end", fight_id: fightId, winner: winnerId, state };
    pit.sendToAgent(active.agent1Id, endMsg);
    pit.sendToAgent(active.agent2Id, endMsg);

    // Log to DB
    const winnerAgent = winnerId ? pit.agents.get(winnerId) : null;
    const a1 = pit.agents.get(active.agent1Id);
    const a2 = pit.agents.get(active.agent2Id);
    prisma.pitLog.create({
      data: {
        type: "fight_end",
        fromUsername: a1?.username ?? active.agent1Id,
        toUsername: a2?.username ?? active.agent2Id,
        fightId,
        message: winnerId
          ? `${winnerAgent?.username ?? winnerId} defeated ${winnerId === active.agent1Id ? (a2?.username ?? active.agent2Id) : (a1?.username ?? active.agent1Id)}`
          : `Draw between ${a1?.username ?? active.agent1Id} and ${a2?.username ?? active.agent2Id}`,
      },
    }).catch((e) => console.error("[PitLog] fight_end write failed:", e));
  };

  // --- Wire up Pit broadcast to spectator clients ---
  pit.onPitBroadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN && !client.agentId) {
        // Send pit events to non-agent clients (spectators)
        client.ws.send(data);
      }
    }
  };

  // --- Heartbeat ---
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(client);
        if (client.agentId) {
          pit.leave(client.agentId);
          matchmaker.dequeue(client.agentId);
        }
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
    pit.cleanExpired();
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => clearInterval(heartbeat));

  // --- Connection handler ---
  wss.on("connection", (ws) => {
    const client: WsClient = { ws, isAlive: true };
    clients.add(client);

    // Give new connections an immediate pit snapshot so spectators who join
    // mid-session don't miss currently-online agents.
    send(ws, { event: "pit_agents", data: pit.getAgentsList() });

    ws.on("pong", () => { client.isAlive = true; });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          // --- REGISTER: create new agent, get API key ---
          case "register": {
            const data = RegisterMsg.parse(msg);
            if (isBlockedUsername(data.name)) {
              send(ws, { type: "error", error: "Username not allowed" });
              return;
            }
            const existing = await prisma.agent.findUnique({ where: { username: data.name } });
            if (existing) {
              send(ws, { type: "error", error: "Username taken" });
              return;
            }

            // Determine owner wallet — verify signature if provided
            let ownerWallet = "pending";
            if (data.wallet_address && data.signature) {
              try {
                const message = `I own agent ${data.name} on Agent Battle Arena`;
                const valid = verifySolanaSignature(data.wallet_address, message, data.signature);
                if (valid) {
                  await prisma.user.upsert({
                    where: { walletAddress: data.wallet_address },
                    create: { walletAddress: data.wallet_address },
                    update: {},
                  });
                  ownerWallet = data.wallet_address;
                }
              } catch {
                // Signature verification failed — fall back to "pending"
              }
            }

            const apiKey = `sk_${nanoid(32)}`;
            const apiKeyHash = await bcrypt.hash(apiKey, 10);
            const apiKeyDigest = hashApiKey(apiKey);

            // Keep registration claim-later friendly: ensure owner wallet exists,
            // including the "pending" placeholder used before users claim ownership.
            await prisma.user.upsert({
              where: { walletAddress: ownerWallet },
              create: { walletAddress: ownerWallet },
              update: {},
            });

            const agent = await prisma.agent.create({
              data: {
                username: data.name,
                characterId: data.character,
                apiKeyHash,
                apiKeyDigest,
                ownerWallet,
              },
            });
            send(ws, {
              type: "registered",
              api_key: apiKey,
              agent_id: agent.id,
              username: data.name,
              wallet_linked: ownerWallet !== "pending",
            });
            break;
          }

          // --- AUTH: authenticate with API key, join The Pit ---
          case "auth": {
            const data = AuthMsg.parse(msg);
            const authedAgent = await findAgentByApiKey(data.api_key);
            if (!authedAgent) {
              send(ws, { type: "error", error: "Invalid API key" });
              return;
            }
            client.agentId = authedAgent.id;
            pit.join({
              ws,
              agentId: authedAgent.id,
              username: authedAgent.username,
              characterId: authedAgent.characterId,
              elo: authedAgent.elo,
              wins: authedAgent.wins,
              losses: authedAgent.losses,
              isDemo: authedAgent.isDemo,
            });
            send(ws, {
              type: "authenticated",
              agent: {
                id: authedAgent.id,
                username: authedAgent.username,
                character: authedAgent.characterId,
                elo: authedAgent.elo,
                wins: authedAgent.wins,
                losses: authedAgent.losses,
              },
              pit_agents: pit.getAgentsList(),
            });
            break;
          }

          // --- PIT CHAT ---
          case "pit_chat": {
            if (!client.agentId) { send(ws, { type: "error", error: "Not authenticated" }); return; }
            const data = ChatMsg.parse(msg);
            const result = pit.chat(client.agentId, data.message);
            if (!result.ok) send(ws, { type: "error", error: result.error });
            break;
          }

          // --- CALLOUT ---
          case "callout": {
            if (!client.agentId) { send(ws, { type: "error", error: "Not authenticated" }); return; }
            const data = CalloutMsg.parse(msg);
            const result = pit.createCallout(client.agentId, data.target, data.wager, data.message);
            if (!result.ok) send(ws, { type: "error", error: result.error });
            break;
          }

          // --- CALLOUT ACCEPT/DECLINE ---
          case "callout_accept": {
            if (!client.agentId) { send(ws, { type: "error", error: "Not authenticated" }); return; }
            const data = CalloutResponseMsg.parse(msg);
            const result = pit.acceptCallout(data.callout_id, client.agentId);
            if (result.ok && result.callout) {
              await startFight(result.callout.fromAgentId, result.callout.targetAgentId, result.callout.wager);
            } else {
              send(ws, { type: "error", error: result.error });
            }
            break;
          }

          case "callout_decline": {
            if (!client.agentId) { send(ws, { type: "error", error: "Not authenticated" }); return; }
            const data = CalloutResponseMsg.parse(msg);
            const result = pit.declineCallout(data.callout_id, client.agentId);
            if (!result.ok) send(ws, { type: "error", error: result.error });
            break;
          }

          // --- QUEUE: auto-match ---
          case "queue": {
            if (!client.agentId) { send(ws, { type: "error", error: "Not authenticated" }); return; }
            const agent = pit.agents.get(client.agentId);
            if (!agent) { send(ws, { type: "error", error: "Not in The Pit" }); return; }
            matchmaker.enqueue({
              agentId: client.agentId,
              username: agent.username,
              elo: agent.elo,
              joinedAt: Date.now(),
              isDemo: agent.isDemo,
            });
            send(ws, { type: "queued", queue_size: matchmaker.getQueueSize(agent.isDemo) });
            break;
          }

          // --- FIGHT ACTION ---
          case "action": {
            if (!client.agentId) { send(ws, { type: "error", error: "Not authenticated" }); return; }
            const data = ActionMsg.parse(msg);
            fightManager.submitAction(data.fight_id, client.agentId, data.action);
            break;
          }

          // --- SPECTATE: subscribe to fight updates ---
          case "spectate": {
            const data = SpectateMsg.parse(msg);
            client.spectating = data.fight_id ?? undefined;
            if (data.fight_id) {
              const state = fightManager.getFightState(data.fight_id);
              if (state) send(ws, { event: "fight_update", data: state });
            }
            break;
          }

          default:
            send(ws, { type: "error", error: `Unknown message type: ${msg.type}` });
        }
      } catch (e: any) {
        send(ws, { type: "error", error: e.message ?? "Invalid message" });
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      if (client.agentId) {
        pit.leave(client.agentId);
        matchmaker.dequeue(client.agentId);
      }
    });
  });

  return { pit, matchmaker, fightManager, betManager, broadcastToFight, broadcastToAll };
}

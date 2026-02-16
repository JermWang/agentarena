# Arena Production Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Arena from in-memory MVP to full production with $NORTH token betting on Base chain, user-submitted AI agents via WebSocket, and The Pit pre-fight lobby.

**Architecture:** Server-custodial settlement — users deposit $NORTH ERC-20 tokens on Base to a master wallet, internal balances tracked in Postgres via Prisma, withdrawals sent from hot wallet. Agents connect via WebSocket API with API key auth. Combat engine stays as-is (tested, working). Frontend on Vercel, backend on Render.

**Tech Stack:** Next.js 16, Express, WebSocket (ws), Prisma + Postgres, viem (Base chain), Solidity (OpenZeppelin ERC-20), Zod, vitest

**Design Doc:** `docs/plans/2026-02-15-arena-production-design.md`

---

## Task 1: Update Prisma Schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

The existing schema is Agent-centric (from the old model where agents had balances). We need to add a `User` table for spectators/bettors, add `username`/`apiKeyHash`/`elo` to Agent, add a `Transaction` ledger, and update `SideBet` to reference wallet addresses instead of agent IDs.

**Step 1: Rewrite schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  walletAddress   String        @id
  balance         Decimal       @default(0) @db.Decimal(36, 18)
  totalDeposited  Decimal       @default(0) @db.Decimal(36, 18)
  totalWithdrawn  Decimal       @default(0) @db.Decimal(36, 18)
  totalWagered    Decimal       @default(0) @db.Decimal(36, 18)
  totalWon        Decimal       @default(0) @db.Decimal(36, 18)
  createdAt       DateTime      @default(now())

  agents          Agent[]
  bets            Bet[]
  transactions    Transaction[]
}

model Agent {
  id              String      @id @default(cuid())
  ownerWallet     String
  username        String      @unique
  characterId     String      @default("ronin")
  skillsMd        String      @default("")
  apiKeyHash      String
  wins            Int         @default(0)
  losses          Int         @default(0)
  elo             Int         @default(1000)
  createdAt       DateTime    @default(now())

  owner           User        @relation(fields: [ownerWallet], references: [walletAddress])
  fightsAsP1      Fight[]     @relation("FightP1")
  fightsAsP2      Fight[]     @relation("FightP2")
  fightsWon       Fight[]     @relation("FightWinner")

  @@index([username])
  @@index([elo])
}

model Fight {
  id              String      @id @default(cuid())
  agent1Id        String
  agent2Id        String
  winnerId        String?
  wagerAmount     Decimal     @default(0) @db.Decimal(36, 18)
  rakeAmount      Decimal     @default(0) @db.Decimal(36, 18)
  status          String      @default("active")
  currentRound    Int         @default(1)
  p1RoundWins     Int         @default(0)
  p2RoundWins     Int         @default(0)
  createdAt       DateTime    @default(now())
  completedAt     DateTime?

  agent1          Agent       @relation("FightP1", fields: [agent1Id], references: [id])
  agent2          Agent       @relation("FightP2", fields: [agent2Id], references: [id])
  winner          Agent?      @relation("FightWinner", fields: [winnerId], references: [id])
  rounds          FightRound[]
  bets            Bet[]
  treasury        TreasuryEntry[]
}

model FightRound {
  id              String    @id @default(cuid())
  fightId         String
  round           Int
  exchanges       Json
  p1Hp            Int
  p2Hp            Int
  winnerId        String?
  createdAt       DateTime  @default(now())

  fight           Fight     @relation(fields: [fightId], references: [id])

  @@unique([fightId, round])
}

model Bet {
  id              String    @id @default(cuid())
  fightId         String
  walletAddress   String
  backedAgentId   String
  amount          Decimal   @db.Decimal(36, 18)
  payout          Decimal?  @db.Decimal(36, 18)
  status          String    @default("active")
  createdAt       DateTime  @default(now())

  fight           Fight     @relation(fields: [fightId], references: [id])
  user            User      @relation(fields: [walletAddress], references: [walletAddress])

  @@index([fightId])
  @@index([walletAddress])
}

model Transaction {
  id              String    @id @default(cuid())
  walletAddress   String
  type            String    // deposit, withdrawal, bet, payout, rake
  amount          Decimal   @db.Decimal(36, 18)
  referenceId     String?   // fightId, betId, etc.
  txHash          String?   // on-chain tx hash for deposits/withdrawals
  createdAt       DateTime  @default(now())

  user            User      @relation(fields: [walletAddress], references: [walletAddress])

  @@index([walletAddress])
  @@index([type])
}

model TreasuryEntry {
  id              String    @id @default(cuid())
  fightId         String?
  amount          Decimal   @db.Decimal(36, 18)
  type            String    // fight_rake, bet_rake
  createdAt       DateTime  @default(now())

  fight           Fight?    @relation(fields: [fightId], references: [id])
}
```

Note: Using `Decimal(36, 18)` to match ERC-20 precision (18 decimals) with room for large token amounts (100B supply).

**Step 2: Install dependencies and generate client**

Run: `cd /home/hackerman/arena/packages/server && npm install bcrypt && npm install -D @types/bcrypt`

Then set DATABASE_URL in `.env` to a Render Postgres URL (or local Postgres for dev), then:

Run: `cd /home/hackerman/arena/packages/server && npx prisma generate`

**Step 3: Create migration**

Run: `cd /home/hackerman/arena/packages/server && npx prisma migrate dev --name production-schema`

**Step 4: Commit**

```bash
cd /home/hackerman/arena
git add packages/server/prisma/ packages/server/package.json packages/server/package-lock.json
git commit -m "feat: update Prisma schema for production (users, agents, bets, transactions)"
```

---

## Task 2: Server Environment Config + CORS

**Files:**
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/config.ts`

**Step 1: Create config.ts**

```typescript
export const config = {
  port: parseInt(process.env.PORT ?? "3001"),
  corsOrigins: process.env.CORS_ORIGINS?.split(",") ?? [
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  databaseUrl: process.env.DATABASE_URL,
  baseRpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
  northTokenAddress: process.env.NORTH_TOKEN_ADDRESS,
  hotWalletKey: process.env.HOT_WALLET_PRIVATE_KEY,
  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;
```

**Step 2: Update index.ts to use config**

Replace the hardcoded CORS array with `config.corsOrigins`. Remove the `new Lobby()` instantiation — we'll replace with DB-backed state in Task 3.

**Step 3: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/index.ts
git commit -m "feat: add server config with env vars, dynamic CORS"
```

---

## Task 3: WebSocket Rewrite — Agent Auth, The Pit, Fight Engine

This is the biggest task. The current `ws.ts` is 60 lines handling spectate/chat. We need to rewrite it to be the primary agent interface with auth, The Pit, matchmaking, and fight orchestration.

**Files:**
- Rewrite: `packages/server/src/api/ws.ts`
- Create: `packages/server/src/state/pit.ts` (The Pit lobby manager)
- Create: `packages/server/src/state/matchmaker.ts` (queue + callout matching)
- Create: `packages/server/src/state/fight-manager.ts` (replaces lobby.ts for active fights)
- Modify: `packages/server/src/state/lobby.ts` (deprecate, keep for reference)

### Step 1: Create `packages/server/src/state/pit.ts`

The Pit manages connected agents, chat, and callouts. It's the social layer.

```typescript
import { nanoid } from "nanoid";
import type { WebSocket } from "ws";

export interface PitAgent {
  ws: WebSocket;
  agentId: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
}

export interface Callout {
  id: string;
  fromUsername: string;
  fromAgentId: string;
  targetUsername: string;
  targetAgentId: string;
  wager: number;
  message: string;
  createdAt: number;
  expiresAt: number; // 60 seconds to accept
}

export class Pit {
  agents = new Map<string, PitAgent>(); // agentId -> PitAgent
  callouts = new Map<string, Callout>(); // calloutId -> Callout
  private chatRateLimit = new Map<string, number>(); // agentId -> last chat timestamp
  private calloutRateLimit = new Map<string, number>(); // agentId -> last callout timestamp

  join(agent: PitAgent): void {
    this.agents.set(agent.agentId, agent);
    this.broadcastPitEvent("agent_joined", {
      username: agent.username,
      character: agent.characterId,
      elo: agent.elo,
    });
  }

  leave(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.broadcastPitEvent("agent_left", { username: agent.username });
    }
  }

  chat(agentId: string, message: string): { ok: boolean; error?: string } {
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false, error: "Not in The Pit" };

    // Rate limit: 1 msg per 3 seconds
    const lastChat = this.chatRateLimit.get(agentId) ?? 0;
    if (Date.now() - lastChat < 3000) return { ok: false, error: "Rate limited (3s)" };
    this.chatRateLimit.set(agentId, Date.now());

    // Truncate message
    const truncated = message.slice(0, 280);

    this.broadcastToPit({
      type: "pit_message",
      from: agent.username,
      character: agent.characterId,
      message: truncated,
      timestamp: Date.now(),
    });
    return { ok: true };
  }

  createCallout(
    agentId: string,
    targetUsername: string,
    wager: number,
    message: string,
  ): { ok: boolean; callout?: Callout; error?: string } {
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false, error: "Not in The Pit" };

    // Rate limit: 1 callout per 30 seconds
    const lastCallout = this.calloutRateLimit.get(agentId) ?? 0;
    if (Date.now() - lastCallout < 30000) return { ok: false, error: "Rate limited (30s)" };

    // Find target by username
    const target = Array.from(this.agents.values()).find((a) => a.username === targetUsername);
    if (!target) return { ok: false, error: "Target not in The Pit" };
    if (target.agentId === agentId) return { ok: false, error: "Cannot callout yourself" };

    this.calloutRateLimit.set(agentId, Date.now());

    const callout: Callout = {
      id: nanoid(),
      fromUsername: agent.username,
      fromAgentId: agentId,
      targetUsername: target.username,
      targetAgentId: target.agentId,
      wager,
      message: message.slice(0, 280),
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    this.callouts.set(callout.id, callout);

    // Notify target
    this.sendToAgent(target.agentId, {
      type: "callout_received",
      callout_id: callout.id,
      from: agent.username,
      wager,
      message: callout.message,
    });

    // Broadcast to pit spectators
    this.broadcastPitEvent("callout", {
      callout_id: callout.id,
      from: agent.username,
      target: target.username,
      wager,
      message: callout.message,
    });

    return { ok: true, callout };
  }

  acceptCallout(calloutId: string, agentId: string): { ok: boolean; callout?: Callout; error?: string } {
    const callout = this.callouts.get(calloutId);
    if (!callout) return { ok: false, error: "Callout not found" };
    if (callout.targetAgentId !== agentId) return { ok: false, error: "Not your callout to accept" };
    if (Date.now() > callout.expiresAt) {
      this.callouts.delete(calloutId);
      return { ok: false, error: "Callout expired" };
    }

    this.callouts.delete(calloutId);

    this.broadcastPitEvent("callout_accepted", {
      callout_id: calloutId,
      from: callout.fromUsername,
      target: callout.targetUsername,
      wager: callout.wager,
    });

    return { ok: true, callout };
  }

  declineCallout(calloutId: string, agentId: string): { ok: boolean; error?: string } {
    const callout = this.callouts.get(calloutId);
    if (!callout) return { ok: false, error: "Callout not found" };
    if (callout.targetAgentId !== agentId) return { ok: false, error: "Not your callout" };

    this.callouts.delete(calloutId);

    this.broadcastPitEvent("callout_declined", {
      callout_id: calloutId,
      from: callout.fromUsername,
      target: callout.targetUsername,
    });

    return { ok: true };
  }

  getAgentsList(): Array<{ username: string; character: string; elo: number; wins: number; losses: number }> {
    return Array.from(this.agents.values()).map((a) => ({
      username: a.username,
      character: a.characterId,
      elo: a.elo,
      wins: a.wins,
      losses: a.losses,
    }));
  }

  sendToAgent(agentId: string, msg: unknown): void {
    const agent = this.agents.get(agentId);
    if (agent?.ws.readyState === 1) {
      agent.ws.send(JSON.stringify(msg));
    }
  }

  private broadcastToPit(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const agent of this.agents.values()) {
      if (agent.ws.readyState === 1) agent.ws.send(data);
    }
    // Also send to spectator connections (handled separately in ws.ts)
  }

  private broadcastPitEvent(event: string, data: unknown): void {
    this.broadcastToPit({ type: "pit_event", event, data });
  }

  // Spectator broadcast hook — set externally by ws.ts
  onPitBroadcast?: (msg: unknown) => void;

  cleanExpired(): void {
    for (const [id, callout] of this.callouts) {
      if (Date.now() > callout.expiresAt) this.callouts.delete(id);
    }
  }
}
```

### Step 2: Create `packages/server/src/state/matchmaker.ts`

Simple FIFO queue with optional Elo bracket matching.

```typescript
import type { PitAgent } from "./pit.js";

export interface QueueEntry {
  agentId: string;
  username: string;
  elo: number;
  joinedAt: number;
}

export class Matchmaker {
  private queue: QueueEntry[] = [];
  onMatchFound?: (agent1Id: string, agent2Id: string) => void;

  enqueue(agent: QueueEntry): void {
    // Don't double-queue
    if (this.queue.some((e) => e.agentId === agent.agentId)) return;
    this.queue.push(agent);
    this.tryMatch();
  }

  dequeue(agentId: string): void {
    this.queue = this.queue.filter((e) => e.agentId !== agentId);
  }

  private tryMatch(): void {
    if (this.queue.length < 2) return;

    // Simple: match first two in queue
    // Future: match by Elo bracket (within 200 Elo)
    const a = this.queue.shift()!;
    const b = this.queue.shift()!;
    this.onMatchFound?.(a.agentId, b.agentId);
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}
```

### Step 3: Create `packages/server/src/state/fight-manager.ts`

Manages active fights with 5-second action timeouts. Uses the existing `Fight` class from `combat/fight.ts`.

```typescript
import { Fight, type FightState } from "../combat/fight.js";
import type { Action } from "../combat/actions.js";

const ACTION_TIMEOUT_MS = 5_000;
const DEFAULT_ACTION: Action = "block_high";

export interface ActiveFight {
  fight: Fight;
  agent1Id: string;
  agent2Id: string;
  fightId: string;
  wager: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export class FightManager {
  activeFights = new Map<string, ActiveFight>();
  // agentId -> fightId (for routing WS messages)
  agentFightMap = new Map<string, string>();

  onFightUpdate?: (fightId: string, state: FightState) => void;
  onFightEnd?: (fightId: string, winnerId: string | null, state: FightState) => void;
  onRoundEnd?: (fightId: string, state: FightState) => void;

  createFight(fightId: string, agent1Id: string, agent2Id: string, wager: number): ActiveFight {
    const fight = new Fight(fightId, agent1Id, agent2Id);
    const active: ActiveFight = { fight, agent1Id, agent2Id, fightId, wager };
    this.activeFights.set(fightId, active);
    this.agentFightMap.set(agent1Id, fightId);
    this.agentFightMap.set(agent2Id, fightId);
    this.startActionTimeout(fightId);
    return active;
  }

  submitAction(fightId: string, agentId: string, action: Action): void {
    const active = this.activeFights.get(fightId);
    if (!active) return;

    try {
      const result = active.fight.submitAction(agentId, action);
      if (result !== null) {
        // Both submitted, exchange resolved
        this.clearTimeout(fightId);
        const state = active.fight.getState();

        if (state.status === "fight_over") {
          this.onFightUpdate?.(fightId, state);
          this.endFight(fightId);
        } else if (state.status === "round_over") {
          this.onFightUpdate?.(fightId, state);
          this.onRoundEnd?.(fightId, state);
          // Auto-advance to next round after a brief pause
          setTimeout(() => {
            const a = this.activeFights.get(fightId);
            if (a && a.fight.getState().status === "round_over") {
              a.fight.nextRound();
              this.onFightUpdate?.(fightId, a.fight.getState());
              this.startActionTimeout(fightId);
            }
          }, 3000);
        } else {
          this.onFightUpdate?.(fightId, state);
          this.startActionTimeout(fightId);
        }
      }
    } catch {
      // Invalid action or duplicate — ignore
    }
  }

  private startActionTimeout(fightId: string): void {
    const active = this.activeFights.get(fightId);
    if (!active) return;

    this.clearTimeout(fightId);
    active.timeoutHandle = setTimeout(() => {
      const fight = active.fight;
      const state = fight.getState();
      if (state.status !== "waiting_for_actions") return;

      // Submit default action for any agent that hasn't submitted
      // The Fight class tracks pending actions internally, so we just
      // submit for both if needed — it will throw for already-submitted
      try { fight.submitAction(active.agent1Id, DEFAULT_ACTION); } catch {}
      try { fight.submitAction(active.agent2Id, DEFAULT_ACTION); } catch {}

      // After forcing actions, check state
      const newState = fight.getState();
      if (newState.status === "fight_over") {
        this.onFightUpdate?.(fightId, newState);
        this.endFight(fightId);
      } else if (newState.status === "round_over") {
        this.onFightUpdate?.(fightId, newState);
        this.onRoundEnd?.(fightId, newState);
        setTimeout(() => {
          const a = this.activeFights.get(fightId);
          if (a && a.fight.getState().status === "round_over") {
            a.fight.nextRound();
            this.onFightUpdate?.(fightId, a.fight.getState());
            this.startActionTimeout(fightId);
          }
        }, 3000);
      } else {
        this.onFightUpdate?.(fightId, newState);
        this.startActionTimeout(fightId);
      }
    }, ACTION_TIMEOUT_MS);
  }

  private clearTimeout(fightId: string): void {
    const active = this.activeFights.get(fightId);
    if (active?.timeoutHandle) {
      clearTimeout(active.timeoutHandle);
      active.timeoutHandle = undefined;
    }
  }

  private endFight(fightId: string): void {
    const active = this.activeFights.get(fightId);
    if (!active) return;
    const winnerId = active.fight.getWinner();
    this.onFightEnd?.(fightId, winnerId, active.fight.getState());
    this.agentFightMap.delete(active.agent1Id);
    this.agentFightMap.delete(active.agent2Id);
    this.clearTimeout(fightId);
    // Keep in activeFights for a bit so spectators can see final state
    setTimeout(() => this.activeFights.delete(fightId), 30_000);
  }

  getFightForAgent(agentId: string): string | undefined {
    return this.agentFightMap.get(agentId);
  }

  getFightState(fightId: string): FightState | undefined {
    return this.activeFights.get(fightId)?.fight.getState();
  }

  getActiveFights(): Array<{ fightId: string; agent1: string; agent2: string }> {
    return Array.from(this.activeFights.values())
      .filter((a) => a.fight.getState().status !== "fight_over")
      .map((a) => ({ fightId: a.fightId, agent1: a.agent1Id, agent2: a.agent2Id }));
  }
}
```

### Step 4: Rewrite `packages/server/src/api/ws.ts`

The new WebSocket handler handles: register, auth, pit_chat, callout, callout_accept, callout_decline, queue, action, spectate. It wires up Pit, Matchmaker, and FightManager.

```typescript
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { nanoid } from "nanoid";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Pit, type PitAgent } from "../state/pit.js";
import { Matchmaker } from "../state/matchmaker.js";
import { FightManager } from "../state/fight-manager.js";
import { ACTIONS, type Action } from "../combat/actions.js";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{1,15}$/;
const HEARTBEAT_INTERVAL = 30_000;
const SIDE_BET_RAKE = 0.03;

// Zod schemas for WS messages
const RegisterMsg = z.object({
  type: z.literal("register"),
  name: z.string().min(1).max(15).regex(USERNAME_REGEX),
  character: z.enum(["ronin", "knight", "cyborg", "demon", "phantom"]).default("ronin"),
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

const CalloutAcceptMsg = z.object({
  type: z.literal("callout_accept"),
  callout_id: z.string(),
});

const CalloutDeclineMsg = z.object({
  type: z.literal("callout_decline"),
  callout_id: z.string(),
});

const QueueMsg = z.object({ type: z.literal("queue") });

const ActionMsg = z.object({
  type: z.literal("action"),
  fight_id: z.string(),
  action: z.enum(ACTIONS),
});

const SpectateMsg = z.object({
  type: z.literal("spectate"),
  fight_id: z.string().optional(),
});

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

  // Wire up matchmaker -> fight creation
  matchmaker.onMatchFound = async (agent1Id, agent2Id) => {
    const fightId = nanoid();
    const active = fightManager.createFight(fightId, agent1Id, agent2Id, 0);

    // Save fight to DB
    try {
      await prisma.fight.create({
        data: { id: fightId, agent1Id, agent2Id, status: "active" },
      });
    } catch {}

    // Notify both agents
    const agent1 = pit.agents.get(agent1Id);
    const agent2 = pit.agents.get(agent2Id);
    const fightStart = (agentId: string, opponentName: string) => ({
      type: "fight_start",
      fight_id: fightId,
      opponent: opponentName,
      round: 1,
      state: fightManager.getFightState(fightId),
    });

    if (agent1) pit.sendToAgent(agent1Id, fightStart(agent1Id, agent2?.username ?? agent2Id));
    if (agent2) pit.sendToAgent(agent2Id, fightStart(agent2Id, agent1?.username ?? agent1Id));

    // Broadcast to spectators
    broadcastToSpectators("fight_starting", { fight_id: fightId, agent1: agent1?.username, agent2: agent2?.username });

    // Send first exchange request
    sendExchangeRequest(fightId);
  };

  // Wire up fight events
  fightManager.onFightUpdate = (fightId, state) => {
    broadcastToFight(fightId, "fight_update", state);
    // Also send to the two agents
    const active = fightManager.activeFights.get(fightId);
    if (active) {
      sendFightStateToAgent(active.agent1Id, fightId, state);
      sendFightStateToAgent(active.agent2Id, fightId, state);
    }
  };

  fightManager.onFightEnd = async (fightId, winnerId, state) => {
    // Persist fight result to DB
    try {
      const active = fightManager.activeFights.get(fightId);
      if (!active) return;

      await prisma.$transaction(async (tx) => {
        // Update fight record
        await tx.fight.update({
          where: { id: fightId },
          data: { winnerId, status: "completed", completedAt: new Date() },
        });

        // Update agent stats
        if (winnerId) {
          const loserId = winnerId === active.agent1Id ? active.agent2Id : active.agent1Id;
          await tx.agent.update({ where: { id: winnerId }, data: { wins: { increment: 1 }, elo: { increment: 25 } } });
          await tx.agent.update({ where: { id: loserId }, data: { losses: { increment: 1 }, elo: { decrement: 25 } } });
        }

        // Resolve side bets
        // (handled by resolveSideBets function called from here)
      });
    } catch (e) {
      console.error("Failed to persist fight result:", e);
    }

    // Notify agents
    const active = fightManager.activeFights.get(fightId);
    if (active) {
      const msg = { type: "fight_end", fight_id: fightId, winner: winnerId, state };
      pit.sendToAgent(active.agent1Id, msg);
      pit.sendToAgent(active.agent2Id, msg);
    }
  };

  function sendExchangeRequest(fightId: string): void {
    const state = fightManager.getFightState(fightId);
    const active = fightManager.activeFights.get(fightId);
    if (!state || !active || state.status !== "waiting_for_actions") return;

    const makeRequest = (agentId: string, isP1: boolean) => ({
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

    pit.sendToAgent(active.agent1Id, makeRequest(active.agent1Id, true));
    pit.sendToAgent(active.agent2Id, makeRequest(active.agent2Id, false));
  }

  // Also send exchange requests after each resolved exchange
  const originalOnUpdate = fightManager.onFightUpdate;
  fightManager.onFightUpdate = (fightId, state) => {
    originalOnUpdate?.(fightId, state);
    if (state.status === "waiting_for_actions") {
      sendExchangeRequest(fightId);
    }
  };

  function sendFightStateToAgent(agentId: string, fightId: string, state: any): void {
    pit.sendToAgent(agentId, { type: "fight_state", fight_id: fightId, state });
  }

  function broadcastToFight(fightId: string, event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN && client.spectating === fightId) {
        client.ws.send(msg);
      }
    }
  }

  function broadcastToSpectators(event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  // Heartbeat
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

  wss.on("connection", (ws) => {
    const client: WsClient = { ws, isAlive: true };
    clients.add(client);

    ws.on("pong", () => { client.isAlive = true; });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case "register": {
            const data = RegisterMsg.parse(msg);
            // Check username uniqueness
            const existing = await prisma.agent.findUnique({ where: { username: data.name } });
            if (existing) {
              ws.send(JSON.stringify({ type: "error", error: "Username taken" }));
              return;
            }
            // Generate API key
            const apiKey = `sk_${nanoid(32)}`;
            const apiKeyHash = await bcrypt.hash(apiKey, 10);
            // Create agent in DB (needs an owner wallet — for WS registration, use a placeholder)
            // In production, registration should require wallet auth first
            const agent = await prisma.agent.create({
              data: {
                username: data.name,
                characterId: data.character,
                apiKeyHash,
                ownerWallet: "pending", // Will be set when wallet linked
              },
            });
            ws.send(JSON.stringify({ type: "registered", api_key: apiKey, agent_id: agent.id, username: data.name }));
            break;
          }

          case "auth": {
            const data = AuthMsg.parse(msg);
            // Find agent by trying all agents (in production, store key prefix for lookup)
            const agents = await prisma.agent.findMany();
            let authedAgent = null;
            for (const agent of agents) {
              if (await bcrypt.compare(data.api_key, agent.apiKeyHash)) {
                authedAgent = agent;
                break;
              }
            }
            if (!authedAgent) {
              ws.send(JSON.stringify({ type: "error", error: "Invalid API key" }));
              return;
            }
            client.agentId = authedAgent.id;
            // Join The Pit
            pit.join({
              ws,
              agentId: authedAgent.id,
              username: authedAgent.username,
              characterId: authedAgent.characterId,
              elo: authedAgent.elo,
              wins: authedAgent.wins,
              losses: authedAgent.losses,
            });
            ws.send(JSON.stringify({
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
            }));
            break;
          }

          case "pit_chat": {
            if (!client.agentId) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
            const data = ChatMsg.parse(msg);
            const result = pit.chat(client.agentId, data.message);
            if (!result.ok) ws.send(JSON.stringify({ type: "error", error: result.error }));
            break;
          }

          case "callout": {
            if (!client.agentId) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
            const data = CalloutMsg.parse(msg);
            const result = pit.createCallout(client.agentId, data.target, data.wager, data.message);
            if (!result.ok) ws.send(JSON.stringify({ type: "error", error: result.error }));
            break;
          }

          case "callout_accept": {
            if (!client.agentId) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
            const data = CalloutAcceptMsg.parse(msg);
            const result = pit.acceptCallout(data.callout_id, client.agentId);
            if (result.ok && result.callout) {
              // Create fight from callout
              const fightId = nanoid();
              fightManager.createFight(fightId, result.callout.fromAgentId, result.callout.targetAgentId, result.callout.wager);
              try {
                await prisma.fight.create({
                  data: {
                    id: fightId,
                    agent1Id: result.callout.fromAgentId,
                    agent2Id: result.callout.targetAgentId,
                    wagerAmount: result.callout.wager,
                    status: "active",
                  },
                });
              } catch {}
              const state = fightManager.getFightState(fightId);
              pit.sendToAgent(result.callout.fromAgentId, { type: "fight_start", fight_id: fightId, state });
              pit.sendToAgent(result.callout.targetAgentId, { type: "fight_start", fight_id: fightId, state });
              broadcastToSpectators("fight_starting", { fight_id: fightId });
              sendExchangeRequest(fightId);
            } else {
              ws.send(JSON.stringify({ type: "error", error: result.error }));
            }
            break;
          }

          case "callout_decline": {
            if (!client.agentId) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
            const data = CalloutDeclineMsg.parse(msg);
            const result = pit.declineCallout(data.callout_id, client.agentId);
            if (!result.ok) ws.send(JSON.stringify({ type: "error", error: result.error }));
            break;
          }

          case "queue": {
            if (!client.agentId) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
            const agent = pit.agents.get(client.agentId);
            if (!agent) { ws.send(JSON.stringify({ type: "error", error: "Not in The Pit" })); return; }
            matchmaker.enqueue({ agentId: client.agentId, username: agent.username, elo: agent.elo, joinedAt: Date.now() });
            ws.send(JSON.stringify({ type: "queued", queue_size: matchmaker.getQueueSize() }));
            break;
          }

          case "action": {
            if (!client.agentId) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
            const data = ActionMsg.parse(msg);
            fightManager.submitAction(data.fight_id, client.agentId, data.action);
            break;
          }

          case "spectate": {
            const data = SpectateMsg.parse(msg);
            client.spectating = data.fight_id ?? undefined;
            break;
          }
        }
      } catch (e: any) {
        ws.send(JSON.stringify({ type: "error", error: e.message ?? "Invalid message" }));
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

  return { pit, matchmaker, fightManager, broadcastToFight, broadcastToSpectators };
}
```

### Step 5: Update index.ts to use new ws.ts

```typescript
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { config } from "./config.js";
import { setupWebSocket } from "./api/ws.js";
import { createRouter } from "./api/routes.js";

const app = express();
const server = createServer(app);

app.use(cors({ origin: config.corsOrigins }));
app.use(express.json());

const { pit, matchmaker, fightManager } = setupWebSocket(server);
const router = createRouter({ pit, fightManager });
app.use("/api/v1", router);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

server.listen(config.port, () => {
  console.log(`Arena server running on port ${config.port}`);
});
```

### Step 6: Commit

```bash
git add packages/server/src/
git commit -m "feat: WebSocket rewrite — agent auth, The Pit, matchmaker, fight manager"
```

---

## Task 4: Update REST API Routes

**Files:**
- Modify: `packages/server/src/api/routes.ts`

The REST routes need to:
- Use DB (Prisma) instead of in-memory Lobby for reads
- Accept `Pit` and `FightManager` instead of `Lobby`
- Add `/skills.md` endpoint
- Add deposit/withdrawal endpoints (later in Task 6)
- Add side bet endpoints using DB

**Step 1: Rewrite routes.ts**

The new router accepts `{ pit, fightManager }` and queries Prisma for persistent data (agents, leaderboard, stats) while using FightManager for active fight state.

Key changes:
- `GET /arena/stats` — queries DB for totalFights, totalAgents, totalWagered
- `GET /arena/leaderboard` — queries agents sorted by Elo
- `GET /arena/fights` — uses FightManager.getActiveFights()
- `GET /arena/fight/:id` — uses FightManager.getFightState()
- `GET /arena/pit` — returns current Pit agents and recent chat
- `GET /skills.md` — serves the agent onboarding document
- Side bet endpoints query/write to DB

**Step 2: Commit**

```bash
git add packages/server/src/api/routes.ts
git commit -m "feat: update REST routes for DB-backed state + skills.md endpoint"
```

---

## Task 5: $NORTH Token Contract

**Files:**
- Create: `packages/contracts/NorthToken.sol`
- Create: `packages/contracts/deploy.ts`

**Step 1: Create minimal ERC-20 contract**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract NorthToken is ERC20 {
    constructor(address distributor) ERC20("Northstar", "NORTH") {
        _mint(distributor, 100_000_000_000 * 10**decimals()); // 100B tokens
    }
}
```

**Step 2: Deploy script** using viem + Hardhat or Foundry (operator decides tooling). For now, create the contract and a deployment helper.

**Step 3: Commit**

```bash
git add packages/contracts/
git commit -m "feat: $NORTH ERC-20 token contract (100B supply)"
```

---

## Task 6: Deposit/Withdrawal System

**Files:**
- Create: `packages/server/src/chain/deposit-watcher.ts`
- Create: `packages/server/src/chain/withdrawal.ts`
- Create: `packages/server/src/chain/abi.ts` (ERC-20 ABI)
- Modify: `packages/server/src/api/routes.ts` (add deposit/withdraw endpoints)

**Step 1: Create deposit watcher**

Uses `viem` to watch for Transfer events to the master deposit address. On detection, credits user balance in DB via a transaction.

**Step 2: Create withdrawal handler**

Accepts withdrawal requests, validates balance, sends $NORTH from hot wallet using `viem`, records transaction with txHash.

**Step 3: Add REST endpoints**

- `POST /arena/withdraw` — `{ wallet_address, amount }` (requires SIWE auth)
- `GET /arena/balance/:address` — returns user balance
- `GET /arena/transactions/:address` — returns user transaction history

**Step 4: Commit**

```bash
git add packages/server/src/chain/
git commit -m "feat: deposit watcher + withdrawal system for $NORTH on Base"
```

---

## Task 7: Side Bet System (DB-backed)

**Files:**
- Modify: `packages/server/src/api/routes.ts` (update side bet endpoints)
- Create: `packages/server/src/state/bet-manager.ts`

The existing side bet logic in lobby.ts is solid. Port it to use Prisma transactions for atomicity.

**Step 1: Create bet-manager.ts**

- `placeBet(fightId, walletAddress, backedAgentId, amount)` — validates balance, debits user, creates Bet + Transaction records
- `resolveBets(fightId, winnerId)` — calculates payouts, credits winners, records rake in treasury
- Both use Prisma `$transaction` for atomicity

Min bet: 50,000 tokens. Max bet: 10,000,000 tokens.

**Step 2: Commit**

```bash
git add packages/server/src/state/bet-manager.ts packages/server/src/api/routes.ts
git commit -m "feat: DB-backed side bets with atomic balance updates"
```

---

## Task 8: Frontend — Env Vars + The Pit + Deposit UI

**Files:**
- Modify: `packages/web/app/page.tsx` (fix hardcoded localhost)
- Modify: `packages/web/app/leaderboard/page.tsx` (fix hardcoded localhost)
- Modify: `packages/web/components/arena/BettingPanel.tsx` (update bet amounts for $NORTH)
- Create: `packages/web/app/pit/page.tsx` (The Pit spectator view)
- Create: `packages/web/app/register/page.tsx` (agent registration page)
- Create: `packages/web/components/arena/DepositPanel.tsx` (deposit/withdraw UI)
- Modify: `packages/web/next.config.ts` (add rewrites for API proxy if needed)

**Step 1: Fix hardcoded URLs**

Replace all `http://localhost:3001` with `process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001"` in:
- `app/page.tsx` (line 23)
- `app/leaderboard/page.tsx` (find the fetch URL)

**Step 2: Create The Pit page**

`/pit` — shows live agent chat, callouts, and fight announcements. Connects via WebSocket as a spectator.

**Step 3: Create agent registration page**

`/register` — wallet-connected user can register an agent with username + character selection. Calls the WebSocket register message or a REST endpoint.

**Step 4: Create deposit/withdraw panel**

Reusable component: shows balance, deposit button (sends $NORTH on-chain), withdraw button (calls REST API).

**Step 5: Update BettingPanel bet amounts**

Change quick-bet buttons from `[5, 10, 25]` to `[50000, 100000, 500000]` (in $NORTH tokens). Update labels.

**Step 6: Commit**

```bash
git add packages/web/
git commit -m "feat: frontend — The Pit, registration, deposit/withdraw, env vars"
```

---

## Task 9: Skills.md Endpoint

**Files:**
- Modify: `packages/server/src/api/routes.ts`

**Step 1: Add the /skills.md route**

Serves a plain-text markdown response with the complete agent onboarding documentation (as designed in Section 5 of the design doc). Content-Type: `text/markdown`.

**Step 2: Update frontend link**

The home page already links to `/skills.md`. Update the href to point to the API server: `${NEXT_PUBLIC_SERVER_URL}/api/v1/skills.md` or set up a Next.js rewrite.

**Step 3: Commit**

```bash
git add packages/server/src/api/routes.ts packages/web/app/page.tsx
git commit -m "feat: /skills.md agent self-onboarding endpoint"
```

---

## Task 10: Security Hardening

**Files:**
- Create: `packages/server/src/middleware/rate-limit.ts`
- Create: `packages/server/src/middleware/siwe-auth.ts`
- Modify: `packages/server/src/index.ts` (add middleware)
- Modify: `packages/server/src/api/ws.ts` (add username blocklist)

**Step 1: Rate limiting middleware**

Use a simple in-memory rate limiter (or `express-rate-limit` package):
- Bets: 5/min per wallet
- Deposits/Withdrawals: 3/hour per wallet
- General API: 100/min per IP

**Step 2: SIWE auth middleware**

For deposit/withdraw/bet REST endpoints, require a signed SIWE message to verify wallet ownership.

**Step 3: Username blocklist**

Add a basic slur/profanity blocklist to the WebSocket register handler.

**Step 4: Commit**

```bash
git add packages/server/src/middleware/
git commit -m "feat: rate limiting, SIWE auth, username blocklist"
```

---

## Task 11: Production Config + Deployment

**Files:**
- Modify: `packages/web/next.config.ts`
- Create: `packages/server/Dockerfile` (for Render)
- Create: `.env.example` (document all required env vars)

**Step 1: next.config.ts**

Add server URL rewrite so frontend can proxy API calls (avoids CORS in production).

**Step 2: Dockerfile for Render**

Simple Node.js Dockerfile: install deps, build TS, run `node dist/index.js`.

**Step 3: .env.example**

Document all required environment variables with descriptions.

**Step 4: Commit**

```bash
git add packages/ .env.example
git commit -m "feat: production deployment config (Vercel + Render)"
```

---

## Execution Order & Parallelism

Tasks that can run in parallel (independent):
- **Task 1** (Prisma schema) — must be first, everything depends on it
- **Task 2** (config) — can run parallel with Task 1
- **Task 5** ($NORTH contract) — fully independent

After Task 1 completes:
- **Task 3** (WebSocket rewrite) + **Task 4** (REST routes) — sequential, Task 3 first
- **Task 6** (deposit/withdraw) + **Task 7** (side bets) — can run parallel after Task 3
- **Task 8** (frontend) — can start after Task 4

After all backend tasks:
- **Task 9** (skills.md) — quick, depends on routes
- **Task 10** (security) — depends on routes + WS
- **Task 11** (deployment) — last

```
Task 1 (schema) ──┬──> Task 3 (WS) ──> Task 4 (REST) ──┬──> Task 9 (skills.md)
Task 2 (config) ──┘                                      ├──> Task 10 (security)
Task 5 (token)  ──────> Task 6 (deposit) ────────────────┤
                        Task 7 (bets) ───────────────────┤
                        Task 8 (frontend) ───────────────┘──> Task 11 (deploy)
```

## Grunt Delegation

Use OpenClaw grunts (`ollama_grunt.py`) for:
- Generating the Prisma migration SQL
- Writing the ERC-20 contract (boilerplate)
- Generating Zod schemas
- Writing the skills.md content
- Creating the .env.example
- Dockerfile creation

Use Haiku subagents for:
- Multi-file refactors (routes.ts, index.ts)
- Frontend page creation (pit, register, deposit panel)

Use main context (Opus) for:
- WebSocket rewrite (complex state management)
- Fight manager (timeout logic, race conditions)
- Bet resolution (financial correctness)
- Security middleware (auth, rate limiting)

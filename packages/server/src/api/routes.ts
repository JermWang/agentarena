import { Router, type Request, type Response } from "express";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "../db/client.js";
import type { Pit } from "../state/pit.js";
import type { FightManager } from "../state/fight-manager.js";
import type { BetManager } from "../state/bet-manager.js";
import { isValidSolanaAddress, SOLANA_ADDRESS_REGEX } from "../chain/abi.js";
import { Decimal } from "@prisma/client/runtime/library.js";
import { config } from "../config.js";

const WALLET_REGEX = SOLANA_ADDRESS_REGEX;
const SIDE_BET_CHALLENGE_TTL_MS = 5 * 60_000;

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

function buildSideBetMessage(args: {
  walletAddress: string;
  fightId: string;
  backedAgentId: string;
  amount: string;
  token: string;
  nonce: string;
  expiresAtIso: string;
}): string {
  return [
    "Agent Battle Arena side-bet authorization",
    `Wallet: ${args.walletAddress}`,
    `Fight: ${args.fightId}`,
    `Backed Agent: ${args.backedAgentId}`,
    `Amount: ${args.amount} ${args.token}`,
    `Nonce: ${args.nonce}`,
    `Expires: ${args.expiresAtIso}`,
  ].join("\n");
}

const ClaimAgentBody = z.object({
  api_key: z.string().min(1),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
  signature: z.string().min(1),
});

interface RouterDeps {
  pit: Pit;
  fightManager: FightManager;
  betManager: BetManager;
}

export function createRouter({ pit, fightManager, betManager }: RouterDeps): Router {
  const router = Router();

  // --- Leaderboard (DB-backed, sorted by elo) ---
  router.get("/arena/leaderboard", async (_req: Request, res: Response) => {
    try {
      const agents = await prisma.agent.findMany({
        select: { id: true, username: true, characterId: true, elo: true, wins: true, losses: true },
        orderBy: { elo: "desc" },
        take: 100,
      });
      res.json({ ok: true, leaderboard: agents });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- List agents currently in The Pit ---
  router.get("/arena/agents", (_req: Request, res: Response) => {
    res.json({ ok: true, agents: pit.getAgentsList() });
  });

  // --- Active fights ---
  router.get("/arena/fights", (_req: Request, res: Response) => {
    const fights: Array<{ fightId: string; agent1: string; agent2: string; wager: number }> = [];
    for (const [fightId, active] of fightManager.activeFights) {
      const a1 = pit.agents.get(active.agent1Id);
      const a2 = pit.agents.get(active.agent2Id);
      fights.push({
        fightId,
        agent1: a1?.username ?? active.agent1Id,
        agent2: a2?.username ?? active.agent2Id,
        wager: active.wager,
      });
    }
    res.json({ ok: true, fights });
  });

  // --- Single fight state ---
  router.get("/arena/fight/:fightId", (req: Request, res: Response) => {
    const state = fightManager.getFightState(req.params.fightId);
    if (!state) return res.status(404).json({ ok: false, error: "Fight not found" });
    res.json({ ok: true, state });
  });

  // --- Stats ---
  router.get("/arena/stats", async (_req: Request, res: Response) => {
    try {
      const [totalFights, totalAgents] = await Promise.all([
        prisma.fight.count(),
        prisma.agent.count(),
      ]);
      res.json({
        ok: true,
        stats: {
          totalFights,
          totalAgents,
          activeFights: fightManager.activeFights.size,
          pitAgents: pit.agents.size,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Agent profile by username ---
  router.get("/arena/agent/:username", async (req: Request, res: Response) => {
    try {
      const agent = await prisma.agent.findUnique({
        where: { username: req.params.username },
        select: { id: true, username: true, characterId: true, elo: true, wins: true, losses: true, createdAt: true },
      });
      if (!agent) return res.status(404).json({ ok: false, error: "Agent not found" });
      res.json({ ok: true, agent });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Recent fights (for spectator view) ---
  router.get("/arena/recent-fights", async (_req: Request, res: Response) => {
    try {
      const fights = await prisma.fight.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          wagerAmount: true,
          createdAt: true,
          completedAt: true,
          agent1: { select: { username: true, characterId: true, isDemo: true } },
          agent2: { select: { username: true, characterId: true, isDemo: true } },
          winner: { select: { username: true } },
        },
      });
      res.json({ ok: true, fights });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Claim agent with wallet signature ---
  router.post("/arena/claim-agent", async (req: Request, res: Response) => {
    try {
      const { api_key, wallet_address, signature } = ClaimAgentBody.parse(req.body);

      // Find agent by API key (same bcrypt scan pattern as ws.ts auth)
      const agents = await prisma.agent.findMany({ take: 1000 });
      let targetAgent = null;
      for (const agent of agents) {
        if (await bcrypt.compare(api_key, agent.apiKeyHash)) {
          targetAgent = agent;
          break;
        }
      }
      if (!targetAgent) {
        return res.status(401).json({ ok: false, error: "Invalid API key" });
      }

      // Check if already claimed by a different wallet
      if (targetAgent.ownerWallet !== "pending" && targetAgent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Agent already claimed by another wallet" });
      }

      // Verify wallet signature (Solana ed25519)
      const message = `I own agent ${targetAgent.username} on Agent Battle Arena`;
      const valid = verifySolanaSignature(wallet_address, message, signature);
      if (!valid) {
        return res.status(401).json({ ok: false, error: "Invalid signature" });
      }

      // Upsert User and update agent in a transaction
      const updatedAgent = await prisma.$transaction(async (tx) => {
        await tx.user.upsert({
          where: { walletAddress: wallet_address },
          create: { walletAddress: wallet_address },
          update: {},
        });
        return tx.agent.update({
          where: { id: targetAgent.id },
          data: { ownerWallet: wallet_address },
          select: { id: true, username: true, ownerWallet: true, characterId: true, elo: true, wins: true, losses: true },
        });
      });

      res.json({ ok: true, agent: updatedAgent });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Get agents owned by a wallet ---
  router.get("/arena/owner/:walletAddress/agents", async (req: Request, res: Response) => {
    try {
      const { walletAddress } = req.params;
      if (!WALLET_REGEX.test(walletAddress)) {
        return res.status(400).json({ ok: false, error: "Invalid wallet address" });
      }

      const agents = await prisma.agent.findMany({
        where: { ownerWallet: walletAddress },
        select: {
          id: true,
          username: true,
          characterId: true,
          elo: true,
          wins: true,
          losses: true,
          createdAt: true,
          _count: {
            select: {
              fightsAsP1: true,
              fightsAsP2: true,
              fightsWon: true,
            },
          },
        },
        orderBy: { elo: "desc" },
      });

      const result = agents.map((a) => ({
        id: a.id,
        username: a.username,
        characterId: a.characterId,
        elo: a.elo,
        wins: a.wins,
        losses: a.losses,
        createdAt: a.createdAt,
        totalFights: a._count.fightsAsP1 + a._count.fightsAsP2,
        totalWins: a._count.fightsWon,
      }));

      res.json({ ok: true, agents: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Agent fight history ---
  router.get("/arena/agent/:username/fights", async (req: Request, res: Response) => {
    try {
      const agent = await prisma.agent.findUnique({
        where: { username: req.params.username },
        select: { id: true, isDemo: true },
      });
      if (!agent) return res.status(404).json({ ok: false, error: "Agent not found" });

      const fights = await prisma.fight.findMany({
        where: { OR: [{ agent1Id: agent.id }, { agent2Id: agent.id }] },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          wagerAmount: true,
          createdAt: true,
          completedAt: true,
          agent1: { select: { username: true, characterId: true, isDemo: true } },
          agent2: { select: { username: true, characterId: true, isDemo: true } },
          winner: { select: { username: true } },
          rounds: {
            select: { round: true, exchanges: true, p1Hp: true, p2Hp: true, winnerId: true },
            orderBy: { round: "asc" },
          },
        },
      });

      res.json({ ok: true, fights, agent: { isDemo: agent.isDemo } });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Rotate API key ---
  router.post("/arena/rotate-api-key", async (req: Request, res: Response) => {
    try {
      const { username, wallet_address, signature } = req.body;
      if (!username || !wallet_address || !signature) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }

      const agent = await prisma.agent.findUnique({ where: { username } });
      if (!agent) {
        return res.status(404).json({ ok: false, error: "Agent not found" });
      }
      if (agent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Not the owner of this agent" });
      }

      // Verify wallet signature (Solana ed25519)
      const message = `Rotate API key for agent ${username} on Agent Battle Arena`;
      const valid = verifySolanaSignature(wallet_address, message, signature);
      if (!valid) {
        return res.status(401).json({ ok: false, error: "Invalid signature" });
      }

      // Generate new key and update hash
      const apiKey = `sk_${nanoid(32)}`;
      const apiKeyHash = await bcrypt.hash(apiKey, 10);

      await prisma.agent.update({
        where: { id: agent.id },
        data: { apiKeyHash },
      });

      res.json({ ok: true, api_key: apiKey });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Transfer agent ownership ---
  router.post("/arena/transfer-agent", async (req: Request, res: Response) => {
    try {
      const { username, new_wallet_address, signature } = req.body;
      if (!username || !new_wallet_address || !signature) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }
      if (!WALLET_REGEX.test(new_wallet_address)) {
        return res.status(400).json({ ok: false, error: "Invalid wallet address" });
      }

      const agent = await prisma.agent.findUnique({ where: { username } });
      if (!agent) {
        return res.status(404).json({ ok: false, error: "Agent not found" });
      }
      if (agent.ownerWallet === "pending") {
        return res.status(400).json({ ok: false, error: "Agent must be claimed before transferring" });
      }

      // Verify wallet signature from current owner (Solana ed25519)
      const message = `Transfer agent ${username} to ${new_wallet_address} on Agent Battle Arena`;
      const valid = verifySolanaSignature(agent.ownerWallet, message, signature);
      if (!valid) {
        return res.status(401).json({ ok: false, error: "Invalid signature" });
      }

      // Transfer in a transaction
      const updatedAgent = await prisma.$transaction(async (tx) => {
        await tx.user.upsert({
          where: { walletAddress: new_wallet_address },
          create: { walletAddress: new_wallet_address },
          update: {},
        });
        return tx.agent.update({
          where: { id: agent.id },
          data: { ownerWallet: new_wallet_address },
          select: { id: true, username: true, ownerWallet: true, characterId: true, elo: true, wins: true, losses: true },
        });
      });

      res.json({ ok: true, agent: updatedAgent });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Place side bet ---
  router.post("/arena/side-bet/challenge", async (req: Request, res: Response) => {
    try {
      const challengeSchema = z.object({
        fight_id: z.string().min(1),
        wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX),
        backed_agent: z.string().min(1),
        amount: z.union([z.string(), z.number()]),
      });

      const parsed = challengeSchema.parse(req.body);
      const amountDecimal = new Decimal(String(parsed.amount));
      if (amountDecimal.lte(0)) {
        return res.status(400).json({ ok: false, error: "Amount must be positive" });
      }

      const fight = await prisma.fight.findUnique({
        where: { id: parsed.fight_id },
        select: { id: true, agent1Id: true, agent2Id: true, status: true },
      });
      if (!fight) return res.status(404).json({ ok: false, error: "Fight not found" });
      if (fight.status !== "active") return res.status(400).json({ ok: false, error: "Fight is not active" });

      const agent = await prisma.agent.findUnique({
        where: { username: parsed.backed_agent },
        select: { id: true },
      });
      const backedAgentId = agent?.id ?? parsed.backed_agent;
      if (backedAgentId !== fight.agent1Id && backedAgentId !== fight.agent2Id) {
        return res.status(400).json({ ok: false, error: "Backed agent is not in this fight" });
      }

      const nonce = randomBytes(16).toString("hex");
      const expiresAt = new Date(Date.now() + SIDE_BET_CHALLENGE_TTL_MS);
      const token = config.arenaTokenMint ? "ARENA" : "SOL";
      const message = buildSideBetMessage({
        walletAddress: parsed.wallet_address,
        fightId: parsed.fight_id,
        backedAgentId,
        amount: amountDecimal.toString(),
        token,
        nonce,
        expiresAtIso: expiresAt.toISOString(),
      });

      await prisma.sideBetNonce.create({
        data: {
          nonce,
          walletAddress: parsed.wallet_address,
          fightId: parsed.fight_id,
          backedAgentId,
          amount: amountDecimal,
          message,
          expiresAt,
        },
      });

      return res.json({ ok: true, nonce, message, expiresAt: expiresAt.toISOString() });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/side-bet", async (req: Request, res: Response) => {
    try {
      const SideBetBody = z.object({
        fight_id: z.string().min(1),
        wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX),
        backed_agent: z.string().min(1),
        amount: z.union([z.string(), z.number()]),
        nonce: z.string().min(1),
        signature: z.string().min(1),
      });

      const { fight_id, wallet_address, backed_agent, amount, nonce, signature } = SideBetBody.parse(req.body);
      if (!fight_id || !wallet_address || !backed_agent || !amount || !nonce || !signature) {
        return res.status(400).json({ ok: false, error: "Missing required fields" });
      }

      const amountDecimal = new Decimal(String(amount));
      if (amountDecimal.lte(0)) {
        return res.status(400).json({ ok: false, error: "Amount must be positive" });
      }

      const challenge = await prisma.sideBetNonce.findUnique({ where: { nonce } });
      if (!challenge) {
        return res.status(400).json({ ok: false, error: "Invalid or expired side-bet authorization" });
      }
      if (challenge.walletAddress !== wallet_address) {
        return res.status(400).json({ ok: false, error: "Side-bet authorization wallet mismatch" });
      }
      if (challenge.fightId !== fight_id) {
        return res.status(400).json({ ok: false, error: "Side-bet authorization fight mismatch" });
      }
      if (!challenge.amount.equals(amountDecimal)) {
        return res.status(400).json({ ok: false, error: "Side-bet authorization amount mismatch" });
      }
      if (challenge.usedAt) {
        return res.status(409).json({ ok: false, error: "Side-bet authorization already used" });
      }
      if (challenge.expiresAt.getTime() < Date.now()) {
        return res.status(400).json({ ok: false, error: "Side-bet authorization expired" });
      }

      const validSignature = verifySolanaSignature(wallet_address, challenge.message, signature);
      if (!validSignature) {
        return res.status(401).json({ ok: false, error: "Invalid wallet signature" });
      }

      // Resolve agent username to agent ID
      const agent = await prisma.agent.findUnique({
        where: { username: backed_agent },
        select: { id: true },
      });
      const backedAgentId = agent?.id ?? backed_agent;

      if (challenge.backedAgentId !== backedAgentId) {
        return res.status(400).json({ ok: false, error: "Side-bet authorization backed agent mismatch" });
      }

      const consume = await prisma.sideBetNonce.updateMany({
        where: {
          nonce,
          usedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        data: { usedAt: new Date() },
      });
      if (consume.count !== 1) {
        return res.status(409).json({ ok: false, error: "Side-bet authorization could not be consumed" });
      }

      const bet = await betManager.placeBet(fight_id, wallet_address, backedAgentId, amountDecimal.toString());
      const pool = await betManager.getBets(fight_id);

      res.json({
        ok: true,
        bet: { id: bet.id },
        pool: {
          p1: Number(pool.agent1Pool),
          p2: Number(pool.agent2Pool),
        },
      });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // --- Get side bets for a fight ---
  router.get("/arena/side-bets/:fightId", async (req: Request, res: Response) => {
    try {
      const pool = await betManager.getBets(req.params.fightId);
      res.json({
        ok: true,
        pool: {
          p1: Number(pool.agent1Pool),
          p2: Number(pool.agent2Pool),
        },
        betCount: pool.betCount,
        activeBetCount: pool.activeBetCount,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

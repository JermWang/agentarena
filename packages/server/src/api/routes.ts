import { Router, type Request, type Response } from "express";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { prisma } from "../db/client.js";
import type { Pit } from "../state/pit.js";
import type { FightManager } from "../state/fight-manager.js";
import type { BetManager } from "../state/bet-manager.js";
import { isValidSolanaAddress, SOLANA_ADDRESS_REGEX } from "../chain/abi.js";
import { Decimal } from "@prisma/client/runtime/library.js";
import { config } from "../config.js";
import { betLimiter } from "../middleware/rate-limit.js";

const WALLET_REGEX = SOLANA_ADDRESS_REGEX;
const SIDE_BET_CHALLENGE_TTL_MS = 5 * 60_000;
const AGENT_ACTION_CHALLENGE_TTL_MS = 5 * 60_000;
const API_KEY_SCAN_BATCH_SIZE = 500;
const ZERO_DECIMAL = new Decimal(0);
const STATS_BASELINE_FIGHTS = Number.parseInt(process.env.STATS_BASELINE_FIGHTS ?? "4116", 10);
const STATS_BASELINE_AGENTS = Number.parseInt(process.env.STATS_BASELINE_AGENTS ?? "102", 10);

function applyStatsBaseline(total: number, baseline: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return total;
  }
  return Math.max(0, total - baseline);
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
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

const ClaimAgentChallengeBody = z.object({
  api_key: z.string().min(1),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
});

const RotateApiKeyChallengeBody = z.object({
  username: z.string().min(1),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
});

const RotateApiKeyBody = z.object({
  username: z.string().min(1),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

const TransferAgentChallengeBody = z.object({
  username: z.string().min(1),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
  new_wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
});

const TransferAgentBody = z.object({
  username: z.string().min(1),
  wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
  new_wallet_address: z.string().regex(SOLANA_ADDRESS_REGEX, "Invalid wallet address"),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

type AgentAction = "claim_agent" | "rotate_api_key" | "transfer_agent";

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

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

function buildAgentActionMessage(args: {
  action: AgentAction;
  walletAddress: string;
  username: string;
  nonce: string;
  expiresAtIso: string;
  newWalletAddress?: string;
}): string {
  const lines = [
    "Agent Battle Arena authorization",
    `Action: ${args.action}`,
    `Wallet: ${args.walletAddress}`,
    `Agent: ${args.username}`,
  ];
  if (args.newWalletAddress) {
    lines.push(`New Wallet: ${args.newWalletAddress}`);
  }
  lines.push(`Nonce: ${args.nonce}`);
  lines.push(`Expires: ${args.expiresAtIso}`);
  return lines.join("\n");
}

async function issueAgentActionChallenge(args: {
  action: AgentAction;
  walletAddress: string;
  username: string;
  newWalletAddress?: string;
}) {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + AGENT_ACTION_CHALLENGE_TTL_MS);
  const message = buildAgentActionMessage({
    action: args.action,
    walletAddress: args.walletAddress,
    username: args.username,
    newWalletAddress: args.newWalletAddress,
    nonce,
    expiresAtIso: expiresAt.toISOString(),
  });

  await prisma.withdrawalNonce.create({
    data: {
      nonce,
      walletAddress: args.walletAddress,
      amount: ZERO_DECIMAL,
      message,
      expiresAt,
    },
  });

  return { nonce, message, expiresAt };
}

async function verifyAndConsumeAgentActionChallenge(args: {
  nonce: string;
  walletAddress: string;
  signature: string;
  expectedMessage: (expiresAtIso: string) => string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const challenge = await prisma.withdrawalNonce.findUnique({ where: { nonce: args.nonce } });
  if (!challenge) {
    return { ok: false, status: 400, error: "Invalid or expired authorization" };
  }
  if (challenge.walletAddress !== args.walletAddress) {
    return { ok: false, status: 400, error: "Authorization wallet mismatch" };
  }
  if (!challenge.amount.equals(ZERO_DECIMAL)) {
    return { ok: false, status: 400, error: "Authorization payload mismatch" };
  }
  if (challenge.usedAt) {
    return { ok: false, status: 409, error: "Authorization already used" };
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 400, error: "Authorization expired" };
  }

  const expected = args.expectedMessage(challenge.expiresAt.toISOString());
  if (challenge.message !== expected) {
    return { ok: false, status: 400, error: "Authorization payload mismatch" };
  }

  const validSignature = verifySolanaSignature(args.walletAddress, challenge.message, args.signature);
  if (!validSignature) {
    return { ok: false, status: 401, error: "Invalid signature" };
  }

  const consume = await prisma.withdrawalNonce.updateMany({
    where: {
      nonce: args.nonce,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (consume.count !== 1) {
    return { ok: false, status: 409, error: "Authorization could not be consumed" };
  }

  return { ok: true };
}

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
          totalFights: applyStatsBaseline(totalFights, STATS_BASELINE_FIGHTS),
          totalAgents: applyStatsBaseline(totalAgents, STATS_BASELINE_AGENTS),
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

  // --- Claim agent with wallet signature (nonce challenge) ---
  router.post("/arena/claim-agent/challenge", async (req: Request, res: Response) => {
    try {
      const { api_key, wallet_address } = ClaimAgentChallengeBody.parse(req.body);
      const targetAgent = await findAgentByApiKey(api_key);
      if (!targetAgent) {
        return res.status(401).json({ ok: false, error: "Invalid API key" });
      }
      if (targetAgent.ownerWallet !== "pending" && targetAgent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Agent already claimed by another wallet" });
      }

      const challenge = await issueAgentActionChallenge({
        action: "claim_agent",
        walletAddress: wallet_address,
        username: targetAgent.username,
      });

      return res.json({
        ok: true,
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/claim-agent", async (req: Request, res: Response) => {
    try {
      const { api_key, wallet_address, nonce, signature } = ClaimAgentBody.parse(req.body);
      const targetAgent = await findAgentByApiKey(api_key);
      if (!targetAgent) {
        return res.status(401).json({ ok: false, error: "Invalid API key" });
      }
      if (targetAgent.ownerWallet !== "pending" && targetAgent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Agent already claimed by another wallet" });
      }

      const verified = await verifyAndConsumeAgentActionChallenge({
        nonce,
        walletAddress: wallet_address,
        signature,
        expectedMessage: (expiresAtIso) => buildAgentActionMessage({
          action: "claim_agent",
          walletAddress: wallet_address,
          username: targetAgent.username,
          nonce,
          expiresAtIso,
        }),
      });
      if (!verified.ok) {
        return res.status(verified.status).json({ ok: false, error: verified.error });
      }

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

      return res.json({ ok: true, agent: updatedAgent });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
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

  // --- Rotate API key (nonce challenge) ---
  router.post("/arena/rotate-api-key/challenge", async (req: Request, res: Response) => {
    try {
      const { username, wallet_address } = RotateApiKeyChallengeBody.parse(req.body);
      const agent = await prisma.agent.findUnique({ where: { username } });
      if (!agent) {
        return res.status(404).json({ ok: false, error: "Agent not found" });
      }
      if (agent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Not the owner of this agent" });
      }

      const challenge = await issueAgentActionChallenge({
        action: "rotate_api_key",
        walletAddress: wallet_address,
        username,
      });

      return res.json({
        ok: true,
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/rotate-api-key", async (req: Request, res: Response) => {
    try {
      const { username, wallet_address, nonce, signature } = RotateApiKeyBody.parse(req.body);
      const agent = await prisma.agent.findUnique({ where: { username } });
      if (!agent) {
        return res.status(404).json({ ok: false, error: "Agent not found" });
      }
      if (agent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Not the owner of this agent" });
      }

      const verified = await verifyAndConsumeAgentActionChallenge({
        nonce,
        walletAddress: wallet_address,
        signature,
        expectedMessage: (expiresAtIso) => buildAgentActionMessage({
          action: "rotate_api_key",
          walletAddress: wallet_address,
          username,
          nonce,
          expiresAtIso,
        }),
      });
      if (!verified.ok) {
        return res.status(verified.status).json({ ok: false, error: verified.error });
      }

      const apiKey = `sk_${nanoid(32)}`;
      const apiKeyHash = await bcrypt.hash(apiKey, 10);
      const apiKeyDigest = hashApiKey(apiKey);

      await prisma.agent.update({
        where: { id: agent.id },
        data: { apiKeyHash, apiKeyDigest },
      });

      return res.json({ ok: true, api_key: apiKey });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Transfer agent ownership (nonce challenge) ---
  router.post("/arena/transfer-agent/challenge", async (req: Request, res: Response) => {
    try {
      const { username, wallet_address, new_wallet_address } = TransferAgentChallengeBody.parse(req.body);
      const agent = await prisma.agent.findUnique({ where: { username } });
      if (!agent) {
        return res.status(404).json({ ok: false, error: "Agent not found" });
      }
      if (agent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Not the owner of this agent" });
      }
      if (agent.ownerWallet === "pending") {
        return res.status(400).json({ ok: false, error: "Agent must be claimed before transferring" });
      }

      const challenge = await issueAgentActionChallenge({
        action: "transfer_agent",
        walletAddress: wallet_address,
        username,
        newWalletAddress: new_wallet_address,
      });

      return res.json({
        ok: true,
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/transfer-agent", async (req: Request, res: Response) => {
    try {
      const { username, wallet_address, new_wallet_address, nonce, signature } = TransferAgentBody.parse(req.body);
      const agent = await prisma.agent.findUnique({ where: { username } });
      if (!agent) {
        return res.status(404).json({ ok: false, error: "Agent not found" });
      }
      if (agent.ownerWallet !== wallet_address) {
        return res.status(403).json({ ok: false, error: "Not the owner of this agent" });
      }
      if (agent.ownerWallet === "pending") {
        return res.status(400).json({ ok: false, error: "Agent must be claimed before transferring" });
      }

      const verified = await verifyAndConsumeAgentActionChallenge({
        nonce,
        walletAddress: wallet_address,
        signature,
        expectedMessage: (expiresAtIso) => buildAgentActionMessage({
          action: "transfer_agent",
          walletAddress: wallet_address,
          username,
          newWalletAddress: new_wallet_address,
          nonce,
          expiresAtIso,
        }),
      });
      if (!verified.ok) {
        return res.status(verified.status).json({ ok: false, error: verified.error });
      }

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

      return res.json({ ok: true, agent: updatedAgent });
    } catch (e: any) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ ok: false, error: e.errors[0].message });
      }
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Place side bet ---
  router.post("/arena/side-bet/challenge", betLimiter, async (req: Request, res: Response) => {
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

  router.post("/arena/side-bet", betLimiter, async (req: Request, res: Response) => {
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
      // Resolve usernames for display
      const fight = fightManager.activeFights.get(req.params.fightId);
      let p1Username: string | undefined;
      let p2Username: string | undefined;
      if (fight) {
        const a1 = pit.agents.get(fight.agent1Id);
        const a2 = pit.agents.get(fight.agent2Id);
        p1Username = a1?.username;
        p2Username = a2?.username;
      }
      if (!p1Username || !p2Username) {
        const dbFight = await prisma.fight.findUnique({
          where: { id: req.params.fightId },
          include: { agent1: { select: { username: true } }, agent2: { select: { username: true } } },
        });
        if (dbFight) {
          p1Username = p1Username || dbFight.agent1.username;
          p2Username = p2Username || dbFight.agent2.username;
        }
      }
      res.json({
        ok: true,
        pool: {
          p1: Number(pool.agent1Pool),
          p2: Number(pool.agent2Pool),
          p1Username,
          p2Username,
        },
        betCount: pool.betCount,
        activeBetCount: pool.activeBetCount,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Pit History: recent chat/callout/fight log from DB ---
  router.get("/pit/history", async (_req: Request, res: Response) => {
    try {
      const logs = await prisma.pitLog.findMany({
        where: {
          type: { in: ["chat", "callout", "callout_accepted", "callout_declined", "fight_start", "fight_end"] },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          type: true,
          fromUsername: true,
          toUsername: true,
          message: true,
          wager: true,
          fightId: true,
          createdAt: true,
        },
      });
      // Return oldest-first for the client to render chronologically
      res.json({ ok: true, logs: logs.reverse() });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Admin: reset all data (protected by ADMIN_SECRET env var) ---
  router.post("/admin/reset", async (req: Request, res: Response) => {
    const secret = process.env.ADMIN_SECRET;
    if (!secret || req.headers["x-admin-secret"] !== secret) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    try {
      // Delete in FK-safe order
      await prisma.pitLog.deleteMany();
      await prisma.sideBetNonce.deleteMany();
      await prisma.bet.deleteMany();
      await prisma.treasuryEntry.deleteMany();
      await prisma.fightRound.deleteMany();
      await prisma.fight.deleteMany();
      await prisma.transaction.deleteMany();
      await prisma.agent.deleteMany();
      await prisma.user.deleteMany();
      await prisma.withdrawalNonce.deleteMany();
      res.json({ ok: true, message: "All data reset" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

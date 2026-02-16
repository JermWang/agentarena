import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ACTIONS } from "../combat/actions.js";
import type { Lobby } from "../state/lobby.js";

const RegisterSchema = z.object({
  agent_id: z.string().min(1).max(64),
  skills_md: z.string().min(1).max(4000),
  wallet_address: z.string().min(1),
  character_preference: z.string().optional(),
});

const ChallengeSchema = z.object({
  agent_id: z.string(),
  target_agent_id: z.string(),
  wager_amount: z.number().positive(),
});

const AcceptSchema = z.object({
  agent_id: z.string(),
  challenge_id: z.string(),
});

const ActionSchema = z.object({
  agent_id: z.string(),
  fight_id: z.string(),
  action: z.enum(ACTIONS),
});

export function createRouter(lobby: Lobby): Router {
  const router = Router();

  router.post("/arena/register", (req: Request, res: Response) => {
    try {
      const body = RegisterSchema.parse(req.body);
      const agent = lobby.registerAgent(body.agent_id, body.skills_md, body.wallet_address, body.character_preference ?? "default");
      res.json({ ok: true, agent });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/challenge", (req: Request, res: Response) => {
    try {
      const body = ChallengeSchema.parse(req.body);
      const challenge = lobby.createChallenge(body.agent_id, body.target_agent_id, body.wager_amount);
      res.json({ ok: true, challenge });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/accept", (req: Request, res: Response) => {
    try {
      const body = AcceptSchema.parse(req.body);
      const fight = lobby.acceptChallenge(body.challenge_id, body.agent_id);
      res.json({ ok: true, fight_id: fight.getState().fightId, state: fight.getState() });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/action", (req: Request, res: Response) => {
    try {
      const body = ActionSchema.parse(req.body);
      const result = lobby.submitAction(body.fight_id, body.agent_id, body.action);
      const fight = lobby.getFight(body.fight_id)!;
      const state = fight.getState();

      // Auto-resolve side bets when fight ends
      let resolution = undefined;
      if (state.status === "fight_over") {
        try { resolution = lobby.resolveSideBets(body.fight_id); } catch {}
      }

      res.json({ ok: true, result, state, resolution });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post("/arena/next-round", (req: Request, res: Response) => {
    try {
      const { fight_id } = req.body;
      const fight = lobby.getFight(fight_id);
      if (!fight) return res.status(404).json({ ok: false, error: "Fight not found" });
      fight.nextRound();
      res.json({ ok: true, state: fight.getState() });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/arena/fights", (_req: Request, res: Response) => {
    res.json({ ok: true, fights: lobby.getActiveFights() });
  });

  router.get("/arena/fight/:fightId", (req: Request, res: Response) => {
    const fight = lobby.getFight(req.params.fightId);
    if (!fight) return res.status(404).json({ ok: false, error: "Fight not found" });
    res.json({ ok: true, state: fight.getState() });
  });

  router.get("/arena/agents", (_req: Request, res: Response) => {
    res.json({ ok: true, agents: Array.from(lobby.agents.values()) });
  });

  router.get("/arena/stats", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      stats: {
        totalFights: lobby.fights.size,
        totalAgents: lobby.agents.size,
        totalWagered: 0,
      },
    });
  });

  router.get("/arena/leaderboard", (_req: Request, res: Response) => {
    const agents = Array.from(lobby.agents.values()).map((agent) => ({
      id: agent.id,
      wins: agent.wins,
      losses: agent.losses,
      character: agent.characterId,
    }));
    agents.sort((a, b) => b.wins - a.wins);
    res.json({ ok: true, leaderboard: agents });
  });

  // --- Side Bets ---

  const SideBetSchema = z.object({
    fight_id: z.string(),
    wallet_address: z.string().min(1),
    backed_agent: z.string(),
    amount: z.number().positive(),
  });

  router.post("/arena/side-bet", (req: Request, res: Response) => {
    try {
      const body = SideBetSchema.parse(req.body);
      const bet = lobby.placeSideBet(body.fight_id, body.wallet_address, body.backed_agent, body.amount);
      const { pool } = lobby.getSideBets(body.fight_id);
      res.json({ ok: true, bet, pool });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/arena/side-bets/:fightId", (req: Request, res: Response) => {
    const { bets, pool } = lobby.getSideBets(req.params.fightId);
    res.json({ ok: true, bets, pool });
  });

  router.post("/arena/resolve-bets/:fightId", (req: Request, res: Response) => {
    try {
      const result = lobby.resolveSideBets(req.params.fightId);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  return router;
}

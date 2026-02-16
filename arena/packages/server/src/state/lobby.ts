import { nanoid } from "nanoid";
import { Fight } from "../combat/fight.js";
import type { Action } from "../combat/actions.js";

export const SIDE_BET_RAKE = 0.03;

export interface Agent {
  id: string;
  skillsMd: string;
  walletAddress: string;
  characterId: string;
  wins: number;
  losses: number;
  registeredAt: number;
}

export interface Challenge {
  id: string;
  challengerId: string;
  targetId: string;
  wagerAmount: number;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "accepted" | "declined" | "expired";
}

export interface SideBet {
  id: string;
  fightId: string;
  walletAddress: string;
  backedAgent: string; // which agent they're betting on
  amount: number;
  placedAt: number;
  status: "active" | "won" | "lost" | "refunded";
}

export interface Payout {
  betId: string;
  walletAddress: string;
  backedAgent: string;
  betAmount: number;
  payout: number; // 0 for losers, proportional share for winners
  status: "won" | "lost" | "refunded";
}

export interface ResolutionResult {
  fightId: string;
  winner: string | null;
  totalPool: number;
  rake: number;
  netPool: number;
  payouts: Payout[];
}

export class Lobby {
  onFightUpdate?: (fightId: string, state: any) => void;
  agents = new Map<string, Agent>();
  challenges = new Map<string, Challenge>();
  fights = new Map<string, Fight>();
  fightAgents = new Map<string, [string, string]>();
  sideBets = new Map<string, SideBet[]>(); // fightId -> bets

  registerAgent(id: string, skillsMd: string, walletAddress: string, characterId: string): Agent {
    if (this.agents.has(id)) throw new Error(`Agent ${id} already registered`);
    const agent: Agent = { id, skillsMd, walletAddress, characterId, wins: 0, losses: 0, registeredAt: Date.now() };
    this.agents.set(id, agent);
    return agent;
  }

  createChallenge(challengerId: string, targetId: string, wagerAmount: number): Challenge {
    if (!this.agents.has(challengerId)) throw new Error("Challenger not registered");
    if (!this.agents.has(targetId)) throw new Error("Target not registered");
    if (challengerId === targetId) throw new Error("Cannot challenge yourself");
    const challenge: Challenge = {
      id: nanoid(),
      challengerId,
      targetId,
      wagerAmount,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      status: "pending",
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  acceptChallenge(challengeId: string, agentId: string): Fight {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) throw new Error("Challenge not found");
    if (challenge.targetId !== agentId) throw new Error("Not the challenge target");
    if (challenge.status === "pending" && Date.now() > challenge.expiresAt) {
      challenge.status = "expired";
    }
    if (challenge.status !== "pending") throw new Error("Challenge not pending");

    challenge.status = "accepted";
    const fightId = nanoid();
    const fight = new Fight(fightId, challenge.challengerId, challenge.targetId);
    this.fights.set(fightId, fight);
    this.fightAgents.set(fightId, [challenge.challengerId, challenge.targetId]);
    return fight;
  }

  submitAction(fightId: string, agentId: string, action: Action) {
    const fight = this.fights.get(fightId);
    if (!fight) throw new Error("Fight not found");
    const result = fight.submitAction(agentId, action);
    if (result !== null) {
      this.onFightUpdate?.(fightId, fight.getState());
    }
    return result;
  }

  getFight(fightId: string): Fight | undefined {
    return this.fights.get(fightId);
  }

  getActiveFights(): Array<{ fightId: string; agents: [string, string] }> {
    const active: Array<{ fightId: string; agents: [string, string] }> = [];
    for (const [fightId, fight] of this.fights) {
      if (fight.getState().status !== "fight_over") {
        active.push({ fightId, agents: this.fightAgents.get(fightId)! });
      }
    }
    return active;
  }

  placeSideBet(fightId: string, walletAddress: string, backedAgent: string, amount: number): SideBet {
    const fight = this.fights.get(fightId);
    if (!fight) throw new Error("Fight not found");
    if (fight.getState().status === "fight_over") throw new Error("Fight already over");
    const agents = this.fightAgents.get(fightId)!;
    if (!agents.includes(backedAgent)) throw new Error("Agent not in this fight");
    if (amount <= 0) throw new Error("Bet amount must be positive");

    const bet: SideBet = {
      id: nanoid(),
      fightId,
      walletAddress,
      backedAgent,
      amount,
      placedAt: Date.now(),
      status: "active",
    };
    if (!this.sideBets.has(fightId)) this.sideBets.set(fightId, []);
    this.sideBets.get(fightId)!.push(bet);
    return bet;
  }

  getSideBets(fightId: string): { bets: SideBet[]; pool: { p1: number; p2: number } } {
    const bets = this.sideBets.get(fightId) ?? [];
    const agents = this.fightAgents.get(fightId);
    const pool = { p1: 0, p2: 0 };
    if (agents) {
      for (const bet of bets) {
        if (bet.backedAgent === agents[0]) pool.p1 += bet.amount;
        else pool.p2 += bet.amount;
      }
    }
    return { bets, pool };
  }

  recordFightResult(fightId: string): { winner: string | null; loser: string | null } {
    const fight = this.fights.get(fightId);
    if (!fight) throw new Error("Fight not found");

    const state = fight.getState();
    if (state.status !== "fight_over") throw new Error("Fight not over yet");

    const winner = fight.getWinner();
    const [agentId1, agentId2] = this.fightAgents.get(fightId) ?? [null, null];

    if (winner !== null) {
      const winnerAgent = this.agents.get(winner);
      const loser = winner === agentId1 ? agentId2 : agentId1;
      const loserAgent = this.agents.get(loser);

      if (winnerAgent) winnerAgent.wins++;
      if (loserAgent) loserAgent.losses++;

      return { winner, loser };
    }

    return { winner: null, loser: null };
  }

  resolveSideBets(fightId: string): ResolutionResult {
    const fight = this.fights.get(fightId);
    this.recordFightResult(fightId);
    if (!fight) throw new Error("Fight not found");

    const winner = fight.getWinner();
    const state = fight.getState();
    if (state.status !== "fight_over") throw new Error("Fight not over yet");

    const bets = this.sideBets.get(fightId) ?? [];
    if (bets.length === 0) {
      return {
        fightId,
        winner,
        totalPool: 0,
        rake: 0,
        netPool: 0,
        payouts: [],
      };
    }

    const RAKE_RATE = SIDE_BET_RAKE;
    const payouts: Payout[] = [];

    // Calculate totals
    const totalPool = bets.reduce((sum, bet) => sum + bet.amount, 0);

    // Handle draw case
    if (winner === null) {
      for (const bet of bets) {
        bet.status = "refunded";
        payouts.push({
          betId: bet.id,
          walletAddress: bet.walletAddress,
          backedAgent: bet.backedAgent,
          betAmount: bet.amount,
          payout: bet.amount,
          status: "refunded",
        });
      }
      return {
        fightId,
        winner: null,
        totalPool,
        rake: 0,
        netPool: totalPool,
        payouts,
      };
    }

    // Calculate winner side total
    const winnerSideTotal = bets
      .filter((bet) => bet.backedAgent === winner)
      .reduce((sum, bet) => sum + bet.amount, 0);

    let rake = Math.round(totalPool * RAKE_RATE * 100) / 100;
    let netPool = totalPool - rake;

    // If all bets on losing side, refund everyone
    if (winnerSideTotal === 0) {
      rake = 0;
      netPool = totalPool;
      for (const bet of bets) {
        bet.status = "refunded";
        payouts.push({
          betId: bet.id,
          walletAddress: bet.walletAddress,
          backedAgent: bet.backedAgent,
          betAmount: bet.amount,
          payout: bet.amount,
          status: "refunded",
        });
      }
    } else {
      // Normal payout distribution
      for (const bet of bets) {
        if (bet.backedAgent === winner) {
          const payout = Math.round((bet.amount / winnerSideTotal) * netPool * 100) / 100;
          bet.status = "won";
          payouts.push({
            betId: bet.id,
            walletAddress: bet.walletAddress,
            backedAgent: bet.backedAgent,
            betAmount: bet.amount,
            payout,
            status: "won",
          });
        } else {
          bet.status = "lost";
          payouts.push({
            betId: bet.id,
            walletAddress: bet.walletAddress,
            backedAgent: bet.backedAgent,
            betAmount: bet.amount,
            payout: 0,
            status: "lost",
          });
        }
      }
    }

    return {
      fightId,
      winner,
      totalPool,
      rake,
      netPool,
      payouts,
    };
  }


  cleanExpiredChallenges(): number {
    let count = 0;
    for (const [, challenge] of this.challenges) {
      if (challenge.status === "pending" && Date.now() > challenge.expiresAt) {
        challenge.status = "expired";
        count++;
      }
    }
    return count;
  }
}

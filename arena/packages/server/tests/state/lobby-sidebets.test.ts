import { describe, it, expect, beforeEach } from "vitest";
import { Lobby, SIDE_BET_RAKE } from "../../src/state/lobby.js";
import { Fight } from "../../src/combat/fight.js";

function createFightWithBets(lobby: Lobby, bets: Array<{ wallet: string; agent: string; amount: number }>): string {
  lobby.registerAgent("a", "#A", "0x1", "default");
  lobby.registerAgent("b", "#B", "0x2", "default");
  const challenge = lobby.createChallenge("a", "b", 10);
  const fight = lobby.acceptChallenge(challenge.id, "b");
  const fightId = fight.getState().fightId;

  // Place bets while fight is active
  for (const bet of bets) {
    lobby.placeSideBet(fightId, bet.wallet, bet.agent, bet.amount);
  }

  // Now run fight to completion: a always heavy_punch, b always taunt -> a wins
  for (let round = 0; round < 2; round++) {
    while (fight.getState().status === "waiting_for_actions") {
      fight.submitAction("a", "heavy_punch");
      fight.submitAction("b", "taunt");
    }
    if (fight.getState().status === "round_over") fight.nextRound();
  }

  return fightId;
}

describe("Lobby.resolveSideBets", () => {
  let lobby: Lobby;

  beforeEach(() => {
    lobby = new Lobby();
  });

  it("pays winners proportionally from pool minus rake", () => {
    const fightId = createFightWithBets(lobby, [
      { wallet: "0xbet1", agent: "a", amount: 30 },
      { wallet: "0xbet2", agent: "a", amount: 20 },
      { wallet: "0xbet3", agent: "b", amount: 50 },
    ]);

    const result = lobby.resolveSideBets(fightId);

    expect(result.winner).toBe("a");
    expect(result.totalPool).toBe(100);
    expect(result.rake).toBe(3); // 3%
    expect(result.netPool).toBe(97);

    const p1 = result.payouts.find(p => p.walletAddress === "0xbet1")!;
    const p2 = result.payouts.find(p => p.walletAddress === "0xbet2")!;
    const p3 = result.payouts.find(p => p.walletAddress === "0xbet3")!;

    // 0xbet1 bet $30 out of $50 winning side = 60% of $97 = $58.20
    expect(p1.status).toBe("won");
    expect(p1.payout).toBe(58.2);

    // 0xbet2 bet $20 out of $50 winning side = 40% of $97 = $38.80
    expect(p2.status).toBe("won");
    expect(p2.payout).toBe(38.8);

    // 0xbet3 backed loser
    expect(p3.status).toBe("lost");
    expect(p3.payout).toBe(0);
  });

  it("updates bet statuses in the lobby", () => {
    const fightId = createFightWithBets(lobby, [
      { wallet: "0xbet1", agent: "a", amount: 10 },
      { wallet: "0xbet2", agent: "b", amount: 10 },
    ]);

    lobby.resolveSideBets(fightId);

    const { bets } = lobby.getSideBets(fightId);
    const winner = bets.find(b => b.backedAgent === "a")!;
    const loser = bets.find(b => b.backedAgent === "b")!;
    expect(winner.status).toBe("won");
    expect(loser.status).toBe("lost");
  });

  it("throws if fight not found", () => {
    expect(() => lobby.resolveSideBets("nonexistent")).toThrow("Fight not found");
  });

  it("throws if fight not over", () => {
    const fightId = setupActiveFight(lobby);
    expect(() => lobby.resolveSideBets(fightId)).toThrow("Fight not over yet");
  });

  it("returns empty payouts when no bets placed", () => {
    const fightId = createFightWithBets(lobby, []);
    const result = lobby.resolveSideBets(fightId);

    expect(result.payouts).toHaveLength(0);
    expect(result.totalPool).toBe(0);
    expect(result.rake).toBe(0);
    expect(result.netPool).toBe(0);
  });

  it("refunds all bets when all bets are on losing side", () => {
    const fightId = createFightWithBets(lobby, [
      { wallet: "0xbet1", agent: "b", amount: 25 },
      { wallet: "0xbet2", agent: "b", amount: 15 },
    ]);

    const result = lobby.resolveSideBets(fightId);

    // No one backed the winner, so refund everyone
    expect(result.rake).toBe(0);
    for (const p of result.payouts) {
      expect(p.status).toBe("refunded");
      expect(p.payout).toBe(p.betAmount);
    }
  });

  it("handles single winner taking entire net pool", () => {
    const fightId = createFightWithBets(lobby, [
      { wallet: "0xbet1", agent: "a", amount: 10 },
      { wallet: "0xbet2", agent: "b", amount: 90 },
    ]);

    const result = lobby.resolveSideBets(fightId);

    expect(result.totalPool).toBe(100);
    expect(result.rake).toBe(3);

    const winner = result.payouts.find(p => p.walletAddress === "0xbet1")!;
    expect(winner.payout).toBe(97); // entire net pool
    expect(winner.status).toBe("won");
  });

  it("handles all bets on winning side (everyone wins smaller)", () => {
    const fightId = createFightWithBets(lobby, [
      { wallet: "0xbet1", agent: "a", amount: 60 },
      { wallet: "0xbet2", agent: "a", amount: 40 },
    ]);

    const result = lobby.resolveSideBets(fightId);

    expect(result.totalPool).toBe(100);
    expect(result.rake).toBe(3);

    const p1 = result.payouts.find(p => p.walletAddress === "0xbet1")!;
    const p2 = result.payouts.find(p => p.walletAddress === "0xbet2")!;

    // 60% of $97 = $58.20, 40% of $97 = $38.80
    expect(p1.payout).toBe(58.2);
    expect(p2.payout).toBe(38.8);
  });

  it("SIDE_BET_RAKE constant is 0.03", () => {
    expect(SIDE_BET_RAKE).toBe(0.03);
  });

  it("increments winner wins and loser losses after resolveSideBets", () => {
    const fightId = createFightWithBets(lobby, [
      { wallet: "0xbet1", agent: "a", amount: 10 },
      { wallet: "0xbet2", agent: "b", amount: 10 },
    ]);

    // Before resolution
    expect(lobby.agents.get("a")!.wins).toBe(0);
    expect(lobby.agents.get("a")!.losses).toBe(0);
    expect(lobby.agents.get("b")!.wins).toBe(0);
    expect(lobby.agents.get("b")!.losses).toBe(0);

    // Resolve the bets (which should call recordFightResult)
    const result = lobby.resolveSideBets(fightId);

    // After resolution, agent a should have 1 win, agent b should have 1 loss
    expect(result.winner).toBe("a");
    expect(lobby.agents.get("a")!.wins).toBe(1);
    expect(lobby.agents.get("a")!.losses).toBe(0);
    expect(lobby.agents.get("b")!.wins).toBe(0);
    expect(lobby.agents.get("b")!.losses).toBe(1);
  });

});

// Helper for "fight not over" test
function setupActiveFight(lobby: Lobby): string {
  lobby.registerAgent("a", "#A", "0x1", "default");
  lobby.registerAgent("b", "#B", "0x2", "default");
  const challenge = lobby.createChallenge("a", "b", 10);
  const fight = lobby.acceptChallenge(challenge.id, "b");
  return fight.getState().fightId;
}

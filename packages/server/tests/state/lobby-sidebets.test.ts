import { describe, it, expect, beforeEach, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";

const txMock = {
  bet: {
    findMany: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  user: {
    update: vi.fn().mockResolvedValue({}),
  },
  transaction: {
    create: vi.fn().mockResolvedValue({}),
  },
  treasuryEntry: {
    create: vi.fn().mockResolvedValue({}),
  },
};

vi.mock("../../src/db/client.js", () => ({
  prisma: {
    $transaction: (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
  },
}));

import { BetManager } from "../../src/state/bet-manager.js";

describe("BetManager.resolveBets", () => {
  let manager: BetManager;

  beforeEach(() => {
    manager = new BetManager();
    vi.clearAllMocks();
  });

  it("pays winners proportionally from net pool (post-rake)", async () => {
    txMock.bet.findMany.mockResolvedValue([
      { id: "b1", walletAddress: "w1", backedAgentId: "a", amount: new Decimal(30), status: "active" },
      { id: "b2", walletAddress: "w2", backedAgentId: "a", amount: new Decimal(20), status: "active" },
      { id: "b3", walletAddress: "w3", backedAgentId: "b", amount: new Decimal(50), status: "active" },
    ]);

    const result = await manager.resolveBets("fight_1", "a");

    expect(result.totalPool.equals(new Decimal(100))).toBe(true);
    expect(result.rake.equals(new Decimal(3))).toBe(true);

    const p1 = result.payouts.find((p) => p.walletAddress === "w1");
    const p2 = result.payouts.find((p) => p.walletAddress === "w2");
    const p3 = result.payouts.find((p) => p.walletAddress === "w3");

    expect(p1?.status).toBe("won");
    expect(p1?.payout.equals(new Decimal("58.2"))).toBe(true);
    expect(p2?.status).toBe("won");
    expect(p2?.payout.equals(new Decimal("38.8"))).toBe(true);
    expect(p3?.status).toBe("lost");
    expect(p3?.payout.equals(new Decimal(0))).toBe(true);
  });

  it("refunds all bets on draw", async () => {
    txMock.bet.findMany.mockResolvedValue([
      { id: "b1", walletAddress: "w1", backedAgentId: "a", amount: new Decimal(40), status: "active" },
      { id: "b2", walletAddress: "w2", backedAgentId: "b", amount: new Decimal(60), status: "active" },
    ]);

    const result = await manager.resolveBets("fight_2", null);

    expect(result.rake.equals(new Decimal(0))).toBe(true);
    expect(result.payouts.every((p) => p.status === "refunded")).toBe(true);
    expect(result.payouts.every((p) => p.payout.equals(p.amount))).toBe(true);
  });

  it("refunds all bets when no one backed the winner", async () => {
    txMock.bet.findMany.mockResolvedValue([
      { id: "b1", walletAddress: "w1", backedAgentId: "b", amount: new Decimal(25), status: "active" },
      { id: "b2", walletAddress: "w2", backedAgentId: "b", amount: new Decimal(15), status: "active" },
    ]);

    const result = await manager.resolveBets("fight_3", "a");

    expect(result.rake.equals(new Decimal(0))).toBe(true);
    expect(result.payouts.every((p) => p.status === "refunded")).toBe(true);
  });
});

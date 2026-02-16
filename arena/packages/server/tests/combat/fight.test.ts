import { describe, it, expect } from "vitest";
import { Fight } from "../../src/combat/fight.js";

describe("Fight", () => {
  it("initializes with correct state", () => {
    const f = new Fight("f1", "a", "b");
    const s = f.getState();
    expect(s.round).toBe(1);
    expect(s.exchange).toBe(1);
    expect(s.p1.hp).toBe(100);
    expect(s.p2.hp).toBe(100);
    expect(s.p1.stamina).toBe(100);
    expect(s.status).toBe("waiting_for_actions");
  });

  it("waits for both actions before resolving", () => {
    const f = new Fight("f1", "a", "b");
    const r1 = f.submitAction("a", "light_punch");
    expect(r1).toBeNull();
    expect(f.getState().status).toBe("waiting_for_actions");
    const r2 = f.submitAction("b", "block_high");
    expect(r2).not.toBeNull();
    expect(r2!.narrative).toBeTruthy();
  });

  it("advances exchange counter after resolution", () => {
    const f = new Fight("f1", "a", "b");
    f.submitAction("a", "light_punch");
    f.submitAction("b", "light_kick");
    expect(f.getState().exchange).toBe(2);
  });

  it("rejects actions from non-participants", () => {
    const f = new Fight("f1", "a", "b");
    expect(() => f.submitAction("c", "light_punch")).toThrow("not in this fight");
  });

  it("rejects duplicate actions in same exchange", () => {
    const f = new Fight("f1", "a", "b");
    f.submitAction("a", "light_punch");
    expect(() => f.submitAction("a", "heavy_kick")).toThrow("already submitted");
  });

  it("rejects invalid action names", () => {
    const f = new Fight("f1", "a", "b");
    expect(() => f.submitAction("a", "hadouken" as any)).toThrow("Invalid action");
  });

  it("detects round end when HP reaches 0", () => {
    const f = new Fight("f1", "a", "b");
    // Heavy punch vs taunt = free damage, drains HP fast
    for (let i = 0; i < 30; i++) {
      const s = f.getState();
      if (s.status !== "waiting_for_actions") break;
      f.submitAction("a", "heavy_punch");
      f.submitAction("b", "taunt");
    }
    const s = f.getState();
    expect(s.p2.hp).toBe(0);
    expect(["round_over", "fight_over"]).toContain(s.status);
  });

  it("best of 3: fight ends after 2 round wins", () => {
    const f = new Fight("f1", "a", "b");
    for (let round = 0; round < 2; round++) {
      while (f.getState().status === "waiting_for_actions") {
        f.submitAction("a", "heavy_punch");
        f.submitAction("b", "taunt");
      }
      if (f.getState().status === "round_over") {
        f.nextRound();
      }
    }
    expect(f.getState().status).toBe("fight_over");
    expect(f.getWinner()).toBe("a");
    expect(f.getState().p1.roundWins).toBe(2);
  });

  it("nextRound resets HP and stamina", () => {
    const f = new Fight("f1", "a", "b");
    // Drain some HP in round 1
    f.submitAction("a", "light_punch");
    f.submitAction("b", "light_kick");
    expect(f.getState().p1.hp).toBeLessThan(100);

    // Force round end by KO
    while (f.getState().status === "waiting_for_actions") {
      f.submitAction("a", "heavy_punch");
      f.submitAction("b", "taunt");
    }
    f.nextRound();
    expect(f.getState().p1.hp).toBe(100);
    expect(f.getState().p2.hp).toBe(100);
    expect(f.getState().round).toBe(2);
    expect(f.getState().exchange).toBe(1);
  });

  it("cannot call nextRound when fight is not round_over", () => {
    const f = new Fight("f1", "a", "b");
    expect(() => f.nextRound()).toThrow("Cannot start next round");
  });

  it("getWinner returns null during active fight", () => {
    const f = new Fight("f1", "a", "b");
    expect(f.getWinner()).toBeNull();
  });

  it("records full exchange history", () => {
    const f = new Fight("f1", "a", "b");
    f.submitAction("a", "light_punch");
    f.submitAction("b", "heavy_kick");
    f.submitAction("a", "block_high");
    f.submitAction("b", "light_kick");

    const h = f.getState().history;
    expect(h).toHaveLength(2);
    expect(h[0].p1Action).toBe("light_punch");
    expect(h[0].p2Action).toBe("heavy_kick");
    expect(h[1].p1Action).toBe("block_high");
    expect(h[1].p2Action).toBe("light_kick");
  });

  it("handles max exchanges timeout (round ends at 20)", () => {
    const f = new Fight("f1", "a", "b");
    // Both block every exchange — no damage, but exchange counter ticks up
    for (let i = 0; i < 20; i++) {
      if (f.getState().status !== "waiting_for_actions") break;
      f.submitAction("a", "block_high");
      f.submitAction("b", "block_low");
    }
    // After 20 exchanges of pure blocking, round should be over
    expect(f.getState().status).not.toBe("waiting_for_actions");
  });
});

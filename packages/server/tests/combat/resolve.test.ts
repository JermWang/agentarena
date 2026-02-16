import { describe, it, expect } from "vitest";
import { resolveExchange } from "../../src/combat/resolve.js";

function s(hp = 100, stamina = 100) {
  return { hp, stamina };
}

describe("resolveExchange", () => {
  // --- Core priority triangle ---

  it("light attack interrupts heavy attack", () => {
    const r = resolveExchange("light_punch", "heavy_punch", s(), s());
    expect(r.p1Damage).toBeGreaterThan(0);
    expect(r.p2Damage).toBe(0);
  });

  it("heavy attack breaks block (guard break)", () => {
    const r = resolveExchange("heavy_punch", "block_high", s(), s());
    expect(r.p1Damage).toBeGreaterThan(0);
    expect(r.p2Damage).toBe(0);
  });

  it("guard break does reduced damage (60%)", () => {
    const r = resolveExchange("heavy_punch", "block_high", s(), s());
    expect(r.p1Damage).toBe(9); // 15 * 0.6 = 9
  });

  it("block absorbs light attack", () => {
    const r = resolveExchange("light_punch", "block_high", s(), s());
    expect(r.p1Damage).toBe(0);
    expect(r.p2Damage).toBe(0);
  });

  // --- Dodges ---

  it("dodge avoids any attack", () => {
    const r = resolveExchange("dodge_back", "heavy_kick", s(), s());
    expect(r.p1Damage).toBe(0);
    expect(r.p2Damage).toBe(0);
  });

  it("dodge avoids special", () => {
    const r = resolveExchange("uppercut", "dodge_forward", s(), s());
    expect(r.p1Damage).toBe(0);
    expect(r.p2Damage).toBe(0);
  });

  it("both dodge — nothing happens", () => {
    const r = resolveExchange("dodge_back", "dodge_forward", s(), s());
    expect(r.p1Damage).toBe(0);
    expect(r.p2Damage).toBe(0);
  });

  // --- Trades (same category) ---

  it("both light attacks — both land", () => {
    const r = resolveExchange("light_punch", "light_kick", s(), s());
    expect(r.p1Damage).toBe(8);
    expect(r.p2Damage).toBe(10);
  });

  it("both heavy attacks — both land (big damage)", () => {
    const r = resolveExchange("heavy_punch", "heavy_kick", s(), s());
    expect(r.p1Damage).toBe(15);
    expect(r.p2Damage).toBe(18);
  });

  it("both block — stalemate", () => {
    const r = resolveExchange("block_high", "block_low", s(), s());
    expect(r.p1Damage).toBe(0);
    expect(r.p2Damage).toBe(0);
  });

  // --- Specials ---

  it("special breaks block", () => {
    const r = resolveExchange("uppercut", "block_high", s(), s());
    expect(r.p1Damage).toBe(20);
    expect(r.p2Damage).toBe(0);
  });

  it("attack punishes special (slow wind-up)", () => {
    const r = resolveExchange("light_punch", "uppercut", s(), s());
    expect(r.p1Damage).toBeGreaterThan(0);
    expect(r.p2Damage).toBe(0);
  });

  it("both specials — both land", () => {
    const r = resolveExchange("uppercut", "sweep", s(), s());
    expect(r.p1Damage).toBe(20);
    expect(r.p2Damage).toBe(14);
  });

  // --- Taunt ---

  it("taunt gives stamina but is vulnerable", () => {
    const r = resolveExchange("taunt", "light_punch", s(100, 50), s());
    expect(r.p2Damage).toBeGreaterThan(0); // taunter gets hit
    expect(r.p1StaminaChange).toBeGreaterThan(0); // but gains stamina
  });

  it("taunt vs taunt — both regen stamina", () => {
    const r = resolveExchange("taunt", "taunt", s(100, 30), s(100, 30));
    expect(r.p1StaminaChange).toBeGreaterThan(15);
    expect(r.p2StaminaChange).toBeGreaterThan(15);
    expect(r.p1Damage).toBe(0);
    expect(r.p2Damage).toBe(0);
  });

  // --- Stamina system ---

  it("low stamina reduces damage output", () => {
    const full = resolveExchange("light_punch", "light_kick", s(100, 100), s(100, 100));
    const low = resolveExchange("light_punch", "light_kick", s(100, 5), s(100, 100));
    expect(low.p1Damage).toBeLessThan(full.p1Damage);
    expect(low.p1Damage).toBe(4); // 8 * 0.5 = 4
  });

  it("deducts stamina cost from both players", () => {
    const r = resolveExchange("heavy_punch", "light_kick", s(), s());
    expect(r.p1StaminaChange).toBeLessThan(0); // heavy costs 12, regen 3 = -9
    expect(r.p2StaminaChange).toBeLessThan(0); // kick costs 6, regen 3 = -3
  });

  it("stamina cost is correct: heavy_punch = -9 net", () => {
    const r = resolveExchange("heavy_punch", "block_high", s(), s());
    expect(r.p1StaminaChange).toBe(-12 + 3); // -9
  });

  // --- Narrative generation ---

  it("generates narrative for every exchange", () => {
    const r = resolveExchange("light_punch", "heavy_kick", s(), s());
    expect(r.narrative).toBeTruthy();
    expect(r.narrative.length).toBeGreaterThan(0);
  });

  // --- Symmetry check ---

  it("resolution is symmetric (swapping players swaps results)", () => {
    const r1 = resolveExchange("light_punch", "heavy_kick", s(), s());
    const r2 = resolveExchange("heavy_kick", "light_punch", s(), s());
    expect(r1.p1Damage).toBe(r2.p2Damage);
    expect(r1.p2Damage).toBe(r2.p1Damage);
  });
});

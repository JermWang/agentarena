import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/db/client.js", () => ({
  prisma: {
    pitLog: {
      create: vi.fn().mockResolvedValue({ id: "log_1" }),
    },
  },
}));

import { Pit } from "../../src/state/pit.js";

describe("Pit callout lifecycle", () => {
  let pit: Pit;

  const ws = () => ({ readyState: 1, send: vi.fn() }) as any;

  beforeEach(() => {
    pit = new Pit();
    pit.agents.set("challenger", {
      ws: ws(),
      agentId: "challenger",
      username: "challenger_user",
      characterId: "ronin",
      elo: 1000,
      wins: 0,
      losses: 0,
    });
    pit.agents.set("target", {
      ws: ws(),
      agentId: "target",
      username: "target_user",
      characterId: "knight",
      elo: 1000,
      wins: 0,
      losses: 0,
    });
  });

  it("creates a callout that expires in ~60 seconds", () => {
    const before = Date.now();
    const result = pit.createCallout("challenger", "target_user", 50000, "fight me");
    const after = Date.now();

    expect(result.ok).toBe(true);
    expect(result.callout).toBeDefined();
    expect(result.callout!.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(result.callout!.expiresAt).toBeLessThanOrEqual(after + 60_000);
  });

  it("rate limits repeated callouts from the same agent (8s)", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    const first = pit.createCallout("challenger", "target_user", 50000, "first");
    const second = pit.createCallout("challenger", "target_user", 50000, "second");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/rate limited/i);

    nowSpy.mockRestore();
  });

  it("rejects accept when the callout is expired", () => {
    const created = pit.createCallout("challenger", "target_user", 50000, "expired soon");
    expect(created.ok).toBe(true);

    created.callout!.expiresAt = Date.now() - 1;

    const accepted = pit.acceptCallout(created.callout!.id, "target");
    expect(accepted.ok).toBe(false);
    expect(accepted.error).toMatch(/expired/i);
  });

  it("cleanExpired removes only expired callouts", () => {
    const c1 = pit.createCallout("challenger", "target_user", 50000, "one").callout!;
    c1.expiresAt = Date.now() - 1;

    // Move time forward to avoid callout rate-limit for c2 creation
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 9_000);
    const c2 = pit.createCallout("challenger", "target_user", 50000, "two").callout!;
    nowSpy.mockRestore();

    c2.expiresAt = Date.now() + 30_000;

    pit.cleanExpired();

    expect(pit.callouts.has(c1.id)).toBe(false);
    expect(pit.callouts.has(c2.id)).toBe(true);
  });
});

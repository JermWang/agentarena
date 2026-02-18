import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createRouter } from "../../src/api/routes.js";
import { Pit } from "../../src/state/pit.js";
import { FightManager } from "../../src/state/fight-manager.js";
import { BetManager } from "../../src/state/bet-manager.js";

describe("Arena API", () => {
  let app: express.Express;
  let pit: Pit;
  let fightManager: FightManager;

  const ws = () => ({ readyState: 1, send: vi.fn() }) as any;

  beforeEach(() => {
    pit = new Pit();
    fightManager = new FightManager();
    app = express();
    app.use(express.json());
    app.use("/api/v1", createRouter({ pit, fightManager, betManager: new BetManager() }));
  });

  it("GET /arena/agents returns current pit agents", async () => {
    pit.agents.set("agent_a", {
      ws: ws(),
      agentId: "agent_a",
      username: "alpha",
      characterId: "ronin",
      elo: 1100,
      wins: 3,
      losses: 1,
    });

    const res = await request(app).get("/api/v1/arena/agents");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agents).toHaveLength(1);
    expect(res.body.agents[0].username).toBe("alpha");
  });

  it("GET /arena/fights returns active fights with usernames", async () => {
    pit.agents.set("agent_a", {
      ws: ws(),
      agentId: "agent_a",
      username: "alpha",
      characterId: "ronin",
      elo: 1100,
      wins: 3,
      losses: 1,
    });
    pit.agents.set("agent_b", {
      ws: ws(),
      agentId: "agent_b",
      username: "bravo",
      characterId: "knight",
      elo: 1080,
      wins: 2,
      losses: 2,
    });

    fightManager.activeFights.set("fight_1", {
      fight: {} as any,
      agent1Id: "agent_a",
      agent2Id: "agent_b",
      fightId: "fight_1",
      wager: 50000,
    });

    const res = await request(app).get("/api/v1/arena/fights");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.fights).toHaveLength(1);
    expect(res.body.fights[0]).toMatchObject({
      fightId: "fight_1",
      agent1: "alpha",
      agent2: "bravo",
      wager: 50000,
    });
  });
});

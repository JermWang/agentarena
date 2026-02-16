import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createRouter } from "../../src/api/routes.js";
import { Lobby } from "../../src/state/lobby.js";

describe("Arena API", () => {
  let app: express.Express;
  let lobby: Lobby;

  beforeEach(() => {
    lobby = new Lobby();
    app = express();
    app.use(express.json());
    app.use("/api/v1", createRouter(lobby));
  });

  it("POST /arena/register creates agent", async () => {
    const res = await request(app).post("/api/v1/arena/register").send({
      agent_id: "bot_1",
      skills_md: "# Bot 1\nAggressive",
      wallet_address: "0x" + "a".repeat(40),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agent.id).toBe("bot_1");
  });

  it("POST /arena/register rejects duplicate", async () => {
    const body = { agent_id: "bot_1", skills_md: "# Bot", wallet_address: "0xaaa" };
    await request(app).post("/api/v1/arena/register").send(body);
    const res = await request(app).post("/api/v1/arena/register").send(body);
    expect(res.status).toBe(400);
  });

  it("GET /arena/agents lists registered agents", async () => {
    await request(app).post("/api/v1/arena/register").send({ agent_id: "a", skills_md: "#A", wallet_address: "0x1" });
    await request(app).post("/api/v1/arena/register").send({ agent_id: "b", skills_md: "#B", wallet_address: "0x2" });
    const res = await request(app).get("/api/v1/arena/agents");
    expect(res.body.agents).toHaveLength(2);
  });

  it("full fight flow: register → challenge → accept → fight → winner", async () => {
    await request(app).post("/api/v1/arena/register").send({ agent_id: "a", skills_md: "#A", wallet_address: "0x1" });
    await request(app).post("/api/v1/arena/register").send({ agent_id: "b", skills_md: "#B", wallet_address: "0x2" });

    const challenge = await request(app).post("/api/v1/arena/challenge").send({
      agent_id: "a", target_agent_id: "b", wager_amount: 10,
    });
    expect(challenge.body.ok).toBe(true);

    const accept = await request(app).post("/api/v1/arena/accept").send({
      agent_id: "b", challenge_id: challenge.body.challenge.id,
    });
    expect(accept.body.ok).toBe(true);
    const fightId = accept.body.fight_id;

    // Verify fight appears in active list
    const fights = await request(app).get("/api/v1/arena/fights");
    expect(fights.body.fights).toHaveLength(1);

    // Play until fight ends
    let state = accept.body.state;
    while (state.status !== "fight_over") {
      await request(app).post("/api/v1/arena/action").send({ agent_id: "a", fight_id: fightId, action: "heavy_punch" });
      const r = await request(app).post("/api/v1/arena/action").send({ agent_id: "b", fight_id: fightId, action: "taunt" });
      state = r.body.state;
      if (state.status === "round_over") {
        await request(app).post("/api/v1/arena/next-round").send({ fight_id: fightId });
        state = lobby.getFight(fightId)!.getState();
      }
    }
    expect(state.status).toBe("fight_over");
    expect(state.p1.roundWins).toBe(2);
  });

  // --- Side Bets ---

  function setupFight() {
    lobby.registerAgent("a", "#A", "0x1", "default");
    lobby.registerAgent("b", "#B", "0x2", "default");
    const challenge = lobby.createChallenge("a", "b", 10);
    const fight = lobby.acceptChallenge(challenge.id, "b");
    return fight.getState().fightId;
  }

  it("POST /arena/side-bet places a valid bet", async () => {
    const fightId = setupFight();
    const res = await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId,
      wallet_address: "0xbettor1",
      backed_agent: "a",
      amount: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.bet.backedAgent).toBe("a");
    expect(res.body.bet.amount).toBe(10);
    expect(res.body.pool.p1).toBe(10);
    expect(res.body.pool.p2).toBe(0);
  });

  it("GET /arena/side-bets/:fightId returns pool state", async () => {
    const fightId = setupFight();
    lobby.placeSideBet(fightId, "0xbet1", "a", 20);
    lobby.placeSideBet(fightId, "0xbet2", "b", 30);

    const res = await request(app).get(`/api/v1/arena/side-bets/${fightId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.bets).toHaveLength(2);
    expect(res.body.pool.p1).toBe(20);
    expect(res.body.pool.p2).toBe(30);
  });

  it("side-bet rejects invalid fight ID", async () => {
    const res = await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: "nonexistent",
      wallet_address: "0xbettor",
      backed_agent: "a",
      amount: 5,
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("side-bet rejects agent not in fight", async () => {
    const fightId = setupFight();
    lobby.registerAgent("c", "#C", "0x3", "default");

    const res = await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId,
      wallet_address: "0xbettor",
      backed_agent: "c",
      amount: 5,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not in this fight/i);
  });

  it("side-bet rejects negative/zero amount", async () => {
    const fightId = setupFight();
    const res = await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId,
      wallet_address: "0xbettor",
      backed_agent: "a",
      amount: 0,
    });
    expect(res.status).toBe(400);
  });

  it("side-bet rejects bets on finished fights", async () => {
    const fightId = setupFight();
    const fight = lobby.getFight(fightId)!;

    // Run fight to completion
    for (let round = 0; round < 2; round++) {
      while (fight.getState().status === "waiting_for_actions") {
        fight.submitAction("a", "heavy_punch");
        fight.submitAction("b", "taunt");
      }
      if (fight.getState().status === "round_over") fight.nextRound();
    }
    expect(fight.getState().status).toBe("fight_over");

    const res = await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId,
      wallet_address: "0xbettor",
      backed_agent: "a",
      amount: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already over/i);
  });

  it("pool accumulates multiple bets on same side", async () => {
    const fightId = setupFight();

    await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId, wallet_address: "0xbet1", backed_agent: "a", amount: 10,
    });
    await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId, wallet_address: "0xbet2", backed_agent: "a", amount: 15,
    });
    await request(app).post("/api/v1/arena/side-bet").send({
      fight_id: fightId, wallet_address: "0xbet3", backed_agent: "b", amount: 50,
    });

    const res = await request(app).get(`/api/v1/arena/side-bets/${fightId}`);
    expect(res.body.bets).toHaveLength(3);
    expect(res.body.pool.p1).toBe(25);
    expect(res.body.pool.p2).toBe(50);
  });

  it("empty pool returns zeros", async () => {
    const fightId = setupFight();
    const res = await request(app).get(`/api/v1/arena/side-bets/${fightId}`);
    expect(res.body.bets).toHaveLength(0);
    expect(res.body.pool.p1).toBe(0);
    expect(res.body.pool.p2).toBe(0);
  });

  it("POST /arena/resolve-bets/:fightId resolves payouts", async () => {
    const fightId = setupFight();
    const fight = lobby.getFight(fightId)!;

    // Place bets while fight is active
    lobby.placeSideBet(fightId, "0xbet1", "a", 40);
    lobby.placeSideBet(fightId, "0xbet2", "b", 60);

    // Run fight to completion (a wins)
    for (let round = 0; round < 2; round++) {
      while (fight.getState().status === "waiting_for_actions") {
        fight.submitAction("a", "heavy_punch");
        fight.submitAction("b", "taunt");
      }
      if (fight.getState().status === "round_over") fight.nextRound();
    }

    const res = await request(app).post(`/api/v1/arena/resolve-bets/${fightId}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.winner).toBe("a");
    expect(res.body.totalPool).toBe(100);
    expect(res.body.rake).toBe(3);
    expect(res.body.payouts).toHaveLength(2);
  });

  it("fight-ending action auto-resolves side bets", async () => {
    await request(app).post("/api/v1/arena/register").send({ agent_id: "x", skills_md: "#X", wallet_address: "0x1" });
    await request(app).post("/api/v1/arena/register").send({ agent_id: "y", skills_md: "#Y", wallet_address: "0x2" });

    const challenge = await request(app).post("/api/v1/arena/challenge").send({
      agent_id: "x", target_agent_id: "y", wager_amount: 10,
    });
    const accept = await request(app).post("/api/v1/arena/accept").send({
      agent_id: "y", challenge_id: challenge.body.challenge.id,
    });
    const fightId = accept.body.fight_id;

    // Place a bet
    lobby.placeSideBet(fightId, "0xspectator", "x", 25);

    // Play fight through API until it ends
    let lastRes: any;
    for (let i = 0; i < 100; i++) {
      await request(app).post("/api/v1/arena/action").send({ agent_id: "x", fight_id: fightId, action: "heavy_punch" });
      lastRes = await request(app).post("/api/v1/arena/action").send({ agent_id: "y", fight_id: fightId, action: "taunt" });

      if (lastRes.body.state?.status === "round_over") {
        await request(app).post("/api/v1/arena/next-round").send({ fight_id: fightId });
      }
      if (lastRes.body.state?.status === "fight_over") break;
    }

    // The final action response should include resolution
    expect(lastRes.body.state.status).toBe("fight_over");
    expect(lastRes.body.resolution).toBeDefined();
    expect(lastRes.body.resolution.winner).toBe("x");
    expect(lastRes.body.resolution.payouts).toHaveLength(1);
    expect(lastRes.body.resolution.payouts[0].status).toBe("won");
  });
});

/**
 * Agent Battle Arena — Demo Fight
 * Simulates a full fight between two bot agents via the REST API.
 *
 * Usage: npx tsx packages/server/scripts/demo-fight.ts
 * Requires: server running on port 3001
 */

const SERVER = process.env.SERVER_URL ?? "http://localhost:3001";
const ACTIONS = [
  "light_punch", "heavy_punch", "light_kick", "heavy_kick",
  "block_high", "block_low", "dodge_back", "dodge_forward",
  "uppercut", "sweep", "grab", "taunt",
];

async function post(path: string, body: unknown) {
  const r = await fetch(`${SERVER}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path: string) {
  const r = await fetch(`${SERVER}/api/v1${path}`);
  return r.json();
}

function pick(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Simple agent strategy: slightly weighted toward attacks
function aggressiveAction() {
  const r = Math.random();
  if (r < 0.5) return pick(["light_punch", "heavy_punch", "light_kick", "heavy_kick"]);
  if (r < 0.7) return pick(["block_high", "block_low"]);
  if (r < 0.85) return pick(["dodge_back", "dodge_forward"]);
  return pick(["uppercut", "sweep", "grab"]);
}

function defensiveAction() {
  const r = Math.random();
  if (r < 0.4) return pick(["block_high", "block_low"]);
  if (r < 0.6) return pick(["dodge_back", "dodge_forward"]);
  if (r < 0.85) return pick(["light_punch", "light_kick"]);
  return pick(["uppercut", "sweep", "grab", "taunt"]);
}

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║     AGENT BATTLE ARENA — DEMO        ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Register
  console.log("Registering agents...");
  await post("/arena/register", {
    agent_id: "shadow_puncher",
    skills_md: "# Shadow Puncher\n## Style\nAggressive counter-fighter. Reads patterns, punishes hard.\n## Trash Talk\nYour code has more bugs than moves.",
    wallet_address: "0x" + "a".repeat(40),
    character_preference: "ronin",
  });
  await post("/arena/register", {
    agent_id: "iron_guard",
    skills_md: "# Iron Guard\n## Style\nDefensive wall. Patient. Waits for mistakes.\n## Trash Talk\nI've seen better AI from a calculator.",
    wallet_address: "0x" + "b".repeat(40),
    character_preference: "knight",
  });
  console.log("  shadow_puncher (aggressive) vs iron_guard (defensive)\n");

  // Challenge
  const ch = await post("/arena/challenge", {
    agent_id: "shadow_puncher",
    target_agent_id: "iron_guard",
    wager_amount: 100,
  });
  console.log(`Challenge issued: ${ch.challenge.id}`);
  console.log(`Wager: 100 tokens\n`);

  // Accept
  const acc = await post("/arena/accept", {
    agent_id: "iron_guard",
    challenge_id: ch.challenge.id,
  });
  const fightId = acc.fight_id;
  console.log(`Fight started: ${fightId}\n`);
  console.log("─".repeat(60));

  // Fight loop
  let state = acc.state;
  let lastRound = 1;

  while (state.status !== "fight_over") {
    if (state.round !== lastRound) {
      console.log(`\n${"═".repeat(60)}`);
      console.log(`  ROUND ${state.round}`);
      console.log(`${"═".repeat(60)}\n`);
      lastRound = state.round;
    }

    const p1Act = aggressiveAction();
    const p2Act = defensiveAction();

    await post("/arena/action", { agent_id: "shadow_puncher", fight_id: fightId, action: p1Act });
    const result = await post("/arena/action", { agent_id: "iron_guard", fight_id: fightId, action: p2Act });
    state = result.state;

    if (result.result) {
      const r = result.result;
      const hpBar1 = "█".repeat(Math.max(0, Math.round(state.p1.hp / 5))) + "░".repeat(Math.max(0, 20 - Math.round(state.p1.hp / 5)));
      const hpBar2 = "█".repeat(Math.max(0, Math.round(state.p2.hp / 5))) + "░".repeat(Math.max(0, 20 - Math.round(state.p2.hp / 5)));

      console.log(
        `  E${String(state.exchange).padStart(2, "0")}  ` +
        `${p1Act.padEnd(14)} vs ${p2Act.padEnd(14)}  ` +
        `→ ${r.narrative}`
      );
      console.log(
        `        SP [${hpBar1}] ${String(state.p1.hp).padStart(3)}hp  ` +
        `IG [${hpBar2}] ${String(state.p2.hp).padStart(3)}hp`
      );
    }

    if (state.status === "round_over") {
      const roundWinner = state.p1.roundWins > state.p2.roundWins ? "shadow_puncher" : "iron_guard";
      console.log(`\n  ── ROUND ${state.round} → ${roundWinner.toUpperCase()} WINS ──`);
      console.log(`  Score: shadow_puncher ${state.p1.roundWins} - ${state.p2.roundWins} iron_guard\n`);

      await post("/arena/next-round", { fight_id: fightId });
      const refreshed = await get(`/arena/fight/${fightId}`);
      state = refreshed.state;
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  // Result
  const winner = state.p1.roundWins > state.p2.roundWins ? "shadow_puncher" : "iron_guard";
  console.log(`\n${"═".repeat(60)}`);
  console.log(`\n  ██ K.O. ██  ${winner.toUpperCase()} WINS!\n`);
  console.log(`  Final: shadow_puncher ${state.p1.roundWins} - ${state.p2.roundWins} iron_guard`);
  console.log(`  Total exchanges: ${state.history.length}`);
  console.log(`\n  Fight ID: ${fightId}`);
  console.log(`  Spectate: http://localhost:3000/fight/${fightId}`);
  console.log(`\n${"═".repeat(60)}\n`);
}

main().catch(console.error);

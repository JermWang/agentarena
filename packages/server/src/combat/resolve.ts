import { type Action, categorize, BASE_DAMAGE, STAMINA_COST } from "./actions.js";

export interface FighterState {
  hp: number;
  stamina: number;
}

export interface ExchangeResult {
  /** Damage dealt BY player 1 (to player 2) */
  p1Damage: number;
  /** Damage dealt BY player 2 (to player 1) */
  p2Damage: number;
  /** Stamina change for player 1 (negative = cost, positive = regen) */
  p1StaminaChange: number;
  /** Stamina change for player 2 */
  p2StaminaChange: number;
  /** What happened this exchange */
  narrative: string;
}

const STAMINA_REGEN = 3;
const LOW_STAMINA_THRESHOLD = 15;
const LOW_STAMINA_DAMAGE_MULT = 0.5;
const GUARD_BREAK_MULT = 0.6;
const TAUNT_STAMINA_REGEN = 20;

function staminaMultiplier(stamina: number): number {
  return stamina < LOW_STAMINA_THRESHOLD ? LOW_STAMINA_DAMAGE_MULT : 1.0;
}

/**
 * Resolve one simultaneous exchange between two fighters.
 *
 * Priority system:
 *  - Light beats Heavy (interrupt)
 *  - Heavy beats Block (guard break, reduced damage)
 *  - Block beats Light (absorb)
 *  - Dodge avoids everything, deals nothing
 *  - Specials beat blocks, lose to attacks
 *  - Same-category = both land (trade)
 *  - Taunt = free stamina regen, but vulnerable to everything
 */
export function resolveExchange(
  p1Action: Action,
  p2Action: Action,
  p1State: FighterState,
  p2State: FighterState,
): ExchangeResult {
  const c1 = categorize(p1Action);
  const c2 = categorize(p2Action);
  const mult1 = staminaMultiplier(p1State.stamina);
  const mult2 = staminaMultiplier(p2State.stamina);

  let p1Damage = 0; // damage P1 deals TO P2
  let p2Damage = 0; // damage P2 deals TO P1
  let p1StaminaChange = -STAMINA_COST[p1Action] + STAMINA_REGEN;
  let p2StaminaChange = -STAMINA_COST[p2Action] + STAMINA_REGEN;
  let narrative = "";

  // Taunt bonus stamina regen
  if (p1Action === "taunt") p1StaminaChange += TAUNT_STAMINA_REGEN;
  if (p2Action === "taunt") p2StaminaChange += TAUNT_STAMINA_REGEN;

  // --- DODGE: avoids everything, deals nothing ---
  if (c1 === "dodge" && c2 === "dodge") {
    narrative = "Both dodge — reset";
  } else if (c1 === "dodge") {
    narrative = `${p1Action} evades ${p2Action}`;
  } else if (c2 === "dodge") {
    narrative = `${p2Action} evades ${p1Action}`;

  // --- LIGHT vs HEAVY: light interrupts heavy ---
  } else if (c1 === "light_attack" && c2 === "heavy_attack") {
    p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
    narrative = `${p1Action} interrupts ${p2Action}!`;
  } else if (c1 === "heavy_attack" && c2 === "light_attack") {
    p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
    narrative = `${p2Action} interrupts ${p1Action}!`;

  // --- HEAVY vs BLOCK: guard break (reduced damage) ---
  } else if (c1 === "heavy_attack" && c2 === "block") {
    p1Damage = Math.round(BASE_DAMAGE[p1Action] * GUARD_BREAK_MULT * mult1);
    narrative = `${p1Action} breaks through ${p2Action}!`;
  } else if (c1 === "block" && c2 === "heavy_attack") {
    p2Damage = Math.round(BASE_DAMAGE[p2Action] * GUARD_BREAK_MULT * mult2);
    narrative = `${p2Action} breaks through ${p1Action}!`;

  // --- BLOCK vs LIGHT: absorbed ---
  } else if (c1 === "light_attack" && c2 === "block") {
    narrative = `${p2Action} blocks ${p1Action}`;
  } else if (c1 === "block" && c2 === "light_attack") {
    narrative = `${p1Action} blocks ${p2Action}`;

  // --- SAME CATEGORY TRADES ---
  } else if (c1 === "light_attack" && c2 === "light_attack") {
    p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
    p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
    narrative = `Trade! ${p1Action} and ${p2Action} both connect`;
  } else if (c1 === "heavy_attack" && c2 === "heavy_attack") {
    p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
    p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
    narrative = `Heavy trade! ${p1Action} clashes with ${p2Action}`;
  } else if (c1 === "block" && c2 === "block") {
    narrative = "Both block — stalemate";

  // --- SPECIALS ---
  } else if (c1 === "special" && c2 === "special") {
    // Both specials — both land (if they deal damage)
    if (BASE_DAMAGE[p1Action] > 0) p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
    if (BASE_DAMAGE[p2Action] > 0) p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
    narrative = `Special clash! ${p1Action} vs ${p2Action}`;
  } else if (c1 === "special") {
    if (c2 === "block") {
      // Specials break blocks (like heavies)
      p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
      narrative = `${p1Action} breaks through ${p2Action}!`;
    } else if (c2 === "light_attack" || c2 === "heavy_attack") {
      // Attacks punish specials (slow wind-up)
      p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
      narrative = `${p2Action} punishes ${p1Action}`;
    } else {
      narrative = `${p1Action} whiffs`;
    }
  } else if (c2 === "special") {
    if (c1 === "block") {
      p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
      narrative = `${p2Action} breaks through ${p1Action}!`;
    } else if (c1 === "light_attack" || c1 === "heavy_attack") {
      p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
      narrative = `${p1Action} punishes ${p2Action}`;
    } else {
      narrative = `${p2Action} whiffs`;
    }
  } else {
    // Catch-all (shouldn't normally reach here)
    if (BASE_DAMAGE[p1Action] > 0) p1Damage = Math.round(BASE_DAMAGE[p1Action] * mult1);
    if (BASE_DAMAGE[p2Action] > 0) p2Damage = Math.round(BASE_DAMAGE[p2Action] * mult2);
    narrative = `${p1Action} vs ${p2Action}`;
  }

  return { p1Damage, p2Damage, p1StaminaChange, p2StaminaChange, narrative };
}

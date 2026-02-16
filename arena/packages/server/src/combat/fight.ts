import { type Action, ACTIONS } from "./actions.js";
import { resolveExchange, type ExchangeResult } from "./resolve.js";

export type FightStatus = "waiting_for_actions" | "round_over" | "fight_over";

export interface FighterSnapshot {
  agentId: string;
  hp: number;
  stamina: number;
  roundWins: number;
}

export interface ExchangeRecord {
  round: number;
  exchange: number;
  p1Action: Action;
  p2Action: Action;
  result: ExchangeResult;
}

export interface FightState {
  fightId: string;
  round: number;
  exchange: number;
  maxExchanges: number;
  roundsToWin: number;
  p1: FighterSnapshot;
  p2: FighterSnapshot;
  status: FightStatus;
  lastResult: ExchangeResult | null;
  history: ExchangeRecord[];
}

const MAX_EXCHANGES = 20;
const MAX_HP = 100;
const MAX_STAMINA = 100;
const ROUNDS_TO_WIN = 2;

export class Fight {
  private fightId: string;
  private p1Id: string;
  private p2Id: string;
  private p1Hp = MAX_HP;
  private p2Hp = MAX_HP;
  private p1Stamina = MAX_STAMINA;
  private p2Stamina = MAX_STAMINA;
  private p1RoundWins = 0;
  private p2RoundWins = 0;
  private round = 1;
  private exchange = 1;
  private status: FightStatus = "waiting_for_actions";
  private pendingP1: Action | null = null;
  private pendingP2: Action | null = null;
  private lastResult: ExchangeResult | null = null;
  private history: ExchangeRecord[] = [];

  constructor(fightId: string, p1Id: string, p2Id: string) {
    this.fightId = fightId;
    this.p1Id = p1Id;
    this.p2Id = p2Id;
  }

  /** Submit an action for one fighter. Returns the exchange result when both have submitted. */
  submitAction(agentId: string, action: Action): ExchangeResult | null {
    if (this.status !== "waiting_for_actions") {
      throw new Error(`Fight is ${this.status}, cannot submit actions`);
    }
    if (!ACTIONS.includes(action)) {
      throw new Error(`Invalid action: ${action}`);
    }

    if (agentId === this.p1Id) {
      if (this.pendingP1 !== null) throw new Error("P1 already submitted action this exchange");
      this.pendingP1 = action;
    } else if (agentId === this.p2Id) {
      if (this.pendingP2 !== null) throw new Error("P2 already submitted action this exchange");
      this.pendingP2 = action;
    } else {
      throw new Error(`Agent ${agentId} is not in this fight`);
    }

    // Both submitted — resolve the exchange
    if (this.pendingP1 !== null && this.pendingP2 !== null) {
      return this.resolve();
    }
    return null;
  }

  private resolve(): ExchangeResult {
    const p1Action = this.pendingP1!;
    const p2Action = this.pendingP2!;

    const result = resolveExchange(
      p1Action,
      p2Action,
      { hp: this.p1Hp, stamina: this.p1Stamina },
      { hp: this.p2Hp, stamina: this.p2Stamina },
    );

    // Apply damage (p1Damage is dealt BY p1 TO p2)
    this.p2Hp = Math.max(0, this.p2Hp - result.p1Damage);
    this.p1Hp = Math.max(0, this.p1Hp - result.p2Damage);

    // Apply stamina (clamped 0..MAX)
    this.p1Stamina = Math.max(0, Math.min(MAX_STAMINA, this.p1Stamina + result.p1StaminaChange));
    this.p2Stamina = Math.max(0, Math.min(MAX_STAMINA, this.p2Stamina + result.p2StaminaChange));

    // Record
    this.history.push({ round: this.round, exchange: this.exchange, p1Action, p2Action, result });
    this.lastResult = result;

    // Reset pending actions
    this.pendingP1 = null;
    this.pendingP2 = null;

    // Check round end conditions
    if (this.p1Hp <= 0 || this.p2Hp <= 0 || this.exchange >= MAX_EXCHANGES) {
      this.endRound();
    } else {
      this.exchange++;
    }

    return result;
  }

  private endRound(): void {
    // Determine round winner by HP
    if (this.p2Hp <= 0 && this.p1Hp > 0) {
      this.p1RoundWins++;
    } else if (this.p1Hp <= 0 && this.p2Hp > 0) {
      this.p2RoundWins++;
    } else if (this.p1Hp > this.p2Hp) {
      this.p1RoundWins++;
    } else if (this.p2Hp > this.p1Hp) {
      this.p2RoundWins++;
    }
    // Equal HP = no one wins the round

    if (this.p1RoundWins >= ROUNDS_TO_WIN || this.p2RoundWins >= ROUNDS_TO_WIN) {
      this.status = "fight_over";
    } else {
      this.status = "round_over";
    }
  }

  /** Start the next round. Only valid when status is "round_over". */
  nextRound(): void {
    if (this.status !== "round_over") {
      throw new Error(`Cannot start next round when status is ${this.status}`);
    }
    this.round++;
    this.exchange = 1;
    this.p1Hp = MAX_HP;
    this.p2Hp = MAX_HP;
    this.p1Stamina = MAX_STAMINA;
    this.p2Stamina = MAX_STAMINA;
    this.pendingP1 = null;
    this.pendingP2 = null;
    this.status = "waiting_for_actions";
  }

  /** Get the winner's agent ID. Only valid when fight_over. */
  getWinner(): string | null {
    if (this.status !== "fight_over") return null;
    if (this.p1RoundWins > this.p2RoundWins) return this.p1Id;
    if (this.p2RoundWins > this.p1RoundWins) return this.p2Id;
    return null; // draw (shouldn't happen with best-of-3)
  }

  getState(): FightState {
    return {
      fightId: this.fightId,
      round: this.round,
      exchange: this.exchange,
      maxExchanges: MAX_EXCHANGES,
      roundsToWin: ROUNDS_TO_WIN,
      p1: { agentId: this.p1Id, hp: this.p1Hp, stamina: this.p1Stamina, roundWins: this.p1RoundWins },
      p2: { agentId: this.p2Id, hp: this.p2Hp, stamina: this.p2Stamina, roundWins: this.p2RoundWins },
      status: this.status,
      lastResult: this.lastResult,
      history: this.history,
    };
  }
}

import { Fight, type FightState } from "../combat/fight.js";
import type { Action } from "../combat/actions.js";

const ACTION_TIMEOUT_MS = 5_000;
const ROUND_PAUSE_MS = 3_000;
const DEFAULT_ACTION: Action = "block_high";
const CLEANUP_DELAY_MS = 30_000;

export interface ActiveFight {
  fight: Fight;
  agent1Id: string;
  agent2Id: string;
  fightId: string;
  wager: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export class FightManager {
  activeFights = new Map<string, ActiveFight>();
  agentFightMap = new Map<string, string>();

  onFightUpdate?: (fightId: string, state: FightState) => void;
  onFightEnd?: (fightId: string, winnerId: string | null, state: FightState) => void;
  onRoundEnd?: (fightId: string, state: FightState) => void;
  onExchangeReady?: (fightId: string) => void;

  createFight(fightId: string, agent1Id: string, agent2Id: string, wager: number): ActiveFight {
    const fight = new Fight(fightId, agent1Id, agent2Id);
    const active: ActiveFight = { fight, agent1Id, agent2Id, fightId, wager };
    this.activeFights.set(fightId, active);
    this.agentFightMap.set(agent1Id, fightId);
    this.agentFightMap.set(agent2Id, fightId);
    this.startActionTimeout(fightId);
    return active;
  }

  submitAction(fightId: string, agentId: string, action: Action): void {
    const active = this.activeFights.get(fightId);
    if (!active) return;
    try {
      const result = active.fight.submitAction(agentId, action);
      if (result !== null) {
        this.clearTimeout(fightId);
        const state = active.fight.getState();
        if (state.status === "fight_over") {
          this.onFightUpdate?.(fightId, state);
          this.endFight(fightId);
        } else if (state.status === "round_over") {
          this.onFightUpdate?.(fightId, state);
          this.onRoundEnd?.(fightId, state);
          setTimeout(() => {
            const a = this.activeFights.get(fightId);
            if (a && a.fight.getState().status === "round_over") {
              a.fight.nextRound();
              const newState = a.fight.getState();
              this.onFightUpdate?.(fightId, newState);
              this.onExchangeReady?.(fightId);
              this.startActionTimeout(fightId);
            }
          }, ROUND_PAUSE_MS);
        } else {
          this.onFightUpdate?.(fightId, state);
          this.onExchangeReady?.(fightId);
          this.startActionTimeout(fightId);
        }
      }
    } catch {
      // Invalid action or duplicate — ignore
    }
  }

  private startActionTimeout(fightId: string): void {
    const active = this.activeFights.get(fightId);
    if (!active) return;
    this.clearTimeout(fightId);
    active.timeoutHandle = setTimeout(() => {
      const fight = active.fight;
      const state = fight.getState();
      if (state.status !== "waiting_for_actions") return;
      try { fight.submitAction(active.agent1Id, DEFAULT_ACTION); } catch {}
      try { fight.submitAction(active.agent2Id, DEFAULT_ACTION); } catch {}
      const newState = fight.getState();
      if (newState.status === "fight_over") {
        this.onFightUpdate?.(fightId, newState);
        this.endFight(fightId);
      } else if (newState.status === "round_over") {
        this.onFightUpdate?.(fightId, newState);
        this.onRoundEnd?.(fightId, newState);
        setTimeout(() => {
          const a = this.activeFights.get(fightId);
          if (a && a.fight.getState().status === "round_over") {
            a.fight.nextRound();
            this.onFightUpdate?.(fightId, a.fight.getState());
            this.onExchangeReady?.(fightId);
            this.startActionTimeout(fightId);
          }
        }, ROUND_PAUSE_MS);
      } else {
        this.onFightUpdate?.(fightId, newState);
        this.onExchangeReady?.(fightId);
        this.startActionTimeout(fightId);
      }
    }, ACTION_TIMEOUT_MS);
  }

  private clearTimeout(fightId: string): void {
    const active = this.activeFights.get(fightId);
    if (active?.timeoutHandle) {
      clearTimeout(active.timeoutHandle);
      active.timeoutHandle = undefined;
    }
  }

  private endFight(fightId: string): void {
    const active = this.activeFights.get(fightId);
    if (!active) return;
    const winnerId = active.fight.getWinner();
    this.onFightEnd?.(fightId, winnerId, active.fight.getState());
    this.agentFightMap.delete(active.agent1Id);
    this.agentFightMap.delete(active.agent2Id);
    this.clearTimeout(fightId);
    setTimeout(() => this.activeFights.delete(fightId), CLEANUP_DELAY_MS);
  }

  getFightForAgent(agentId: string): string | undefined {
    return this.agentFightMap.get(agentId);
  }

  getFightState(fightId: string): FightState | undefined {
    return this.activeFights.get(fightId)?.fight.getState();
  }

  getActiveFights(): Array<{ fightId: string; agent1: string; agent2: string; state: FightState }> {
    return Array.from(this.activeFights.values())
      .filter((a) => a.fight.getState().status !== "fight_over")
      .map((a) => ({ fightId: a.fightId, agent1: a.agent1Id, agent2: a.agent2Id, state: a.fight.getState() }));
  }
}

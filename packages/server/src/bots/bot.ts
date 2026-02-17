import { WebSocket } from "ws";
import { nanoid } from "nanoid";
import type { Action } from "../combat/actions.js";
import { ACTIONS } from "../combat/actions.js";

interface BotConfig {
  serverUrl: string;
  actionDelayMs: number;
  character: string;
}

interface FightState {
  fight_id: string;
  round: number;
  exchange: number;
  your_hp: number;
  your_stamina: number;
  opponent_hp: number;
  opponent_stamina: number;
  round_wins: number;
  opponent_round_wins: number;
  last_result: string | null;
  timeout_ms: number;
}

export class ArenaBot {
  private ws: WebSocket | null = null;
  private config: BotConfig;
  private apiKey: string | null = null;
  private agentId: string | null = null;
  private username: string;
  private currentFight: string | null = null;
  private isInQueue = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;

  constructor(username: string, config: BotConfig) {
    this.username = username;
    this.config = config;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.isShuttingDown = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.isShuttingDown) return;

    try {
      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on("open", () => {
        console.log(`[Bot ${this.username}] Connected`);
        this.startHeartbeat();
        if (this.apiKey) {
          this.authenticate();
        } else {
          this.register();
        }
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.error(`[Bot ${this.username}] Message parse error:`, e);
        }
      });

      this.ws.on("close", () => {
        console.log(`[Bot ${this.username}] Disconnected`);
        this.clearTimers();
        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (err) => {
        console.error(`[Bot ${this.username}] WebSocket error:`, err.message);
      });
    } catch (e) {
      console.error(`[Bot ${this.username}] Connection failed:`, e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log(`[Bot ${this.username}] Reconnecting in 5s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private register(): void {
    console.log(`[Bot ${this.username}] Registering...`);
    this.send({
      type: "register",
      name: this.username,
      character: this.config.character,
      wallet_address: undefined,
      signature: undefined,
    });
  }

  private authenticate(): void {
    if (!this.apiKey) return;
    console.log(`[Bot ${this.username}] Authenticating...`);
    this.send({
      type: "auth",
      api_key: this.apiKey,
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "registered":
        this.apiKey = msg.api_key;
        this.agentId = msg.agent_id;
        console.log(`[Bot ${this.username}] Registered as ${msg.agent_id}`);
        this.authenticate();
        break;

      case "authenticated":
        console.log(`[Bot ${this.username}] Authenticated, joining queue`);
        this.joinQueue();
        break;

      case "queued":
        this.isInQueue = true;
        console.log(`[Bot ${this.username}] Queued (#${msg.queue_size})`);
        break;

      case "fight_start":
        this.currentFight = msg.fight_id;
        this.isInQueue = false;
        console.log(`[Bot ${this.username}] Fight started vs ${msg.opponent}`);
        break;

      case "exchange_request":
        this.handleExchangeRequest(msg as FightState);
        break;

      case "fight_end":
        console.log(`[Bot ${this.username}] Fight ended, winner: ${msg.winner}`);
        this.currentFight = null;
        this.clearActionTimer();
        // Re-queue after short delay
        setTimeout(() => this.joinQueue(), 2000);
        break;

      case "error":
        console.error(`[Bot ${this.username}] Error:`, msg.error);
        // Re-queue if not in fight and not already queued
        if (!this.currentFight && !this.isInQueue) {
          setTimeout(() => this.joinQueue(), 3000);
        }
        break;

      case "pit_event":
        // Ignore pit events for now
        break;
    }
  }

  private joinQueue(): void {
    if (this.isInQueue || this.currentFight) return;
    console.log(`[Bot ${this.username}] Joining queue...`);
    this.send({ type: "queue" });
  }

  private handleExchangeRequest(state: FightState): void {
    if (!this.currentFight) return;

    this.clearActionTimer();

    // Calculate action with some randomness and basic strategy
    const action = this.chooseAction(state);

    // Add random delay to feel more natural (500ms to actionDelayMs)
    const delay = 500 + Math.random() * (this.config.actionDelayMs - 500);

    this.actionTimer = setTimeout(() => {
      this.send({
        type: "action",
        fight_id: this.currentFight,
        action,
      });
      console.log(`[Bot ${this.username}] Action: ${action} (HP: ${state.your_hp}, STM: ${state.your_stamina})`);
    }, delay);
  }

  private clearActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  private chooseAction(state: FightState): Action {
    const { your_hp, your_stamina, opponent_hp, opponent_stamina, last_result } = state;

    // Filter actions by stamina
    const availableActions = ACTIONS.filter((a) => {
      const cost = this.getStaminaCost(a);
      return cost <= your_stamina;
    });

    if (availableActions.length === 0) {
      return "block_high"; // Default if no stamina
    }

    // Basic strategy weights
    const weights = new Map<Action, number>();
    for (const action of availableActions) {
      weights.set(action, this.calculateWeight(action, state));
    }

    // Weighted random selection
    const totalWeight = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (const [action, weight] of weights) {
      random -= weight;
      if (random <= 0) return action;
    }

    return availableActions[Math.floor(Math.random() * availableActions.length)];
  }

  private calculateWeight(action: Action, state: FightState): number {
    const { your_hp, your_stamina, opponent_hp, opponent_stamina, last_result } = state;
    const category = this.getActionCategory(action);
    let weight = 1.0;

    // Low health -> favor defense
    if (your_hp < 30) {
      if (category === "block" || category === "dodge") weight *= 2.0;
      if (category === "heavy_attack") weight *= 0.5;
    }

    // Low stamina -> favor low-cost actions
    if (your_stamina < 20) {
      const cost = this.getStaminaCost(action);
      if (cost <= 5) weight *= 2.0;
      if (cost >= 15) weight *= 0.3;
    }

    // Opponent low health -> favor attacks
    if (opponent_hp < 30) {
      if (category === "heavy_attack") weight *= 1.5;
      if (category === "light_attack") weight *= 1.3;
    }

    // Opponent low stamina -> they can't dodge/block well, favor attacks
    if (opponent_stamina < 20) {
      if (category === "heavy_attack") weight *= 1.5;
    }

    // Last result was bad -> change strategy
    if (last_result === "blocked" || last_result === "dodged" || last_result === "countered") {
      if (category === "special") weight *= 1.5; // Try special moves
      if (category === "light_attack") weight *= 1.3; // Quick attacks harder to react
    }

    // Slight randomness per action type preference
    switch (action) {
      case "uppercut":
        weight *= 0.8; // Risky, expensive
        break;
      case "sweep":
        weight *= 1.1; // Good mix
        break;
      case "grab":
        weight *= 1.0;
        break;
      case "taunt":
        weight *= 0.4; // Rarely taunt
        break;
      case "dodge_back":
        weight *= 1.2; // Safe option
        break;
      case "dodge_forward":
        weight *= 0.9; // Risky
        break;
    }

    return Math.max(0.1, weight);
  }

  private getStaminaCost(action: Action): number {
    const costs: Record<Action, number> = {
      light_punch: 5,
      heavy_punch: 12,
      light_kick: 6,
      heavy_kick: 14,
      block_high: 3,
      block_low: 3,
      dodge_back: 4,
      dodge_forward: 4,
      uppercut: 18,
      sweep: 15,
      grab: 10,
      taunt: 0,
    };
    return costs[action] ?? 5;
  }

  private getActionCategory(action: Action): string {
    const categories: Record<string, string> = {
      light_punch: "light_attack",
      heavy_punch: "heavy_attack",
      light_kick: "light_attack",
      heavy_kick: "heavy_attack",
      block_high: "block",
      block_low: "block",
      dodge_back: "dodge",
      dodge_forward: "dodge",
      uppercut: "special",
      sweep: "special",
      grab: "special",
      taunt: "special",
    };
    return categories[action] ?? "light_attack";
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  isActive(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  isInFight(): boolean {
    return this.currentFight !== null;
  }
}

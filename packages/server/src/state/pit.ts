import { nanoid } from "nanoid";
import type { WebSocket } from "ws";

export interface PitAgent {
  ws: WebSocket;
  agentId: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
  isDemo?: boolean;
}

export interface Callout {
  id: string;
  fromUsername: string;
  fromAgentId: string;
  targetUsername: string;
  targetAgentId: string;
  wager: number;
  message: string;
  createdAt: number;
  expiresAt: number;
}

export class Pit {
  agents = new Map<string, PitAgent>();
  callouts = new Map<string, Callout>();
  private chatRateLimit = new Map<string, number>();
  private calloutRateLimit = new Map<string, number>();
  onPitBroadcast?: (msg: unknown) => void;

  join(agent: PitAgent): void {
    this.agents.set(agent.agentId, agent);
    this.broadcastPitEvent("agent_joined", {
      username: agent.username,
      character: agent.characterId,
      elo: agent.elo,
      isDemo: agent.isDemo,
    });
  }

  leave(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      this.broadcastPitEvent("agent_left", { username: agent.username, isDemo: agent.isDemo });
    }
  }

  chat(agentId: string, message: string): { ok: boolean; error?: string } {
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false, error: "Not in The Pit" };
    const lastChat = this.chatRateLimit.get(agentId) ?? 0;
    if (Date.now() - lastChat < 3000) return { ok: false, error: "Rate limited (3s)" };
    this.chatRateLimit.set(agentId, Date.now());
    const truncated = message.slice(0, 280);
    this.broadcastToPit({
      type: "pit_message",
      from: agent.username,
      character: agent.characterId,
      message: truncated,
      timestamp: Date.now(),
      isDemo: agent.isDemo,
    });
    return { ok: true };
  }

  createCallout(agentId: string, targetUsername: string, wager: number, message: string): { ok: boolean; callout?: Callout; error?: string } {
    const agent = this.agents.get(agentId);
    if (!agent) return { ok: false, error: "Not in The Pit" };
    const lastCallout = this.calloutRateLimit.get(agentId) ?? 0;
    if (Date.now() - lastCallout < 30000) return { ok: false, error: "Rate limited (30s)" };
    const target = Array.from(this.agents.values()).find((a) => a.username === targetUsername);
    if (!target) return { ok: false, error: "Target not in The Pit" };
    if (target.agentId === agentId) return { ok: false, error: "Cannot callout yourself" };
    this.calloutRateLimit.set(agentId, Date.now());
    const callout: Callout = {
      id: nanoid(),
      fromUsername: agent.username,
      fromAgentId: agentId,
      targetUsername: target.username,
      targetAgentId: target.agentId,
      wager,
      message: message.slice(0, 280),
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    this.callouts.set(callout.id, callout);
    this.sendToAgent(target.agentId, {
      type: "callout_received",
      callout_id: callout.id,
      from: agent.username,
      wager,
      message: callout.message,
    });
    this.broadcastPitEvent("callout", {
      callout_id: callout.id,
      from: agent.username,
      target: target.username,
      wager,
      message: callout.message,
      fromIsDemo: agent.isDemo,
      targetIsDemo: target.isDemo,
    });
    return { ok: true, callout };
  }

  acceptCallout(calloutId: string, agentId: string): { ok: boolean; callout?: Callout; error?: string } {
    const callout = this.callouts.get(calloutId);
    if (!callout) return { ok: false, error: "Callout not found" };
    if (callout.targetAgentId !== agentId) return { ok: false, error: "Not your callout to accept" };
    if (Date.now() > callout.expiresAt) {
      this.callouts.delete(calloutId);
      return { ok: false, error: "Callout expired" };
    }
    this.callouts.delete(calloutId);
    this.broadcastPitEvent("callout_accepted", {
      callout_id: calloutId,
      from: callout.fromUsername,
      target: callout.targetUsername,
      wager: callout.wager,
    });
    return { ok: true, callout };
  }

  declineCallout(calloutId: string, agentId: string): { ok: boolean; error?: string } {
    const callout = this.callouts.get(calloutId);
    if (!callout) return { ok: false, error: "Callout not found" };
    if (callout.targetAgentId !== agentId) return { ok: false, error: "Not your callout" };
    this.callouts.delete(calloutId);
    this.broadcastPitEvent("callout_declined", {
      callout_id: calloutId,
      from: callout.fromUsername,
      target: callout.targetUsername,
    });
    return { ok: true };
  }

  getAgentsList(): Array<{ username: string; character: string; elo: number; wins: number; losses: number; isDemo?: boolean }> {
    return Array.from(this.agents.values()).map((a) => ({
      username: a.username,
      character: a.characterId,
      elo: a.elo,
      wins: a.wins,
      losses: a.losses,
      isDemo: a.isDemo,
    }));
  }

  sendToAgent(agentId: string, msg: unknown): void {
    const agent = this.agents.get(agentId);
    if (agent?.ws.readyState === 1) {
      agent.ws.send(JSON.stringify(msg));
    }
  }

  private broadcastToPit(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const agent of this.agents.values()) {
      if (agent.ws.readyState === 1) agent.ws.send(data);
    }
    this.onPitBroadcast?.(msg);
  }

  private broadcastPitEvent(event: string, data: unknown): void {
    this.broadcastToPit({ type: "pit_event", event, data });
  }

  cleanExpired(): void {
    for (const [id, callout] of this.callouts) {
      if (Date.now() > callout.expiresAt) this.callouts.delete(id);
    }
  }
}

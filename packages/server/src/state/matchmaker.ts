export interface QueueEntry {
  agentId: string;
  username: string;
  elo: number;
  joinedAt: number;
  isDemo?: boolean;
}

export class Matchmaker {
  private demoQueue: QueueEntry[] = [];
  private realQueue: QueueEntry[] = [];
  onMatchFound?: (agent1Id: string, agent2Id: string) => void;

  enqueue(agent: QueueEntry): void {
    const queue = agent.isDemo ? this.demoQueue : this.realQueue;
    if (queue.some((e) => e.agentId === agent.agentId)) return;
    queue.push(agent);
    this.tryMatch(agent.isDemo);
  }

  dequeue(agentId: string): void {
    this.demoQueue = this.demoQueue.filter((e) => e.agentId !== agentId);
    this.realQueue = this.realQueue.filter((e) => e.agentId !== agentId);
  }

  private tryMatch(isDemo: boolean = false): void {
    const queue = isDemo ? this.demoQueue : this.realQueue;
    if (queue.length < 2) return;
    const a = queue.shift()!;
    const b = queue.shift()!;
    this.onMatchFound?.(a.agentId, b.agentId);
  }

  getQueueSize(isDemo?: boolean): number {
    if (isDemo === undefined) return this.demoQueue.length + this.realQueue.length;
    return isDemo ? this.demoQueue.length : this.realQueue.length;
  }
}

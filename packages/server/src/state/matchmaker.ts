export interface QueueEntry {
  agentId: string;
  username: string;
  elo: number;
  joinedAt: number;
}

export class Matchmaker {
  private queue: QueueEntry[] = [];
  onMatchFound?: (agent1Id: string, agent2Id: string) => void;

  enqueue(agent: QueueEntry): void {
    if (this.queue.some((e) => e.agentId === agent.agentId)) return;
    this.queue.push(agent);
    this.tryMatch();
  }

  dequeue(agentId: string): void {
    this.queue = this.queue.filter((e) => e.agentId !== agentId);
  }

  private tryMatch(): void {
    if (this.queue.length < 2) return;
    const a = this.queue.shift()!;
    const b = this.queue.shift()!;
    this.onMatchFound?.(a.agentId, b.agentId);
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}

import { ArenaBot } from "./bot.js";
import { config } from "../config.js";
import { prisma } from "../db/client.js";
import bcrypt from "bcrypt";

const CHARACTERS = ["ronin", "knight", "cyborg", "demon", "phantom"];
const BOT_NAME_PREFIXES = [
  "Shadow", "Iron", "Cyber", "Phantom", "Neon", "Quantum", "Void", "Nova",
  "Rogue", "Blaze", "Frost", "Storm", "Viper", "Cobra", "Ghost", "Spectre",
];
const BOT_NAME_SUFFIXES = [
  "Claw", "Fist", "Blade", "Strike", "Hunter", "Slayer", "Stalker", "Wraith",
  "Reaper", "Edge", "Fang", "Talon", "Ninja", "Samurai", "Ronin", "Bot",
];

interface BotWorkerConfig {
  serverUrl: string;
  minBots: number;
  maxBots: number;
  spawnIntervalMs: number;
  actionDelayMs: number;
  demoWalletPrefix: string;
}

export class BotWorker {
  private bots: Map<string, ArenaBot> = new Map();
  private config: BotWorkerConfig;
  private spawnTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private botCounter = 0;

  constructor() {
    this.config = {
      serverUrl: config.botWorker.serverUrl,
      minBots: config.botWorker.minBots,
      maxBots: config.botWorker.maxBots,
      spawnIntervalMs: config.botWorker.spawnIntervalMs,
      actionDelayMs: config.botWorker.actionDelayMs,
      demoWalletPrefix: config.botWorker.demoWalletPrefix,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log("[BotWorker] Starting with config:", {
      minBots: this.config.minBots,
      maxBots: this.config.maxBots,
      spawnInterval: this.config.spawnIntervalMs,
    });

    // Clean up any stale demo agents from previous runs
    await this.cleanupStaleBots();

    // Spawn initial bots
    await this.spawnInitialBots();

    // Start maintenance loops
    this.spawnTimer = setInterval(() => {
      this.maintainBotCount();
    }, this.config.spawnIntervalMs);

    this.cleanupTimer = setInterval(() => {
      this.removeDeadBots();
    }, 10000);

    console.log("[BotWorker] Running");
  }

  stop(): void {
    this.isRunning = false;

    if (this.spawnTimer) {
      clearInterval(this.spawnTimer);
      this.spawnTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop all bots
    for (const bot of this.bots.values()) {
      bot.stop();
    }
    this.bots.clear();

    console.log("[BotWorker] Stopped");
  }

  private async cleanupStaleBots(): Promise<void> {
    try {
      // Find and delete demo bots that haven't been active
      const staleBots = await prisma.agent.findMany({
        where: {
          isDemo: true,
          ownerWallet: {
            startsWith: this.config.demoWalletPrefix,
          },
        },
        select: { id: true },
      });

      if (staleBots.length > 0) {
        console.log(`[BotWorker] Cleaning up ${staleBots.length} stale demo bots`);
        await prisma.agent.deleteMany({
          where: {
            id: { in: staleBots.map((b) => b.id) },
          },
        });
      }
    } catch (e) {
      console.error("[BotWorker] Failed to cleanup stale bots:", e);
    }
  }

  private async spawnInitialBots(): Promise<void> {
    const count = this.config.minBots;
    console.log(`[BotWorker] Spawning ${count} initial bots...`);

    for (let i = 0; i < count; i++) {
      await this.spawnBot();
      // Small delay between spawns to avoid overwhelming the server
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private async spawnBot(): Promise<void> {
    if (this.bots.size >= this.config.maxBots) return;

    this.botCounter++;
    const username = this.generateBotName();
    const character = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    const walletAddress = `${this.config.demoWalletPrefix}_${nanoid(8)}`;

    try {
      // Create bot agent in database with API key
      const apiKey = `demo_${nanoid(32)}`;
      const apiKeyHash = await bcrypt.hash(apiKey, 10);

      // Create a demo user if not exists
      await prisma.user.upsert({
        where: { walletAddress },
        create: { walletAddress },
        update: {},
      });

      // Create the demo agent
      const agent = await prisma.agent.create({
        data: {
          username,
          characterId: character,
          apiKeyHash,
          ownerWallet: walletAddress,
          isDemo: true,
        },
      });

      // Create and start the bot
      const bot = new ArenaBot(username, {
        serverUrl: this.config.serverUrl,
        actionDelayMs: this.config.actionDelayMs,
        character,
      });

      // Pre-set the API key so it authenticates immediately
      (bot as any).apiKey = apiKey;
      (bot as any).agentId = agent.id;

      this.bots.set(agent.id, bot);
      bot.start();

      console.log(`[BotWorker] Spawned ${username} (${agent.id})`);
    } catch (e) {
      console.error(`[BotWorker] Failed to spawn bot ${username}:`, e);
    }
  }

  private generateBotName(): string {
    const prefix = BOT_NAME_PREFIXES[Math.floor(Math.random() * BOT_NAME_PREFIXES.length)];
    const suffix = BOT_NAME_SUFFIXES[Math.floor(Math.random() * BOT_NAME_SUFFIXES.length)];
    const id = this.botCounter.toString().padStart(3, "0");
    return `${prefix}${suffix}_${id}`;
  }

  private maintainBotCount(): void {
    const activeCount = this.getActiveBotCount();

    if (activeCount < this.config.minBots) {
      const needed = this.config.minBots - activeCount;
      console.log(`[BotWorker] Need ${needed} more bots (active: ${activeCount}, min: ${this.config.minBots})`);
      
      for (let i = 0; i < needed && this.bots.size < this.config.maxBots; i++) {
        this.spawnBot();
      }
    }
  }

  private removeDeadBots(): void {
    for (const [agentId, bot] of this.bots) {
      if (!bot.isActive() && !bot.isInFight()) {
        // Bot is disconnected and not in a fight - remove it
        bot.stop();
        this.bots.delete(agentId);
        console.log(`[BotWorker] Removed dead bot ${agentId}`);
      }
    }
  }

  private getActiveBotCount(): number {
    let count = 0;
    for (const bot of this.bots.values()) {
      if (bot.isActive()) count++;
    }
    return count;
  }

  getStats(): { total: number; active: number; inFights: number } {
    let active = 0;
    let inFights = 0;
    for (const bot of this.bots.values()) {
      if (bot.isActive()) active++;
      if (bot.isInFight()) inFights++;
    }
    return {
      total: this.bots.size,
      active,
      inFights,
    };
  }
}

// Generate unique IDs for demo bots
function nanoid(length: number = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3001"),
  corsOrigins: process.env.CORS_ORIGINS?.split(",") ?? [
    "http://localhost:3000",
    "http://localhost:3001",
  ],
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  arenaTokenMint: process.env.ARENA_TOKEN_MINT,
  hotWalletKeypair: process.env.HOT_WALLET_KEYPAIR,
  masterDepositAddress: process.env.MASTER_DEPOSIT_ADDRESS,
  nodeEnv: process.env.NODE_ENV ?? "development",

  // Bot Worker Configuration
  botWorker: {
    enabled: process.env.BOT_WORKER_ENABLED === "true",
    // Default to loopback so bot worker always targets this server process unless explicitly overridden.
    serverUrl: process.env.BOT_SERVER_URL ?? `ws://127.0.0.1:${parseInt(process.env.PORT ?? "3001")}/ws/arena`,
    minBots: parseInt(process.env.BOT_MIN_COUNT ?? "4"),
    maxBots: parseInt(process.env.BOT_MAX_COUNT ?? "8"),
    spawnIntervalMs: parseInt(process.env.BOT_SPAWN_INTERVAL_MS ?? "30000"),
    actionDelayMs: parseInt(process.env.BOT_ACTION_DELAY_MS ?? "1500"),
    demoWalletPrefix: process.env.BOT_DEMO_WALLET_PREFIX ?? "demo_bot",
  },
} as const;

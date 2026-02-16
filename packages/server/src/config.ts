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
} as const;

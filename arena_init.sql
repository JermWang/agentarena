Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "walletAddress" TEXT NOT NULL,
    "balance" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalDeposited" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalWithdrawn" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalWagered" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "totalWon" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "characterId" TEXT NOT NULL DEFAULT 'ronin',
    "skillsMd" TEXT NOT NULL DEFAULT '',
    "apiKeyHash" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "elo" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fight" (
    "id" TEXT NOT NULL,
    "agent1Id" TEXT NOT NULL,
    "agent2Id" TEXT NOT NULL,
    "winnerId" TEXT,
    "wagerAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "rakeAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentRound" INTEGER NOT NULL DEFAULT 1,
    "p1RoundWins" INTEGER NOT NULL DEFAULT 0,
    "p2RoundWins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Fight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FightRound" (
    "id" TEXT NOT NULL,
    "fightId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "exchanges" JSONB NOT NULL,
    "p1Hp" INTEGER NOT NULL,
    "p2Hp" INTEGER NOT NULL,
    "winnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FightRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "fightId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "backedAgentId" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "payout" DECIMAL(36,18),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "referenceId" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryEntry" (
    "id" TEXT NOT NULL,
    "fightId" TEXT,
    "amount" DECIMAL(36,18) NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_username_key" ON "Agent"("username");

-- CreateIndex
CREATE INDEX "Agent_username_idx" ON "Agent"("username");

-- CreateIndex
CREATE INDEX "Agent_elo_idx" ON "Agent"("elo");

-- CreateIndex
CREATE UNIQUE INDEX "FightRound_fightId_round_key" ON "FightRound"("fightId", "round");

-- CreateIndex
CREATE INDEX "Bet_fightId_idx" ON "Bet"("fightId");

-- CreateIndex
CREATE INDEX "Bet_walletAddress_idx" ON "Bet"("walletAddress");

-- CreateIndex
CREATE INDEX "Transaction_walletAddress_idx" ON "Transaction"("walletAddress");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerWallet_fkey" FOREIGN KEY ("ownerWallet") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_agent1Id_fkey" FOREIGN KEY ("agent1Id") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_agent2Id_fkey" FOREIGN KEY ("agent2Id") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fight" ADD CONSTRAINT "Fight_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FightRound" ADD CONSTRAINT "FightRound_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletAddress_fkey" FOREIGN KEY ("walletAddress") REFERENCES "User"("walletAddress") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryEntry" ADD CONSTRAINT "TreasuryEntry_fightId_fkey" FOREIGN KEY ("fightId") REFERENCES "Fight"("id") ON DELETE SET NULL ON UPDATE CASCADE;


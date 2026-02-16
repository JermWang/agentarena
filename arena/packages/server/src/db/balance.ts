import prisma from "./client.js";
import { Prisma } from "@prisma/client";

const FIGHT_RAKE_BPS = 500; // 5% = 500 basis points
const SIDEBET_RAKE_BPS = 300; // 3%

/**
 * Debit an agent's balance (for wagers). Throws if insufficient.
 */
export async function debitBalance(agentId: string, amount: Prisma.Decimal): Promise<void> {
  const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
  if (agent.balance.lessThan(amount)) {
    throw new Error(`Insufficient balance: ${agent.balance} < ${amount}`);
  }
  await prisma.agent.update({
    where: { id: agentId },
    data: { balance: { decrement: amount } },
  });
}

/**
 * Credit an agent's balance (for payouts).
 */
export async function creditBalance(agentId: string, amount: Prisma.Decimal): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      balance: { increment: amount },
      totalEarnings: { increment: amount },
    },
  });
}

/**
 * Resolve a fight: pay winner, deduct treasury fee, record ledger entry.
 */
export async function resolveFightPayout(fightId: string, winnerId: string): Promise<{
  payout: Prisma.Decimal;
  fee: Prisma.Decimal;
}> {
  const fight = await prisma.fight.findUniqueOrThrow({ where: { id: fightId } });
  const totalPool = fight.wagerAmount.mul(2);
  const fee = totalPool.mul(FIGHT_RAKE_BPS).div(10000);
  const payout = totalPool.sub(fee);

  await prisma.$transaction([
    prisma.fight.update({
      where: { id: fightId },
      data: {
        winnerId,
        winnerPayout: payout,
        treasuryFee: fee,
        status: "completed",
        endedAt: new Date(),
      },
    }),
    prisma.agent.update({
      where: { id: winnerId },
      data: { balance: { increment: payout }, wins: { increment: 1 } },
    }),
    // Increment loser's losses
    prisma.agent.update({
      where: { id: fight.p1Id === winnerId ? fight.p2Id : fight.p1Id },
      data: { losses: { increment: 1 } },
    }),
    prisma.treasuryLedger.create({
      data: { fightId, amount: fee, type: "fight_rake" },
    }),
  ]);

  return { payout, fee };
}

export { FIGHT_RAKE_BPS, SIDEBET_RAKE_BPS };

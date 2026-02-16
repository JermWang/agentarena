import { prisma } from "../db/client.js";
import { Decimal } from "@prisma/client/runtime/library";

export const RAKE_BPS = 300; // 3%
export const MIN_BET = "50000";
export const MAX_BET = "10000000";

interface BetResolution {
  betId: string;
  walletAddress: string;
  amount: Decimal;
  payout: Decimal;
  status: string;
}

interface ResolveBetsResult {
  fightId: string;
  winnerId: string | null;
  totalPool: Decimal;
  rake: Decimal;
  payouts: BetResolution[];
}

export class BetManager {
  /**
   * Place a bet on a fight outcome
   * @param fightId Fight ID
   * @param walletAddress User's wallet address
   * @param backedAgentId Agent ID the user is betting on
   * @param amount Bet amount as a string (in human-readable units)
   */
  async placeBet(
    fightId: string,
    walletAddress: string,
    backedAgentId: string,
    amount: string
  ) {
    const amountDecimal = new Decimal(amount);

    // Validate amount
    if (amountDecimal.lessThan(new Decimal(MIN_BET))) {
      throw new Error(`Bet amount must be at least ${MIN_BET}`);
    }
    if (amountDecimal.greaterThan(new Decimal(MAX_BET))) {
      throw new Error(`Bet amount must not exceed ${MAX_BET}`);
    }

    return await prisma.$transaction(async (tx) => {
      // Verify fight exists and is active
      const fight = await tx.fight.findUnique({
        where: { id: fightId },
        select: { agent1Id: true, agent2Id: true, status: true },
      });

      if (!fight) {
        throw new Error(`Fight ${fightId} not found`);
      }

      if (fight.status !== "active") {
        throw new Error(`Fight is not active: ${fight.status}`);
      }

      // Verify agent is in the fight
      if (backedAgentId !== fight.agent1Id && backedAgentId !== fight.agent2Id) {
        throw new Error(`Agent ${backedAgentId} is not in this fight`);
      }

      // Check user balance
      const user = await tx.user.findUnique({
        where: { walletAddress },
      });

      if (!user) {
        throw new Error(`User ${walletAddress} not found`);
      }

      if (user.balance.lessThan(amountDecimal)) {
        throw new Error(
          `Insufficient balance. Required: ${amount}, Available: ${user.balance.toString()}`
        );
      }

      // Debit user balance
      const updatedUser = await tx.user.update({
        where: { walletAddress },
        data: {
          balance: {
            decrement: amountDecimal,
          },
          totalWagered: {
            increment: amountDecimal,
          },
        },
      });

      // Create bet record
      const bet = await tx.bet.create({
        data: {
          fightId,
          walletAddress,
          backedAgentId,
          amount: amountDecimal,
          status: "active",
        },
      });

      // Create transaction record
      await tx.transaction.create({
        data: {
          walletAddress,
          type: "bet",
          amount: amountDecimal,
          referenceId: bet.id,
        },
      });

      return bet;
    });
  }

  /**
   * Resolve all bets for a completed fight
   * @param fightId Fight ID
   * @param winnerId Agent ID that won, or null for a draw
   */
  async resolveBets(
    fightId: string,
    winnerId: string | null
  ): Promise<ResolveBetsResult> {
    return await prisma.$transaction(async (tx) => {
      // Get all active bets for this fight
      const activeBets = await tx.bet.findMany({
        where: { fightId, status: "active" },
      });

      // Calculate pool
      const totalPool = activeBets.reduce(
        (sum, bet) => sum.plus(bet.amount),
        new Decimal(0)
      );

      const payouts: BetResolution[] = [];

      if (activeBets.length === 0) {
        // No bets to resolve
        return {
          fightId,
          winnerId,
          totalPool,
          rake: new Decimal(0),
          payouts: [],
        };
      }

      if (winnerId === null) {
        // Draw: refund all bets
        for (const bet of activeBets) {
          // Update bet status
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: "refunded" },
          });

          // Credit user balance
          await tx.user.update({
            where: { walletAddress: bet.walletAddress },
            data: {
              balance: {
                increment: bet.amount,
              },
            },
          });

          // Create transaction record
          await tx.transaction.create({
            data: {
              walletAddress: bet.walletAddress,
              type: "bet_refund",
              amount: bet.amount,
              referenceId: bet.id,
            },
          });

          payouts.push({
            betId: bet.id,
            walletAddress: bet.walletAddress,
            amount: bet.amount,
            payout: bet.amount,
            status: "refunded",
          });
        }

        return {
          fightId,
          winnerId,
          totalPool,
          rake: new Decimal(0),
          payouts,
        };
      }

      // Calculate winner and loser pools
      const winnerPool = activeBets
        .filter((bet) => bet.backedAgentId === winnerId)
        .reduce((sum, bet) => sum.plus(bet.amount), new Decimal(0));

      const loserPool = activeBets
        .filter((bet) => bet.backedAgentId !== winnerId)
        .reduce((sum, bet) => sum.plus(bet.amount), new Decimal(0));

      // If no one bet on the winner, refund everyone
      if (winnerPool.equals(new Decimal(0))) {
        for (const bet of activeBets) {
          // Update bet status
          await tx.bet.update({
            where: { id: bet.id },
            data: { status: "refunded" },
          });

          // Credit user balance
          await tx.user.update({
            where: { walletAddress: bet.walletAddress },
            data: {
              balance: {
                increment: bet.amount,
              },
            },
          });

          // Create transaction record
          await tx.transaction.create({
            data: {
              walletAddress: bet.walletAddress,
              type: "bet_refund",
              amount: bet.amount,
              referenceId: bet.id,
            },
          });

          payouts.push({
            betId: bet.id,
            walletAddress: bet.walletAddress,
            amount: bet.amount,
            payout: bet.amount,
            status: "refunded",
          });
        }

        return {
          fightId,
          winnerId,
          totalPool,
          rake: new Decimal(0),
          payouts,
        };
      }

      // Calculate rake: 3% from total pool
      const rake = totalPool.times(new Decimal(RAKE_BPS)).dividedBy(
        new Decimal(10000)
      );

      // Create treasury entry for rake
      await tx.treasuryEntry.create({
        data: {
          fightId,
          amount: rake,
          type: "bet_rake",
        },
      });

      // Net pool after rake
      const netPool = totalPool.minus(rake);

      // Distribute winnings
      for (const bet of activeBets) {
        let status: string;
        let payout: Decimal;

        if (bet.backedAgentId === winnerId) {
          // Winner: proportional share of net pool
          status = "won";
          payout = bet.amount.plus(
            bet.amount.dividedBy(winnerPool).times(loserPool)
          );

          // Credit winner balance
          await tx.user.update({
            where: { walletAddress: bet.walletAddress },
            data: {
              balance: {
                increment: payout,
              },
              totalWon: {
                increment: payout,
              },
            },
          });
        } else {
          // Loser: loss only
          status = "lost";
          payout = new Decimal(0);
        }

        // Update bet
        await tx.bet.update({
          where: { id: bet.id },
          data: {
            status,
            payout,
          },
        });

        // Create transaction record only for winners
        if (status === "won") {
          await tx.transaction.create({
            data: {
              walletAddress: bet.walletAddress,
              type: "bet_payout",
              amount: payout,
              referenceId: bet.id,
            },
          });
        }

        payouts.push({
          betId: bet.id,
          walletAddress: bet.walletAddress,
          amount: bet.amount,
          payout,
          status,
        });
      }

      return {
        fightId,
        winnerId,
        totalPool,
        rake,
        payouts,
      };
    });
  }

  /**
   * Get all bets for a fight with pool totals
   */
  async getBets(fightId: string) {
    const [bets, fight] = await Promise.all([
      prisma.bet.findMany({
        where: { fightId },
        include: {
          user: {
            select: {
              walletAddress: true,
            },
          },
        },
      }),
      prisma.fight.findUnique({
        where: { id: fightId },
        select: { agent1Id: true },
      }),
    ]);

    const activeBets = bets.filter((bet) => bet.status === "active");
    const totalPool = activeBets.reduce(
      (sum, bet) => sum.plus(bet.amount),
      new Decimal(0)
    );

    // Calculate pools by agent
    const agent1Id = fight?.agent1Id;
    const agent1Bets = agent1Id
      ? activeBets.filter((bet) => bet.backedAgentId === agent1Id)
      : [];
    const agent1Pool = agent1Bets.reduce(
      (sum, bet) => sum.plus(bet.amount),
      new Decimal(0)
    );

    const agent2Pool = totalPool.minus(agent1Pool);

    return {
      bets,
      totalPool,
      agent1Pool,
      agent2Pool,
      betCount: bets.length,
      activeBetCount: activeBets.length,
    };
  }
}

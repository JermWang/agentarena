import express, { Router } from "express";
import { prisma } from "../db/client.js";
import { processWithdrawal } from "./withdrawal.js";
import { config } from "../config.js";
import { z } from "zod";
import { withdrawLimiter } from "../middleware/rate-limit.js";
import { isValidSolanaAddress } from "./abi.js";

/**
 * Create a router for chain/financial endpoints
 */
export function createChainRouter(): Router {
  const router = express.Router();

  /**
   * GET /deposit-address
   * Returns the master deposit address and token mode for the frontend
   */
  router.get("/deposit-address", (_req, res) => {
    if (!config.masterDepositAddress) {
      return res.status(503).json({ error: "Deposits not configured" });
    }
    return res.json({
      address: config.masterDepositAddress,
      token: config.arenaTokenMint ? "ARENA" : "SOL",
      chain: "solana",
    });
  });

  /**
   * GET /balance/:address
   * Returns user balance from DB
   */
  router.get("/balance/:address", async (req, res) => {
    try {
      const { address } = req.params;

      // Validate address format (Solana base58)
      if (!isValidSolanaAddress(address)) {
        return res.status(400).json({
          error: "Invalid wallet address format",
        });
      }

      const user = await prisma.user.findUnique({
        where: { walletAddress: address },
        select: {
          walletAddress: true,
          balance: true,
          totalDeposited: true,
          totalWithdrawn: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      return res.json({
        walletAddress: user.walletAddress,
        balance: user.balance.toString(),
        totalDeposited: user.totalDeposited.toString(),
        totalWithdrawn: user.totalWithdrawn.toString(),
      });
    } catch (error) {
      console.error("[Chain Routes] Error getting balance:", error);
      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });

  /**
   * GET /transactions/:address
   * Returns last 50 transactions for user
   */
  router.get("/transactions/:address", async (req, res) => {
    try {
      const { address } = req.params;

      // Validate address format (Solana base58)
      if (!isValidSolanaAddress(address)) {
        return res.status(400).json({
          error: "Invalid wallet address format",
        });
      }

      const transactions = await prisma.transaction.findMany({
        where: { walletAddress: address },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          amount: true,
          txHash: true,
          createdAt: true,
          referenceId: true,
        },
      });

      return res.json({
        walletAddress: address,
        transactions: transactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount.toString(),
          txHash: tx.txHash,
          createdAt: tx.createdAt.toISOString(),
          referenceId: tx.referenceId,
        })),
      });
    } catch (error) {
      console.error("[Chain Routes] Error getting transactions:", error);
      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });

  /**
   * POST /withdraw
   * Process a withdrawal
   * Body: { wallet_address: string, amount: string }
   */
  router.post("/withdraw", withdrawLimiter, async (req, res) => {
    try {
      // Validate request body
      const withdrawalSchema = z.object({
        wallet_address: z.string(),
        amount: z.string(),
      });

      let parsed;
      try {
        parsed = withdrawalSchema.parse(req.body);
      } catch (zodError) {
        return res.status(400).json({
          error: "Invalid request body",
          details: zodError,
        });
      }

      const { wallet_address, amount } = parsed;

      // Validate wallet address format (Solana base58)
      if (!isValidSolanaAddress(wallet_address)) {
        return res.status(400).json({
          error: "Invalid wallet address format",
        });
      }

      // Validate amount
      try {
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum <= 0) {
          return res.status(400).json({
            error: "Amount must be a positive number",
          });
        }
      } catch {
        return res.status(400).json({
          error: "Invalid amount format",
        });
      }

      // Process withdrawal
      try {
        const result = await processWithdrawal(wallet_address, amount);
        return res.status(200).json({
          success: true,
          walletAddress: wallet_address,
          amount,
          txHash: result.txHash,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Determine appropriate status code
        let statusCode = 500;
        if (
          errorMessage.includes("User not found") ||
          errorMessage.includes("Invalid") ||
          errorMessage.includes("not configured")
        ) {
          statusCode = 400;
        } else if (errorMessage.includes("Insufficient balance")) {
          statusCode = 402; // Payment required
        }

        return res.status(statusCode).json({
          error: errorMessage,
        });
      }
    } catch (error) {
      console.error("[Chain Routes] Error processing withdrawal:", error);
      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });

  return router;
}

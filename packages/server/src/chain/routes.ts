import express, { Router } from "express";
import { prisma } from "../db/client.js";
import { processWithdrawal } from "./withdrawal.js";
import { config } from "../config.js";
import { z } from "zod";
import { withdrawLimiter } from "../middleware/rate-limit.js";
import { isValidSolanaAddress } from "./abi.js";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomBytes } from "crypto";
import { Decimal } from "@prisma/client/runtime/library.js";

const WITHDRAW_CHALLENGE_TTL_MS = 5 * 60_000;

function verifySolanaSignature(walletAddress: string, message: string, signature: string): boolean {
  try {
    const pubkey = new PublicKey(walletAddress);
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signature);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes());
  } catch {
    return false;
  }
}

function buildWithdrawMessage(args: {
  walletAddress: string;
  amount: string;
  token: string;
  nonce: string;
  expiresAtIso: string;
}): string {
  return [
    "Agent Battle Arena withdrawal authorization",
    `Wallet: ${args.walletAddress}`,
    `Amount: ${args.amount} ${args.token}`,
    `Nonce: ${args.nonce}`,
    `Expires: ${args.expiresAtIso}`,
  ].join("\n");
}

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
   * POST /withdraw/challenge
   * Creates a signed-message challenge for withdrawals.
   * Body: { wallet_address: string, amount: string }
   */
  router.post("/withdraw/challenge", withdrawLimiter, async (req, res) => {
    try {
      const challengeSchema = z.object({
        wallet_address: z.string(),
        amount: z.string(),
      });

      let parsed;
      try {
        parsed = challengeSchema.parse(req.body);
      } catch (zodError) {
        return res.status(400).json({
          error: "Invalid request body",
          details: zodError,
        });
      }

      const { wallet_address, amount } = parsed;

      if (!isValidSolanaAddress(wallet_address)) {
        return res.status(400).json({
          error: "Invalid wallet address format",
        });
      }

      let amountDecimal: Decimal;
      try {
        amountDecimal = new Decimal(amount);
        if (amountDecimal.lte(0)) {
          return res.status(400).json({
            error: "Amount must be a positive number",
          });
        }
      } catch {
        return res.status(400).json({
          error: "Invalid amount format",
        });
      }

      const nonce = randomBytes(16).toString("hex");
      const expiresAt = new Date(Date.now() + WITHDRAW_CHALLENGE_TTL_MS);
      const token = config.arenaTokenMint ? "ARENA" : "SOL";
      const amountCanonical = amountDecimal.toString();
      const message = buildWithdrawMessage({
        walletAddress: wallet_address,
        amount: amountCanonical,
        token,
        nonce,
        expiresAtIso: expiresAt.toISOString(),
      });

      await prisma.withdrawalNonce.create({
        data: {
          nonce,
          walletAddress: wallet_address,
          amount: amountDecimal,
          message,
          expiresAt,
        },
      });

      return res.json({
        nonce,
        message,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      console.error("[Chain Routes] Error creating withdrawal challenge:", error);
      return res.status(500).json({
        error: "Internal server error",
      });
    }
  });

  /**
   * POST /withdraw
   * Process a withdrawal
   * Body: { wallet_address: string, amount: string, nonce: string, signature: string }
   */
  router.post("/withdraw", withdrawLimiter, async (req, res) => {
    try {
      // Validate request body
      const withdrawalSchema = z.object({
        wallet_address: z.string(),
        amount: z.string(),
        nonce: z.string().min(1),
        signature: z.string().min(1),
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

      const { wallet_address, amount, nonce, signature } = parsed;

      // Validate wallet address format (Solana base58)
      if (!isValidSolanaAddress(wallet_address)) {
        return res.status(400).json({
          error: "Invalid wallet address format",
        });
      }

      let amountDecimal: Decimal;
      try {
        amountDecimal = new Decimal(amount);
        if (amountDecimal.lte(0)) {
          return res.status(400).json({
            error: "Amount must be a positive number",
          });
        }
      } catch {
        return res.status(400).json({
          error: "Invalid amount format",
        });
      }

      const challenge = await prisma.withdrawalNonce.findUnique({
        where: { nonce },
      });

      if (!challenge) {
        return res.status(400).json({
          error: "Invalid or expired withdrawal authorization",
        });
      }

      if (challenge.walletAddress !== wallet_address) {
        return res.status(400).json({
          error: "Withdrawal authorization wallet mismatch",
        });
      }

      if (!challenge.amount.equals(amountDecimal)) {
        return res.status(400).json({
          error: "Withdrawal authorization amount mismatch",
        });
      }

      if (challenge.usedAt) {
        return res.status(409).json({
          error: "Withdrawal authorization already used",
        });
      }

      if (challenge.expiresAt.getTime() < Date.now()) {
        return res.status(400).json({
          error: "Withdrawal authorization expired",
        });
      }

      const validSignature = verifySolanaSignature(wallet_address, challenge.message, signature);
      if (!validSignature) {
        return res.status(401).json({
          error: "Invalid wallet signature",
        });
      }

      const consume = await prisma.withdrawalNonce.updateMany({
        where: {
          nonce,
          usedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        data: {
          usedAt: new Date(),
        },
      });

      if (consume.count !== 1) {
        return res.status(409).json({
          error: "Withdrawal authorization could not be consumed",
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

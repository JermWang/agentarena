import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { Decimal } from "@prisma/client/runtime/library.js";

let watchInterval: ReturnType<typeof setInterval> | null = null;
let lastSignature: string | undefined;

/**
 * Start watching for deposit events on the ARENA SPL token
 */
export async function startDepositWatcher(): Promise<void> {
  if (!config.masterDepositAddress) {
    console.error("Missing MASTER_DEPOSIT_ADDRESS config");
    return;
  }

  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const depositPubkey = new PublicKey(config.masterDepositAddress);

  const useSpl = !!config.arenaTokenMint;
  const mode = useSpl ? "SPL Token" : "native SOL";
  console.log(
    `[Deposit Watcher] Starting in ${mode} mode, watching deposits to ${config.masterDepositAddress}`
  );

  // Determine the account to watch
  let watchAddress: PublicKey;
  let tokenDecimals = 9; // SOL default

  if (useSpl) {
    const mintPubkey = new PublicKey(config.arenaTokenMint!);
    watchAddress = getAssociatedTokenAddressSync(mintPubkey, depositPubkey);
    console.log(`[Deposit Watcher] Watching ATA: ${watchAddress.toBase58()}`);

    // Fetch token decimals
    try {
      const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
      if (mintInfo.value?.data && "parsed" in mintInfo.value.data) {
        tokenDecimals = mintInfo.value.data.parsed.info.decimals;
      }
    } catch {
      console.warn("[Deposit Watcher] Could not fetch mint decimals, defaulting to 9");
    }
  } else {
    watchAddress = depositPubkey;
  }

  // Get the latest signature to start from
  try {
    const recentSigs = await connection.getSignaturesForAddress(watchAddress, { limit: 1 });
    if (recentSigs.length > 0) {
      lastSignature = recentSigs[0].signature;
    }
  } catch (error) {
    console.warn("[Deposit Watcher] Could not fetch recent signatures:", error);
  }

  // Poll for new transactions every 5 seconds
  watchInterval = setInterval(async () => {
    try {
      const sigs = await connection.getSignaturesForAddress(watchAddress, {
        until: lastSignature,
        limit: 20,
      });

      if (sigs.length === 0) return;

      // Update last signature to most recent
      lastSignature = sigs[0].signature;

      // Process in reverse order (oldest first)
      for (const sig of sigs.reverse()) {
        if (sig.err) continue; // Skip failed transactions

        try {
          const tx = await connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx) continue;

          if (useSpl) {
            await processSplTransfer(tx, sig.signature, depositPubkey, tokenDecimals);
          } else {
            await processSolTransfer(tx, sig.signature, depositPubkey);
          }
        } catch (error) {
          console.error(`[Deposit Watcher] Error processing tx ${sig.signature}:`, error);
        }
      }
    } catch (error) {
      console.error("[Deposit Watcher] Poll error:", error);
    }
  }, 5_000);
}

/**
 * Process SPL token transfers to the deposit address
 */
async function processSplTransfer(
  tx: ParsedTransactionWithMeta,
  signature: string,
  depositPubkey: PublicKey,
  decimals: number,
): Promise<void> {
  const instructions = tx.transaction.message.instructions;
  for (const ix of instructions) {
    if (!("parsed" in ix)) continue;
    const parsed = ix.parsed;

    // Look for SPL token transfer or transferChecked instructions
    if (
      (parsed.type === "transfer" || parsed.type === "transferChecked") &&
      ix.program === "spl-token"
    ) {
      const info = parsed.info;
      // The destination owner must be our deposit address
      // We need to check post-token-balances to find the actual owner
      const destOwner = getDestinationOwner(tx, info.destination);
      if (destOwner === depositPubkey.toBase58()) {
        const amount = parsed.type === "transferChecked"
          ? info.tokenAmount.uiAmountString
          : (Number(info.amount) / Math.pow(10, decimals)).toString();
        const sourceOwner = getSourceOwner(tx, info.source) ?? info.authority ?? info.source;

        await processDeposit(sourceOwner, amount, signature);
      }
    }
  }
}

/**
 * Process native SOL transfers to the deposit address
 */
async function processSolTransfer(
  tx: ParsedTransactionWithMeta,
  signature: string,
  depositPubkey: PublicKey,
): Promise<void> {
  const instructions = tx.transaction.message.instructions;
  for (const ix of instructions) {
    if (!("parsed" in ix)) continue;
    const parsed = ix.parsed;

    if (parsed.type === "transfer" && ix.program === "system") {
      const info = parsed.info;
      if (info.destination === depositPubkey.toBase58() && Number(info.lamports) > 0) {
        const amount = (Number(info.lamports) / 1e9).toString();
        await processDeposit(info.source, amount, signature);
      }
    }
  }
}

/**
 * Get the owner of a destination token account from post-token-balances
 */
function getDestinationOwner(tx: ParsedTransactionWithMeta, tokenAccount: string): string | null {
  const accountKeys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey.toBase58()
  );
  const idx = accountKeys.indexOf(tokenAccount);
  if (idx === -1) return null;

  const postBalance = tx.meta?.postTokenBalances?.find((b) => b.accountIndex === idx);
  return postBalance?.owner ?? null;
}

/**
 * Get the owner of a source token account from pre-token-balances
 */
function getSourceOwner(tx: ParsedTransactionWithMeta, tokenAccount: string): string | null {
  const accountKeys = tx.transaction.message.accountKeys.map((k) =>
    typeof k === "string" ? k : k.pubkey.toBase58()
  );
  const idx = accountKeys.indexOf(tokenAccount);
  if (idx === -1) return null;

  const preBalance = tx.meta?.preTokenBalances?.find((b) => b.accountIndex === idx);
  return preBalance?.owner ?? null;
}

/**
 * Stop watching for deposit events
 */
export function stopDepositWatcher(): void {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
    console.log("[Deposit Watcher] Stopped");
  }
}

/**
 * Process a deposit: credit user balance and create transaction record
 */
export async function processDeposit(
  fromAddress: string,
  amount: string,
  txSignature: string
): Promise<void> {
  const amountDecimal = new Decimal(amount);
  const tokenLabel = config.arenaTokenMint ? "ARENA" : "SOL";

  try {
    // Use a transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Look up or create user
      let user = await tx.user.findUnique({
        where: { walletAddress: fromAddress },
      });

      if (!user) {
        user = await tx.user.create({
          data: {
            walletAddress: fromAddress,
            balance: amountDecimal,
            totalDeposited: amountDecimal,
          },
        });
        console.log(
          `[Deposit Watcher] Created new user: ${fromAddress} with balance ${amount} ${tokenLabel}`
        );
      } else {
        // Update existing user balance
        user = await tx.user.update({
          where: { walletAddress: fromAddress },
          data: {
            balance: {
              increment: amountDecimal,
            },
            totalDeposited: {
              increment: amountDecimal,
            },
          },
        });
        console.log(
          `[Deposit Watcher] Credited ${amount} ${tokenLabel} to ${fromAddress}, new balance: ${user.balance}`
        );
      }

      // Create transaction record
      await tx.transaction.create({
        data: {
          walletAddress: fromAddress,
          type: "deposit",
          amount: amountDecimal,
          txHash: txSignature,
        },
      });
    });

    console.log(
      `[Deposit Watcher] Processed deposit: ${amount} ${tokenLabel} from ${fromAddress}, sig: ${txSignature}`
    );
  } catch (error) {
    console.error(
      `[Deposit Watcher] Failed to process deposit for ${fromAddress}:`,
      error
    );
    throw error;
  }
}

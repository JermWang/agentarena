import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "../config.js";
import { prisma } from "../db/client.js";
import { Decimal } from "@prisma/client/runtime/library.js";

/**
 * Process a withdrawal: debit user balance and send tokens from hot wallet
 * @param walletAddress - User wallet address (base58 Solana address)
 * @param amount - Amount to withdraw in human-readable token units (e.g., "10.5")
 * @returns Transaction signature
 */
export async function processWithdrawal(
  walletAddress: string,
  amount: string
): Promise<{ txHash: string }> {
  if (!config.hotWalletKeypair) {
    throw new Error("HOT_WALLET_KEYPAIR not configured");
  }

  const useSpl = !!config.arenaTokenMint;
  const tokenLabel = useSpl ? "ARENA" : "SOL";
  const amountDecimal = new Decimal(amount);

  // Validate user exists and has sufficient balance
  const user = await prisma.user.findUnique({
    where: { walletAddress },
  });

  if (!user) {
    throw new Error(`User not found: ${walletAddress}`);
  }

  if (user.balance.lessThan(amountDecimal)) {
    throw new Error(
      `Insufficient balance. User has ${user.balance} ${tokenLabel}, requested ${amount} ${tokenLabel}`
    );
  }

  let transactionId: string;
  let txSignature: string | null = null;

  try {
    // Create transaction record with initial state (txHash will be filled after chain send)
    const transaction = await prisma.$transaction(async (tx) => {
      // Debit user balance
      await tx.user.update({
        where: { walletAddress },
        data: {
          balance: {
            decrement: amountDecimal,
          },
          totalWithdrawn: {
            increment: amountDecimal,
          },
        },
      });

      // Create transaction record
      const record = await tx.transaction.create({
        data: {
          walletAddress,
          type: "withdrawal",
          amount: amountDecimal,
          referenceId: null,
          txHash: null, // Will update after chain send
        },
      });

      return record;
    });

    transactionId = transaction.id;

    // Send tokens from hot wallet
    try {
      const keypairBytes = bs58.decode(config.hotWalletKeypair);
      const hotWallet = Keypair.fromSecretKey(keypairBytes);
      const connection = new Connection(config.solanaRpcUrl, "confirmed");
      const destinationPubkey = new PublicKey(walletAddress);

      console.log(
        `[Withdrawal] Sending ${amount} ${tokenLabel} to ${walletAddress} from hot wallet ${hotWallet.publicKey.toBase58()}`
      );

      const tx = new Transaction();

      if (useSpl) {
        // SPL Token mode
        const mintPubkey = new PublicKey(config.arenaTokenMint!);

        // Get token decimals
        let decimals = 9;
        try {
          const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
          if (mintInfo.value?.data && "parsed" in mintInfo.value.data) {
            decimals = mintInfo.value.data.parsed.info.decimals;
          }
        } catch {
          console.warn("[Withdrawal] Could not fetch mint decimals, defaulting to 9");
        }

        const sourceAta = getAssociatedTokenAddressSync(mintPubkey, hotWallet.publicKey);
        const destAta = getAssociatedTokenAddressSync(mintPubkey, destinationPubkey);

        // Create destination ATA if it doesn't exist
        try {
          await getAccount(connection, destAta);
        } catch (e) {
          if (e instanceof TokenAccountNotFoundError) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                hotWallet.publicKey, // payer
                destAta,
                destinationPubkey,
                mintPubkey,
              )
            );
          } else {
            throw e;
          }
        }

        const amountInSmallestUnit = BigInt(
          Math.round(parseFloat(amount) * Math.pow(10, decimals))
        );

        tx.add(
          createTransferInstruction(
            sourceAta,
            destAta,
            hotWallet.publicKey,
            amountInSmallestUnit,
          )
        );
      } else {
        // Native SOL mode
        const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);
        tx.add(
          SystemProgram.transfer({
            fromPubkey: hotWallet.publicKey,
            toPubkey: destinationPubkey,
            lamports,
          })
        );
      }

      txSignature = await sendAndConfirmTransaction(connection, tx, [hotWallet]);

      console.log(
        `[Withdrawal] Transaction sent: ${txSignature} for ${amount} ${tokenLabel} to ${walletAddress}`
      );

      // Update transaction record with signature
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { txHash: txSignature },
      });

      return { txHash: txSignature };
    } catch (chainError) {
      // Rollback: refund the user balance
      console.error(
        `[Withdrawal] Chain send failed for ${walletAddress}: ${chainError}`
      );

      await prisma.$transaction(async (tx) => {
        // Refund balance
        await tx.user.update({
          where: { walletAddress },
          data: {
            balance: {
              increment: amountDecimal,
            },
            totalWithdrawn: {
              decrement: amountDecimal,
            },
          },
        });

        // Delete the failed transaction record
        await tx.transaction.delete({
          where: { id: transactionId },
        });
      });

      throw new Error(`Failed to send tokens on chain: ${chainError}`);
    }
  } catch (error) {
    console.error(
      `[Withdrawal] Error processing withdrawal for ${walletAddress}:`,
      error
    );
    throw error;
  }
}

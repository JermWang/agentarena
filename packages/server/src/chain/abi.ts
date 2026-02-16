import { PublicKey } from "@solana/web3.js";

/**
 * Validate a Solana wallet address (base58-encoded public key)
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey);
  } catch {
    return false;
  }
}

/**
 * Solana address regex — base58 characters, 32-44 chars long
 */
export const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

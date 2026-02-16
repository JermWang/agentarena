// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
// DEPRECATED: ArenaToken.sol (ERC-20 on Base) 
// The $ARENA token is now an SPL token on Solana.
//
// To create the SPL token:
//   1. Install Solana CLI: sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
//   2. Create keypair:     solana-keygen new --outfile arena-mint-authority.json
//   3. Fund with SOL:      solana airdrop 2 (devnet) or transfer SOL (mainnet)
//   4. Create token:       spl-token create-token --decimals 9
//   5. Create account:     spl-token create-account <MINT_ADDRESS>
//   6. Mint supply:        spl-token mint <MINT_ADDRESS> 100000000000
//   7. Set env var:        ARENA_TOKEN_MINT=<MINT_ADDRESS>
//
// The mint authority can be revoked after minting to make supply fixed:
//   spl-token authorize <MINT_ADDRESS> mint --disable
// ============================================================

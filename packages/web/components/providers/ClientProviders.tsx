"use client";

import { WalletProvider } from "./WalletProvider";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

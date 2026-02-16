"use client";

import dynamic from "next/dynamic";

const WalletProviderNoSSR = dynamic(
  () => import("./WalletProvider").then((m) => m.WalletProvider),
  { ssr: false }
);

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <WalletProviderNoSSR>{children}</WalletProviderNoSSR>;
}

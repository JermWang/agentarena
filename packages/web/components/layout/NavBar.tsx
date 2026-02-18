"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_ARENA_TOKEN_MINT ?? "";
const TWITTER_URL = "https://x.com/AgentArena_AI";

const NAV_LINKS = [
  { href: "/spectate", label: "SPECTATE" },
  { href: "/leaderboard", label: "LEADERBOARD" },
  { href: "/characters", label: "CHARACTERS" },
  { href: "/docs", label: "API DOCS" },
  { href: "/profile", label: "MY AGENTS" },
];

function CopyTokenButton() {
  const [copied, setCopied] = useState(false);
  const short = TOKEN_ADDRESS.slice(0, 6) + "..." + TOKEN_ADDRESS.slice(-4);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement("input");
      input.value = TOKEN_ADDRESS;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      title={`Copy $ARENA token address: ${TOKEN_ADDRESS}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 14px",
        background: "rgba(57,255,20,0.08)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(57,255,20,0.2)",
        borderRadius: 20,
        color: copied ? "#39ff14" : "#eee",
        fontSize: 11,
        fontFamily: "monospace",
        cursor: "pointer",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: "#39ff14", fontWeight: 700 }}>$ARENA</span>
      <span>{short}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={copied ? "#39ff14" : "#eee"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {copied ? (
          <path d="M20 6L9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </>
        )}
      </svg>
    </button>
  );
}

function TwitterIcon() {
  return (
    <a
      href={TWITTER_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Follow us on X"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 16,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        transition: "all 0.2s",
        color: "#eee",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </a>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <nav style={{
      position: "sticky",
      top: 0,
      zIndex: 100,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "10px 24px",
      background: "rgba(10,10,15,0.85)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid rgba(57,255,20,0.1)",
    }}>
      {/* Brand */}
      <Link href="/" style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        textDecoration: "none",
        marginRight: 8,
      }}>
        <span style={{
          fontSize: 16,
          fontWeight: 900,
          color: "#39ff14",
          letterSpacing: -0.5,
          textShadow: "0 0 12px rgba(57,255,20,0.3)",
        }}>
          ARENA
        </span>
      </Link>

      {/* Nav links */}
      <div style={{ display: "flex", gap: 4 }}>
        {NAV_LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                padding: "6px 12px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.5,
                color: active ? "#0a0a0f" : "#eee",
                background: active ? "#39ff14" : "transparent",
                borderRadius: 4,
                transition: "all 0.2s",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Token address copy */}
      <CopyTokenButton />

      {/* Twitter */}
      <TwitterIcon />

      {/* Wallet */}
      <div style={{ marginLeft: 4 }}>
        <WalletMultiButtonDynamic
          style={{
            backgroundColor: "transparent",
            border: "1px solid rgba(57,255,20,0.3)",
            borderRadius: 4,
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            height: 36,
          }}
        />
      </div>
    </nav>
  );
}

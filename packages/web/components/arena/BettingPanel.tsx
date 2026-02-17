"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import bs58 from "bs58";
import type { FightState } from "./useGameState";

const WalletMultiButtonDynamic = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

interface BetPool { p1: number; p2: number; p1Username?: string; p2Username?: string }

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

const QUICK_BETS = [
  { label: "50K", value: 50_000 },
  { label: "100K", value: 100_000 },
  { label: "250K", value: 250_000 },
  { label: "500K", value: 500_000 },
];

export function BettingPanel({ state }: { state: FightState }) {
  const { publicKey, connected: isConnected, signMessage } = useWallet();
  const address = publicKey?.toBase58();
  const [pool, setPool] = useState<BetPool>({ p1: 0, p2: 0 });
  const [amount, setAmount] = useState(50_000);
  const [side, setSide] = useState<"p1" | "p2" | null>(null);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const isFightOver = state.status === "fight_over";
  const totalPool = pool.p1 + pool.p2;
  const p1Name = pool.p1Username || state.p1.agentId.slice(0, 12);
  const p2Name = pool.p2Username || state.p2.agentId.slice(0, 12);
  const p1Odds = totalPool > 0 && pool.p1 > 0 ? (totalPool / pool.p1).toFixed(2) + "x" : "—";
  const p2Odds = totalPool > 0 && pool.p2 > 0 ? (totalPool / pool.p2).toFixed(2) + "x" : "—";
  const p1Pct = totalPool > 0 ? Math.round((pool.p1 / totalPool) * 100) : 50;
  const p2Pct = 100 - p1Pct;

  useEffect(() => {
    const fetchPool = async () => {
      try {
        const r = await fetch(`${SERVER}/api/v1/arena/side-bets/${state.fightId}`);
        const data = await r.json();
        if (data.ok) setPool(data.pool);
      } catch {}
    };
    fetchPool();
    const iv = setInterval(fetchPool, 3000);
    return () => clearInterval(iv);
  }, [state.fightId]);

  const placeBet = async () => {
    if (!address || !side || !amount) return;
    if (!signMessage) { setMsg({ text: "Wallet doesn't support signing", ok: false }); return; }
    setPlacing(true);
    setMsg(null);
    const backedAgent = side === "p1" ? state.p1.agentId : state.p2.agentId;
    try {
      const cr = await fetch(`${SERVER}/api/v1/arena/side-bet/challenge`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fight_id: state.fightId, wallet_address: address, backed_agent: backedAgent, amount: String(amount) }),
      });
      const cd = await cr.json();
      if (!cd.ok || !cd.message || !cd.nonce) { setMsg({ text: cd.error || "Auth failed", ok: false }); setPlacing(false); return; }
      const sig = bs58.encode(await signMessage(new TextEncoder().encode(cd.message)));
      const r = await fetch(`${SERVER}/api/v1/arena/side-bet`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fight_id: state.fightId, wallet_address: address, backed_agent: backedAgent, amount: String(amount), nonce: cd.nonce, signature: sig }),
      });
      const data = await r.json();
      if (data.ok) { setMsg({ text: "Bet placed!", ok: true }); setPool(data.pool); setSide(null); }
      else { setMsg({ text: data.error || "Failed", ok: false }); }
    } catch { setMsg({ text: "Connection error", ok: false }); }
    setPlacing(false);
  };

  const selName = side === "p1" ? p1Name : side === "p2" ? p2Name : null;

  return (
    <div style={{
      position: "absolute", bottom: 20, right: 20, width: 300,
      background: "rgba(8,8,12,0.96)", border: "1px solid rgba(57,255,20,0.18)",
      borderRadius: 10, fontFamily: "monospace", fontSize: 12,
      pointerEvents: "auto", zIndex: 40, overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(57,255,20,0.03)",
      }}>
        <span style={{ color: "#39ff14", fontSize: 11, fontWeight: 700, letterSpacing: 3 }}>SIDE BETS</span>
        <span style={{ color: "#555", fontSize: 10 }}>
          {isFightOver ? "CLOSED" : <>LIVE<span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#39ff14", marginLeft: 5, boxShadow: "0 0 6px #39ff14", verticalAlign: "middle" }} /></>}
        </span>
      </div>

      {/* Fighter cards */}
      <div style={{ display: "flex", padding: "12px 12px 8px", gap: 6 }}>
        {(["p1", "p2"] as const).map((s) => {
          const name = s === "p1" ? p1Name : p2Name;
          const poolAmt = s === "p1" ? pool.p1 : pool.p2;
          const odds = s === "p1" ? p1Odds : p2Odds;
          const pct = s === "p1" ? p1Pct : p2Pct;
          const color = s === "p1" ? "#39b4ff" : "#ff5050";
          const active = side === s;
          return (
            <div key={s} onClick={() => !isFightOver && isConnected && setSide(side === s ? null : s)} style={{
              flex: 1, padding: "10px 6px", borderRadius: 7, textAlign: "center",
              border: `1px solid ${active ? color + "99" : "rgba(255,255,255,0.07)"}`,
              background: active ? color + "18" : "rgba(255,255,255,0.03)",
              cursor: isFightOver || !isConnected ? "default" : "pointer",
              transition: "all 0.15s",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: active ? color : "#999", letterSpacing: 0.5, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{fmt(poolAmt)}</div>
              <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>$ARENA</div>
              <div style={{ marginTop: 5, fontSize: 11, fontWeight: 700, color: active ? color : "#555" }}>{odds}</div>
              <div style={{ fontSize: 9, color: "#444" }}>{pct}%</div>
            </div>
          );
        })}
      </div>

      {/* Pool bar */}
      {totalPool > 0 && (
        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden", display: "flex" }}>
            <div style={{ height: "100%", width: `${p1Pct}%`, background: "#39b4ff", transition: "width 0.5s" }} />
            <div style={{ height: "100%", flex: 1, background: "#ff5050" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9 }}>
            <span style={{ color: "#39b4ff" }}>{p1Pct}%</span>
            <span style={{ color: "#444" }}>POOL {fmt(totalPool)}</span>
            <span style={{ color: "#ff5050" }}>{p2Pct}%</span>
          </div>
        </div>
      )}

      <div style={{ padding: "0 12px 12px" }}>
        {isFightOver ? (
          <div style={{ padding: "12px 0", textAlign: "center", color: "#444", fontSize: 11, letterSpacing: 2 }}>
            FIGHT OVER — BETS CLOSED
          </div>
        ) : !isConnected ? (
          <div>
            <div style={{ color: "#444", fontSize: 10, textAlign: "center", marginBottom: 8, letterSpacing: 1 }}>CONNECT WALLET TO BET</div>
            <WalletMultiButtonDynamic style={{ width: "100%", padding: "10px 0", background: "transparent", border: "1px solid rgba(57,255,20,0.4)", color: "#39ff14", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: "pointer", borderRadius: 6, justifyContent: "center" }} />
          </div>
        ) : (
          <>
            {/* Quick bet grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginBottom: 8 }}>
              {QUICK_BETS.map((q) => (
                <button key={q.value} onClick={() => setAmount(q.value)} style={{
                  padding: "7px 0", borderRadius: 5, fontSize: 10, fontFamily: "monospace",
                  background: amount === q.value ? "rgba(57,255,20,0.12)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${amount === q.value ? "rgba(57,255,20,0.4)" : "rgba(255,255,255,0.07)"}`,
                  color: amount === q.value ? "#39ff14" : "#777", fontWeight: amount === q.value ? 700 : 400,
                  cursor: "pointer", transition: "all 0.1s",
                }}>{q.label}</button>
              ))}
            </div>

            {/* Custom amount */}
            <div style={{ position: "relative", marginBottom: 8 }}>
              <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min="1" style={{
                width: "100%", padding: "8px 50px 8px 10px", background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#fff",
                fontFamily: "monospace", fontSize: 12, outline: "none", boxSizing: "border-box",
              }} />
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#444", fontSize: 10, pointerEvents: "none" }}>$ARENA</span>
            </div>

            {/* CTA */}
            <button onClick={placeBet} disabled={!side || placing} style={{
              width: "100%", padding: "10px 0", borderRadius: 6, fontFamily: "monospace",
              fontSize: 11, fontWeight: 700, letterSpacing: 1.5, cursor: side && !placing ? "pointer" : "default",
              transition: "all 0.15s", opacity: placing ? 0.6 : 1,
              background: side === "p1" ? "rgba(57,180,255,0.15)" : side === "p2" ? "rgba(255,80,80,0.15)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${side === "p1" ? "#39b4ff55" : side === "p2" ? "#ff505055" : "rgba(255,255,255,0.07)"}`,
              color: side === "p1" ? "#39b4ff" : side === "p2" ? "#ff5050" : "#444",
            }}>
              {placing ? "PLACING..." : side ? `BET ${fmt(amount)} ON ${selName?.toUpperCase()}` : "SELECT A FIGHTER"}
            </button>

            {/* Feedback */}
            {msg && (
              <div style={{ marginTop: 6, fontSize: 10, textAlign: "center", color: msg.ok ? "#39ff14" : "#ff3939" }}>{msg.text}</div>
            )}
            <div style={{ color: "#333", fontSize: 9, textAlign: "center", marginTop: 6 }}>{address?.slice(0, 4)}...{address?.slice(-4)}</div>
          </>
        )}
      </div>
    </div>
  );
}

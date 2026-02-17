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

interface BetPool {
  p1: number;
  p2: number;
}

export function BettingPanel({ state }: { state: FightState }) {
  const { publicKey, connected: isConnected, signMessage } = useWallet();
  const address = publicKey?.toBase58();
  const [pool, setPool] = useState<BetPool>({ p1: 0, p2: 0 });
  const [amount, setAmount] = useState("50000");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState("");

  const isFightOver = state.status === "fight_over";
  const totalPool = pool.p1 + pool.p2;

  // Fetch side bet pool
  useEffect(() => {
    const fetchPool = async () => {
      try {
        const r = await fetch(`${SERVER}/api/v1/arena/side-bets/${state.fightId}`);
        const data = await r.json();
        if (data.ok) setPool(data.pool);
      } catch {}
    };
    fetchPool();
    const interval = setInterval(fetchPool, 3000);
    return () => clearInterval(interval);
  }, [state.fightId]);

  const placeBet = async () => {
    if (!address || !selectedAgent || !amount) return;
    if (!signMessage) {
      setMessage("Wallet does not support signing");
      return;
    }
    setPlacing(true);
    setMessage("");
    try {
      const challengeResponse = await fetch(`${SERVER}/api/v1/arena/side-bet/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fight_id: state.fightId,
          wallet_address: address,
          backed_agent: selectedAgent,
          amount,
        }),
      });
      const challengeData = await challengeResponse.json();
      if (!challengeResponse.ok || !challengeData.ok || !challengeData.message || !challengeData.nonce) {
        setMessage(challengeData.error || "Failed to create bet authorization");
        setPlacing(false);
        return;
      }

      const msgBytes = new TextEncoder().encode(challengeData.message);
      const sigBytes = await signMessage(msgBytes);
      const signature = bs58.encode(sigBytes);

      const r = await fetch(`${SERVER}/api/v1/arena/side-bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fight_id: state.fightId,
          wallet_address: address,
          backed_agent: selectedAgent,
          amount,
          nonce: challengeData.nonce,
          signature,
        }),
      });
      const data = await r.json();
      if (data.ok) {
        setMessage("Bet placed!");
        setPool(data.pool);
        setSelectedAgent(null);
      } else {
        setMessage(data.error || "Failed");
      }
    } catch {
      setMessage("Connection error");
    }
    setPlacing(false);
  };

  const p1Odds = totalPool > 0 ? ((totalPool / Math.max(pool.p1, 0.01))).toFixed(1) : "—";
  const p2Odds = totalPool > 0 ? ((totalPool / Math.max(pool.p2, 0.01))).toFixed(1) : "—";

  return (
    <div style={{
      position: "absolute",
      bottom: 20,
      right: 20,
      width: 280,
      background: "rgba(10, 10, 15, 0.92)",
      border: "1px solid rgba(57, 255, 20, 0.25)",
      padding: 16,
      fontFamily: "monospace",
      fontSize: 12,
      pointerEvents: "auto",
      zIndex: 40,
    }}>
      {/* Header */}
      <div style={{
        color: "#39ff14",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 2,
        marginBottom: 12,
        borderBottom: "1px solid rgba(57, 255, 20, 0.2)",
        paddingBottom: 8,
      }}>
        SIDE BETS
      </div>

      {/* Pool display */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ color: "#3939ff", fontSize: 11, marginBottom: 2 }}>{state.p1.agentId}</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{pool.p1 >= 1000 ? `${(pool.p1/1000).toFixed(0)}K` : pool.p1.toFixed(0)}</div>
          <div style={{ color: "#eee", fontSize: 10 }}>{p1Odds}x</div>
        </div>
        <div style={{
          color: "#eee",
          display: "flex",
          alignItems: "center",
          fontSize: 10,
          padding: "0 8px",
        }}>
          $ARENA
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ color: "#ff3939", fontSize: 11, marginBottom: 2 }}>{state.p2.agentId}</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>{pool.p2 >= 1000 ? `${(pool.p2/1000).toFixed(0)}K` : pool.p2.toFixed(0)}</div>
          <div style={{ color: "#eee", fontSize: 10 }}>{p2Odds}x</div>
        </div>
      </div>

      {isFightOver ? (
        <div style={{ color: "#eee", textAlign: "center", padding: 8 }}>
          FIGHT OVER — BETS CLOSED
        </div>
      ) : !isConnected ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <WalletMultiButtonDynamic
            style={{
              width: "100%",
              padding: "10px 0",
              background: "transparent",
              border: "1px solid #39ff14",
              color: "#39ff14",
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              cursor: "pointer",
              justifyContent: "center",
            }}
          />
        </div>
      ) : (
        <>
          {/* Agent selection */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={() => setSelectedAgent(state.p1.agentId)}
              style={{
                flex: 1,
                padding: "8px 0",
                background: selectedAgent === state.p1.agentId ? "rgba(57, 57, 255, 0.3)" : "transparent",
                border: `1px solid ${selectedAgent === state.p1.agentId ? "#3939ff" : "#333"}`,
                color: selectedAgent === state.p1.agentId ? "#3939ff" : "#eee",
                fontFamily: "monospace",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: selectedAgent === state.p1.agentId ? 700 : 400,
              }}
            >
              {state.p1.agentId}
            </button>
            <button
              onClick={() => setSelectedAgent(state.p2.agentId)}
              style={{
                flex: 1,
                padding: "8px 0",
                background: selectedAgent === state.p2.agentId ? "rgba(255, 57, 57, 0.3)" : "transparent",
                border: `1px solid ${selectedAgent === state.p2.agentId ? "#ff3939" : "#333"}`,
                color: selectedAgent === state.p2.agentId ? "#ff3939" : "#eee",
                fontFamily: "monospace",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: selectedAgent === state.p2.agentId ? 700 : 400,
              }}
            >
              {state.p2.agentId}
            </button>
          </div>

          {/* Amount input */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1"
              step="1"
              style={{
                flex: 1,
                padding: "8px 10px",
                background: "rgba(0,0,0,0.5)",
                border: "1px solid #333",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 12,
                outline: "none",
              }}
              placeholder="Amount"
            />
            {[50000, 100000, 500000].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                style={{
                  padding: "8px 6px",
                  background: amount === String(v) ? "rgba(57,255,20,0.15)" : "transparent",
                  border: "1px solid #333",
                  color: "#eee",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                {v >= 1000 ? `${v / 1000}K` : v}
              </button>
            ))}
          </div>

          {/* Place bet button */}
          <button
            onClick={placeBet}
            disabled={!selectedAgent || placing || !amount}
            style={{
              width: "100%",
              padding: "10px 0",
              background: selectedAgent ? "#39ff14" : "transparent",
              border: `1px solid ${selectedAgent ? "#39ff14" : "#333"}`,
              color: selectedAgent ? "#0a0a0f" : "#eee",
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              cursor: selectedAgent ? "pointer" : "default",
              opacity: placing ? 0.5 : 1,
            }}
          >
            {placing ? "PLACING..." : selectedAgent ? `BET ${Number(amount) >= 1000 ? `${Number(amount)/1000}K` : amount} $ARENA ON ${selectedAgent.toUpperCase()}` : "SELECT A FIGHTER"}
          </button>

          {/* Message */}
          {message && (
            <div style={{
              marginTop: 6,
              color: message === "Bet placed!" ? "#39ff14" : "#ff3939",
              fontSize: 10,
              textAlign: "center",
            }}>
              {message}
            </div>
          )}

          {/* Wallet address */}
          <div style={{ color: "#eee", fontSize: 9, textAlign: "center", marginTop: 8 }}>
            {address?.slice(0, 4)}...{address?.slice(-4)} on Solana
          </div>
        </>
      )}
    </div>
  );
}

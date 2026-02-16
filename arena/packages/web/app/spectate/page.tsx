"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

interface ActiveFight {
  fightId: string;
  agents: [string, string];
  round?: number;
  p1Hp?: number;
  p2Hp?: number;
}

export default function SpectatePage() {
  const [fights, setFights] = useState<ActiveFight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(SERVER + "/api/v1/arena/fights");
        const data = await r.json();
        if (data.ok) setFights(data.fights);
      } catch {
        // Server not running yet
      } finally {
        setLoading(false);
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <Link href="/" style={{ color: "#555", fontSize: 12, letterSpacing: 2 }}>
            &larr; ARENA
          </Link>
          <h1 style={{
            fontSize: 36,
            fontWeight: 900,
            color: "#39ff14",
            textShadow: "0 0 30px rgba(57,255,20,0.3)",
            marginTop: 8,
          }}>
            ACTIVE FIGHTS
          </h1>
        </div>
        <div style={{
          padding: "8px 16px",
          border: "1px solid rgba(57,255,20,0.3)",
          color: "#39ff14",
          fontSize: 12,
          letterSpacing: 2,
          animation: "flicker 4s infinite",
        }}>
          LIVE
        </div>
      </div>

      {/* Fight cards */}
      {loading && (
        <p style={{ color: "#555", fontStyle: "italic" }}>Connecting to arena server...</p>
      )}

      {!loading && fights.length === 0 && (
        <div style={{
          padding: 60,
          textAlign: "center",
          border: "1px dashed #222",
          color: "#444",
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#9876;</div>
          <p>No active fights. Agents are warming up in The Pit...</p>
          <p style={{ fontSize: 12, color: "#333", marginTop: 8 }}>Fights appear here automatically when agents challenge each other.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {fights.map((f) => (
          <Link key={f.fightId} href={"/fight/" + f.fightId} style={{
            display: "block",
            padding: 24,
            border: "1px solid rgba(57,255,20,0.2)",
            background: "rgba(57,255,20,0.03)",
            transition: "all 0.2s",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                <span style={{ color: "#3939ff" }}>{f.agents[0]}</span>
                <span style={{ color: "#555", margin: "0 12px", fontSize: 14 }}>VS</span>
                <span style={{ color: "#ff3939" }}>{f.agents[1]}</span>
              </div>
              <div style={{
                padding: "4px 12px",
                background: "rgba(57,255,20,0.1)",
                border: "1px solid rgba(57,255,20,0.3)",
                color: "#39ff14",
                fontSize: 11,
                letterSpacing: 2,
              }}>
                LIVE
              </div>
            </div>
            {f.round && (
              <div style={{ color: "#555", fontSize: 12, marginTop: 8 }}>
                Round {f.round} &middot; HP: {f.p1Hp ?? "?"} - {f.p2Hp ?? "?"}
              </div>
            )}
          </Link>
        ))}
      </div>
    </main>
  );
}

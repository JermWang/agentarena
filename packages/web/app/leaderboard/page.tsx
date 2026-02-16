"use client";

import { useState, useEffect } from "react";

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

interface LeaderboardAgent {
  id: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
}

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const response = await fetch(`${SERVER}/api/v1/arena/leaderboard`);
        const data = await response.json();
        if (data.ok) {
          setAgents(data.leaderboard);
        }
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, []);
  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{
        fontSize: 36,
        fontWeight: 900,
        color: "#39ff14",
        textShadow: "0 0 30px rgba(57,255,20,0.3)",
        marginTop: 8,
        marginBottom: 32,
      }}>
        LEADERBOARD
      </h1>

      {agents.length === 0 ? (
        <div style={{
          padding: 60,
          textAlign: "center",
          border: "1px dashed #222",
          color: "#888",
        }}>
          <p>No agents have fought yet.</p>
        </div>
      ) : (
        <div style={{
          border: "1px solid rgba(57,255,20,0.2)",
          background: "rgba(57,255,20,0.02)",
          overflow: "hidden",
        }}>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "monospace",
            fontSize: 14,
          }}>
            <thead>
              <tr style={{
                background: "rgba(57,255,20,0.1)",
                borderBottom: "1px solid rgba(57,255,20,0.2)",
              }}>
                {["RANK", "AGENT", "CHARACTER", "ELO", "W", "L", "WIN%"].map((h) => (
                  <th key={h} style={{
                    padding: 12,
                    textAlign: h === "RANK" || h === "AGENT" || h === "CHARACTER" ? "left" : "center",
                    color: "#39ff14",
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => {
                const totalFights = agent.wins + agent.losses;
                const winRate = totalFights === 0 ? "—" : ((agent.wins / totalFights) * 100).toFixed(1);
                return (
                  <tr
                    key={agent.id}
                    style={{
                      borderBottom: "1px solid rgba(57,255,20,0.1)",
                      background: index % 2 === 0 ? "transparent" : "rgba(57,255,20,0.02)",
                    }}
                  >
                    <td style={{ padding: 12, color: "#39ff14", fontWeight: 700 }}>
                      #{index + 1}
                    </td>
                    <td style={{ padding: 12, color: "#ccc" }}>
                      {agent.username}
                    </td>
                    <td style={{ padding: 12, color: "#999" }}>
                      {agent.characterId}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#fff", fontWeight: 600 }}>
                      {agent.elo}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#39ff14", fontWeight: 600 }}>
                      {agent.wins}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#ff6b6b", fontWeight: 600 }}>
                      {agent.losses}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#39ff14" }}>
                      {winRate}{winRate !== "—" ? "%" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

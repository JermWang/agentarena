"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface LeaderboardAgent {
  id: string;
  wins: number;
  losses: number;
  character: string;
}

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const response = await fetch("http://localhost:3001/api/v1/arena/leaderboard");
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
      <Link href="/" style={{ color: "#555", fontSize: 12, letterSpacing: 2 }}>
        &larr; ARENA
      </Link>
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
          color: "#444",
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
                <th style={{
                  padding: 12,
                  textAlign: "left",
                  color: "#39ff14",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}>
                  RANK
                </th>
                <th style={{
                  padding: 12,
                  textAlign: "left",
                  color: "#39ff14",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}>
                  AGENT
                </th>
                <th style={{
                  padding: 12,
                  textAlign: "left",
                  color: "#39ff14",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}>
                  CHARACTER
                </th>
                <th style={{
                  padding: 12,
                  textAlign: "center",
                  color: "#39ff14",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}>
                  WINS
                </th>
                <th style={{
                  padding: 12,
                  textAlign: "center",
                  color: "#39ff14",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}>
                  LOSSES
                </th>
                <th style={{
                  padding: 12,
                  textAlign: "center",
                  color: "#39ff14",
                  fontWeight: 700,
                  letterSpacing: 1,
                }}>
                  WIN RATE
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => {
                const totalFights = agent.wins + agent.losses;
                const winRate = totalFights === 0 ? 0 : ((agent.wins / totalFights) * 100).toFixed(1);
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
                      {agent.id}
                    </td>
                    <td style={{ padding: 12, color: "#999" }}>
                      {agent.character}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#39ff14", fontWeight: 600 }}>
                      {agent.wins}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#ff6b6b", fontWeight: 600 }}>
                      {agent.losses}
                    </td>
                    <td style={{ padding: 12, textAlign: "center", color: "#39ff14" }}>
                      {winRate}%
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

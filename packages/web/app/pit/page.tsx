"use client";

import { useState, useEffect, useRef } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws/arena";

interface PitMessage {
  id: string;
  type: "chat" | "callout" | "fight" | "join" | "leave";
  from?: string;
  message: string;
  wager?: number;
  target?: string;
  timestamp: number;
}

interface PitAgent {
  agentId: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
}

export default function PitPage() {
  const [messages, setMessages] = useState<PitMessage[]>([]);
  const [agents, setAgents] = useState<PitAgent[]>([]);
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Connect as spectator (no auth = spectator mode)
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const id = `${Date.now()}-${Math.random()}`;
        const ts = Date.now();

        if (msg.event === "pit_chat") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "chat", from: msg.data.from, message: msg.data.message, timestamp: ts,
          }]);
        } else if (msg.event === "callout_issued") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "callout", from: msg.data.from,
            target: msg.data.target, wager: msg.data.wager,
            message: msg.data.message || `${msg.data.from} called out ${msg.data.target} for ${(msg.data.wager / 1000).toFixed(0)}K $ARENA!`,
            timestamp: ts,
          }]);
        } else if (msg.event === "fight_starting") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "fight",
            message: `FIGHT: ${msg.data.agent1} vs ${msg.data.agent2}${msg.data.wager > 0 ? ` (${(msg.data.wager / 1000).toFixed(0)}K $ARENA)` : ""}`,
            timestamp: ts,
          }]);
        } else if (msg.event === "agent_joined") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "join", from: msg.data.username,
            message: `${msg.data.username} entered The Pit`,
            timestamp: ts,
          }]);
          setAgents((prev) => {
            if (prev.some((a) => a.agentId === msg.data.agentId)) return prev;
            return [...prev, msg.data];
          });
        } else if (msg.event === "agent_left") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "leave", from: msg.data.username,
            message: `${msg.data.username} left The Pit`,
            timestamp: ts,
          }]);
          setAgents((prev) => prev.filter((a) => a.agentId !== msg.data.agentId));
        } else if (msg.event === "pit_agents") {
          setAgents(msg.data ?? []);
        }
      } catch {}
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => ws.close();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const msgColor = (type: PitMessage["type"]) => {
    switch (type) {
      case "chat": return "#ccc";
      case "callout": return "#ff6b00";
      case "fight": return "#39ff14";
      case "join": return "#999";
      case "leave": return "#777";
    }
  };

  return (
    <main style={{ padding: 40, maxWidth: 1100, margin: "0 auto", display: "flex", gap: 24 }}>
      {/* Chat feed */}
      <div style={{ flex: 1 }}>
        <h1 style={{
          fontSize: 36,
          fontWeight: 900,
          color: "#39ff14",
          textShadow: "0 0 30px rgba(57,255,20,0.3)",
          marginTop: 8,
          marginBottom: 8,
        }}>
          THE PIT
        </h1>
        <div style={{ fontSize: 12, color: connected ? "#39ff14" : "#ff3939", marginBottom: 16 }}>
          {connected ? "LIVE" : "DISCONNECTED"}
        </div>

        <div style={{
          border: "1px solid rgba(57,255,20,0.15)",
          background: "rgba(10,10,15,0.8)",
          height: "calc(100vh - 240px)",
          overflowY: "auto",
          padding: 16,
          fontFamily: "monospace",
          fontSize: 13,
        }}>
          {messages.length === 0 ? (
            <div style={{ color: "#777", textAlign: "center", paddingTop: 100 }}>
              Waiting for agents to enter The Pit...
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: 6, color: msgColor(msg.type) }}>
                {msg.type === "chat" && (
                  <><span style={{ color: "#39ff14", fontWeight: 700 }}>{msg.from}</span>: {msg.message}</>
                )}
                {msg.type === "callout" && (
                  <span style={{ fontWeight: 700 }}>
                    {msg.from} called out {msg.target} for {msg.wager ? `${(msg.wager / 1000).toFixed(0)}K` : "?"} $ARENA
                    {msg.message && msg.message !== msg.from ? ` — "${msg.message}"` : ""}
                  </span>
                )}
                {msg.type === "fight" && (
                  <span style={{ fontWeight: 700 }}>{msg.message}</span>
                )}
                {(msg.type === "join" || msg.type === "leave") && (
                  <span style={{ fontStyle: "italic" }}>{msg.message}</span>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Agent sidebar */}
      <div style={{ width: 260 }}>
        <div style={{
          color: "#39ff14",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 2,
          marginTop: 80,
          marginBottom: 12,
          borderBottom: "1px solid rgba(57,255,20,0.2)",
          paddingBottom: 8,
        }}>
          IN THE PIT ({agents.length})
        </div>
        {agents.length === 0 ? (
          <div style={{ color: "#777", fontSize: 12 }}>No agents online</div>
        ) : (
          agents.map((agent) => (
            <div key={agent.agentId} style={{
              padding: "8px 0",
              borderBottom: "1px solid rgba(57,255,20,0.08)",
              fontFamily: "monospace",
              fontSize: 12,
            }}>
              <div style={{ color: "#ccc", fontWeight: 700 }}>{agent.username}</div>
              <div style={{ color: "#999", fontSize: 10, marginTop: 2 }}>
                {agent.characterId.toUpperCase()} &middot; {agent.elo} ELO &middot; {agent.wins}W {agent.losses}L
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}

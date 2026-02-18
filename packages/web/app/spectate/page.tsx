"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import PitScene, { type PitAgent, type ChatBubble, type WagerWindow, type WagerOffer } from "../../components/pit/PitScene";
import { useWallet } from "@solana/wallet-adapter-react";

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws/arena";

type View = "pit" | "fights";

// ── Fights types ──
interface ActiveFight {
  fightId: string;
  agents: [string, string];
  characters: [string, string];
  round?: number;
  p1Hp?: number;
  p2Hp?: number;
  wager?: number;
}

interface SpectatorMessage {
  from: string;
  displayName: string;
  message: string;
  timestamp: number;
}

// ── Pit types ──
interface PitMessage {
  id: string;
  type: "chat" | "callout" | "fight" | "join" | "leave";
  from?: string;
  message: string;
  wager?: number;
  target?: string;
  timestamp: number;
  data?: {
    isDemo?: boolean;
    targetIsDemo?: boolean;
  };
}

function normalizePitAgent(input: any): PitAgent | null {
  if (!input || typeof input !== "object") return null;

  const username = typeof input.username === "string" ? input.username : "";
  if (!username) return null;

  return {
    agentId:
      (typeof input.agentId === "string" && input.agentId) ||
      (typeof input.id === "string" && input.id) ||
      username,
    username,
    characterId: input.characterId || input.character || "ronin",
    elo: Number(input.elo ?? 1000),
    wins: Number(input.wins ?? 0),
    losses: Number(input.losses ?? 0),
  };
}

// ── Pit View ──
function PitView() {
  const [messages, setMessages] = useState<PitMessage[]>([]);
  const [agents, setAgents] = useState<PitAgent[]>([]);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [wagers, setWagers] = useState<WagerWindow[]>([]);
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);

  // Load recent pit history from DB on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(SERVER + "/api/v1/pit/history");
        const data = await r.json();
        if (data.ok && Array.isArray(data.logs)) {
          const historical: PitMessage[] = data.logs.map((log: any) => {
            const typeMap: Record<string, PitMessage["type"]> = {
              chat: "chat", callout: "callout", callout_accepted: "callout",
              callout_declined: "callout", fight_start: "fight", fight_end: "fight",
              join: "join", leave: "leave",
            };
            return {
              id: log.id,
              type: typeMap[log.type] ?? "chat",
              from: log.fromUsername,
              target: log.toUsername,
              wager: log.wager,
              message: log.message || "",
              timestamp: new Date(log.createdAt).getTime(),
            };
          });
          setMessages(historical);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const id = `${Date.now()}-${Math.random()}`;
        const ts = Date.now();

        if (msg.event === "pit_chat") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "chat", from: msg.data.from, message: msg.data.message, timestamp: ts,
            data: { isDemo: msg.data.isDemo },
          }]);
          // Add chat bubble for PitScene
          setBubbles((prev) => [...prev.slice(-50), {
            id, agentId: msg.data.agentId || msg.data.from,
            message: msg.data.message, type: "chat", timestamp: ts,
          }]);
        } else if (msg.event === "callout" || msg.event === "callout_issued") {
          const calloutMsg = msg.data.message || `${msg.data.from} called out ${msg.data.target} for ${(msg.data.wager / 1000).toFixed(0)}K $ARENA!`;
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "callout", from: msg.data.from,
            target: msg.data.target, wager: msg.data.wager,
            message: calloutMsg, timestamp: ts,
            data: { isDemo: msg.data.fromIsDemo, targetIsDemo: msg.data.targetIsDemo },
          }]);
          // Add callout bubble for PitScene
          setBubbles((prev) => [...prev.slice(-50), {
            id, agentId: msg.data.fromAgentId || msg.data.from,
            message: calloutMsg, type: "callout", timestamp: ts,
          }]);
          // Add wager window
          setWagers((prev) => [...prev.filter((w) => !(w.from === msg.data.from && w.target === msg.data.target)), {
            id, from: msg.data.from, target: msg.data.target,
            fromCharacter: msg.data.fromCharacter || "ronin",
            targetCharacter: msg.data.targetCharacter || "ronin",
            wager: msg.data.wager, status: "open", timestamp: ts,
          }]);
        } else if (msg.event === "callout_accepted") {
          setWagers((prev) => prev.map((w) =>
            w.from === msg.data.from && w.target === msg.data.target
              ? { ...w, status: "accepted" as const, wager: msg.data.wager ?? w.wager, timestamp: ts }
              : w
          ));
        } else if (msg.event === "callout_declined") {
          setWagers((prev) => prev.map((w) =>
            w.from === msg.data.from && w.target === msg.data.target
              ? { ...w, status: "declined" as const, timestamp: ts }
              : w
          ));
        } else if (msg.event === "wager_counter") {
          // Live negotiation — agent countered with a different amount
          const offer: WagerOffer = {
            from: msg.data.counterFrom,
            amount: msg.data.counterAmount,
            timestamp: ts,
          };
          setWagers((prev) => prev.map((w) =>
            (w.from === msg.data.from && w.target === msg.data.target) ||
            (w.from === msg.data.target && w.target === msg.data.from)
              ? {
                  ...w,
                  status: "negotiating" as const,
                  wager: msg.data.counterAmount,
                  offers: [...(w.offers ?? []), offer],
                  timestamp: ts,
                }
              : w
          ));
          // Add chat bubble for the counter
          setBubbles((prev) => [...prev.slice(-50), {
            id: `${id}-counter`,
            agentId: msg.data.counterFromAgentId || msg.data.counterFrom,
            message: `Counter: ${(msg.data.counterAmount / 1000).toFixed(0)}K`,
            type: "callout" as const,
            timestamp: ts,
          }]);
        } else if (msg.event === "fight_starting") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "fight",
            message: `FIGHT: ${msg.data.agent1} vs ${msg.data.agent2}${msg.data.wager > 0 ? ` (${(msg.data.wager / 1000).toFixed(0)}K $ARENA)` : ""}`,
            timestamp: ts,
          }]);
          // Remove wager window for this fight
          setWagers((prev) => prev.filter((w) =>
            !((w.from === msg.data.agent1 && w.target === msg.data.agent2) ||
              (w.from === msg.data.agent2 && w.target === msg.data.agent1))
          ));
        } else if (msg.event === "agent_joined") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "join", from: msg.data.username,
            message: `${msg.data.username} entered The Pit`,
            timestamp: ts,
            data: { isDemo: msg.data.isDemo },
          }]);
          setAgents((prev) => {
            const normalized = normalizePitAgent(msg.data);
            if (!normalized) return prev;

            const existingIndex = prev.findIndex((a) => a.agentId === normalized.agentId || a.username === normalized.username);
            if (existingIndex === -1) return [...prev, normalized];

            const next = [...prev];
            next[existingIndex] = normalized;
            return next;
          });
        } else if (msg.event === "agent_left") {
          setMessages((prev) => [...prev.slice(-200), {
            id, type: "leave", from: msg.data.username,
            message: `${msg.data.username} left The Pit`,
            timestamp: ts,
            data: { isDemo: msg.data.isDemo },
          }]);
          setAgents((prev) => prev.filter((a) =>
            a.agentId !== msg.data.agentId && a.username !== msg.data.username
          ));
        } else if (msg.event === "pit_agents") {
          const normalized = Array.isArray(msg.data)
            ? msg.data.map((entry: any) => normalizePitAgent(entry)).filter(Boolean) as PitAgent[]
            : [];
          setAgents(normalized);
        }
      } catch {}
    };

    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    return () => ws.close();
  }, []);

  // Clean up old bubbles every second
  useEffect(() => {
    const iv = setInterval(() => {
      const cutoff = Date.now() - 5000;
      setBubbles((prev) => prev.filter((b) => b.timestamp > cutoff));
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Clean up stale wager windows so old negotiation cards do not get stuck.
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const currentNames = new Set(agents.map((a) => a.username));

      setWagers((prev) => prev.filter((w) => {
        if (!currentNames.has(w.from) || !currentNames.has(w.target)) return false;

        const age = now - w.timestamp;
        if (w.status === "declined") return age < 3000;
        if (w.status === "accepted") return age < 8000;
        if (w.status === "open" || w.status === "negotiating") return age < 20000;
        return false;
      }));
    }, 1000);
    return () => clearInterval(iv);
  }, [agents]);

  useEffect(() => {
    const el = logScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Only auto-scroll if user is within 120px of the bottom
    if (distFromBottom < 120) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const msgColor = (type: PitMessage["type"]) => {
    switch (type) {
      case "chat": return "#ccc";
      case "callout": return "#ff6b00";
      case "fight": return "#39ff14";
      case "join": return "#eee";
      case "leave": return "#eee";
    }
  };

  return (
    <div>
      {/* Main content: PitScene with overlaid Action Log */}
      <div style={{ position: "relative" }}>
        {/* PitScene — full width */}
        <PitScene agents={agents} bubbles={bubbles} wagers={wagers} agentCount={agents.length} />

        {/* Connection status overlay */}
        <div style={{
          position: "absolute", top: 8, left: 12,
          fontSize: 10, letterSpacing: 2, fontFamily: "monospace",
          color: connected ? "#39ff14" : "#ff3939",
          textShadow: "0 0 4px rgba(0,0,0,0.8)",
          zIndex: 60,
        }}>
          {connected ? "LIVE" : "DISCONNECTED"}
        </div>

        {/* Action Log — glassmorphic overlay on right side */}
        <div style={{
          position: "absolute",
          top: 12,
          right: 12,
          bottom: 12,
          width: 280,
          background: "rgba(57, 255, 20, 0.04)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(57, 255, 20, 0.12)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          zIndex: 50,
          overflow: "hidden",
          boxShadow: "0 0 20px rgba(0,0,0,0.3)",
        }}>
          <div style={{
            padding: "10px 14px",
            borderBottom: "1px solid rgba(57,255,20,0.1)",
            color: "#39ff14",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 2,
          }}>
            ACTION LOG
          </div>
          <div ref={logScrollRef} style={{
            flex: 1,
            overflowY: "auto",
            padding: 10,
            fontFamily: "monospace",
            fontSize: 11,
          }}>
            {messages.length === 0 ? (
              <div style={{ color: "#eee", textAlign: "center", paddingTop: 40 }}>
                Waiting for activity...
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
      </div>

      {/* Bottom agent roster bar */}
      <div style={{
        padding: "10px 16px",
        background: "rgba(10,10,15,0.95)",
        borderTop: "1px solid rgba(57,255,20,0.15)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        overflowX: "auto",
      }}>
        <span style={{
          color: "#39ff14",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 2,
          whiteSpace: "nowrap",
        }}>
          IN THE PIT ({agents.length})
        </span>
        {agents.map((agent) => (
          <div key={agent.agentId} style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            border: "1px solid rgba(57,255,20,0.15)",
            whiteSpace: "nowrap",
          }}>
            <span style={{ fontSize: 11, color: "#ccc", fontWeight: 700, fontFamily: "monospace" }}>
              {agent.username}
            </span>
            <span style={{ fontSize: 9, color: "#eee", fontFamily: "monospace" }}>
              {agent.characterId.toUpperCase()}
            </span>
          </div>
        ))}
        {agents.length === 0 && (
          <span style={{ color: "#eee", fontSize: 11, fontStyle: "italic" }}>No agents online</span>
        )}
      </div>
    </div>
  );
}

// ── Fights View ──
function FightsView() {
  const [fights, setFights] = useState<ActiveFight[]>([]);
  const [loading, setLoading] = useState(true);
  const { publicKey, connected: isConnected } = useWallet();
  const address = publicKey?.toBase58();
  const [spectatorMessages, setSpectatorMessages] = useState<SpectatorMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [lastSent, setLastSent] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Poll fights
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(SERVER + "/api/v1/arena/fights");
        const data = await r.json();
        if (data.ok) setFights(data.fights.map((f: any) => ({
          fightId: f.fightId,
          agents: [f.agent1 ?? f.agents?.[0] ?? "?", f.agent2 ?? f.agents?.[1] ?? "?"],
          characters: [f.agent1Character ?? "ronin", f.agent2Character ?? "ronin"],
          round: f.round,
          p1Hp: f.p1Hp,
          p2Hp: f.p2Hp,
          wager: f.wager,
        })));
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

  // WebSocket for spectator chat
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "spectator_message") {
          setSpectatorMessages((prev) => [...prev.slice(-200), {
            from: msg.data.from,
            displayName: msg.data.displayName,
            message: msg.data.message,
            timestamp: msg.data.timestamp || Date.now(),
          }]);
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [spectatorMessages]);

  const sendMessage = () => {
    if (!chatInput.trim() || !isConnected || !address || !wsRef.current) return;
    const now = Date.now();
    if (now - lastSent < 1000) return; // Rate limit: 1 msg/sec
    wsRef.current.send(JSON.stringify({
      type: "spectator_chat",
      message: chatInput.trim().slice(0, 280),
      walletAddress: address,
    }));
    setChatInput("");
    setLastSent(now);
  };

  const truncateAddress = (addr: string) =>
    addr.slice(0, 4) + "..." + addr.slice(-4);

  return (
    <div style={{ display: "flex", gap: 0, height: "calc(100vh - 200px)" }}>
      {/* Left: Fight cards — 60% */}
      <div style={{ flex: 3, overflowY: "auto", paddingRight: 16 }}>
        {loading ? (
          <p style={{ color: "#eee", fontStyle: "italic" }}>Connecting to arena server...</p>
        ) : fights.length === 0 ? (
          <div style={{
            padding: 60,
            textAlign: "center",
            border: "1px dashed #222",
            color: "#eee",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#9876;</div>
            <p>No active fights. Agents are warming up in The Pit...</p>
            <p style={{ fontSize: 12, color: "#eee", marginTop: 8 }}>
              Fights appear here automatically when agents challenge each other.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {fights.map((f) => (
              <Link key={f.fightId} href={"/fight/" + f.fightId} style={{
                display: "block",
                position: "relative",
                padding: "20px 24px",
                border: "1px solid rgba(57,255,20,0.2)",
                background: "rgba(57,255,20,0.03)",
                transition: "all 0.2s",
              }}>
                {/* Face-off thumbnail row */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0,
                  marginBottom: 12,
                }}>
                  {/* Agent 1 side */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                    <img
                      src={`/sprites/${f.characters[0]}-preview.png`}
                      alt={f.agents[0]}
                      style={{
                        height: 80,
                        width: "auto",
                        imageRendering: "pixelated",
                        filter: "drop-shadow(0 0 8px rgba(57,57,255,0.5))",
                      }}
                    />
                    <span style={{
                      color: "#3939ff",
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      marginTop: 4,
                      textAlign: "center",
                      maxWidth: 120,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {f.agents[0]}
                    </span>
                  </div>

                  {/* VS divider */}
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "0 12px",
                  }}>
                    <span style={{
                      color: "#39ff14",
                      fontSize: 22,
                      fontWeight: 900,
                      letterSpacing: 4,
                      textShadow: "0 0 12px rgba(57,255,20,0.4)",
                    }}>
                      VS
                    </span>
                    {f.wager && f.wager > 0 ? (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#ff6b00",
                        letterSpacing: 1,
                        marginTop: 4,
                        whiteSpace: "nowrap",
                      }}>
                        {(f.wager / 1000).toFixed(0)}K $ARENA
                      </span>
                    ) : null}
                  </div>

                  {/* Agent 2 side */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                    <img
                      src={`/sprites/${f.characters[1]}-preview.png`}
                      alt={f.agents[1]}
                      style={{
                        height: 80,
                        width: "auto",
                        imageRendering: "pixelated",
                        filter: "drop-shadow(0 0 8px rgba(255,57,57,0.5))",
                        transform: "scaleX(-1)",
                      }}
                    />
                    <span style={{
                      color: "#ff3939",
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      marginTop: 4,
                      textAlign: "center",
                      maxWidth: 120,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {f.agents[1]}
                    </span>
                  </div>

                  {/* LIVE badge */}
                  <div style={{
                    position: "absolute",
                    right: 16,
                    top: 16,
                    padding: "4px 10px",
                    background: "rgba(57,255,20,0.1)",
                    border: "1px solid rgba(57,255,20,0.3)",
                    color: "#39ff14",
                    fontSize: 10,
                    letterSpacing: 2,
                    fontWeight: 700,
                  }}>
                    LIVE
                  </div>
                </div>

                {/* Round info */}
                {f.round && (
                  <div style={{
                    color: "#eee",
                    fontSize: 11,
                    textAlign: "center",
                    fontFamily: "monospace",
                  }}>
                    Round {f.round} &middot; HP: {f.p1Hp ?? "?"} - {f.p2Hp ?? "?"}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Right: Spectator Chat — 40% */}
      <div style={{
        flex: 2,
        borderLeft: "1px solid rgba(57,255,20,0.15)",
        background: "rgba(10,10,15,0.95)",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid rgba(57,255,20,0.15)",
          color: "#39ff14",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 2,
        }}>
          SPECTATOR CHAT
        </div>

        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: 12,
          fontFamily: "monospace",
          fontSize: 12,
        }}>
          {spectatorMessages.length === 0 ? (
            <div style={{ color: "#eee", textAlign: "center", paddingTop: 40, fontSize: 11 }}>
              {isConnected ? "No messages yet. Say something!" : "Connect wallet to chat"}
            </div>
          ) : (
            spectatorMessages.map((msg, i) => (
              <div key={`${msg.timestamp}-${i}`} style={{ marginBottom: 6 }}>
                <span style={{ color: "#39ff14", fontWeight: 700 }}>
                  {msg.displayName || truncateAddress(msg.from)}
                </span>
                : <span style={{ color: "#ccc" }}>{msg.message}</span>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        {isConnected ? (
          <div style={{
            display: "flex",
            gap: 8,
            padding: 12,
            borderTop: "1px solid rgba(57,255,20,0.15)",
          }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value.slice(0, 280))}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Say something..."
              style={{
                flex: 1,
                padding: "8px 12px",
                background: "rgba(0,0,0,0.5)",
                border: "1px solid rgba(57,255,20,0.2)",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 12,
                outline: "none",
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: "8px 16px",
                background: "#39ff14",
                color: "#0a0a0f",
                border: "none",
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: 1,
                cursor: "pointer",
                fontFamily: "monospace",
              }}
            >
              SEND
            </button>
          </div>
        ) : (
          <div style={{
            padding: "16px 12px",
            borderTop: "1px solid rgba(57,255,20,0.15)",
            textAlign: "center",
            color: "#eee",
            fontSize: 11,
            fontFamily: "monospace",
          }}>
            Connect your wallet to join the chat
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Spectate Page ──
export default function SpectatePage() {
  const [view, setView] = useState<View>("pit");

  return (
    <main style={{ padding: "40px 40px 0", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{
          fontSize: 36,
          fontWeight: 900,
          color: "#39ff14",
          textShadow: "0 0 30px rgba(57,255,20,0.3)",
        }}>
          SPECTATE
        </h1>
        <div style={{
          padding: "8px 16px",
          border: "1px solid rgba(57,255,20,0.3)",
          color: "#39ff14",
          fontSize: 12,
          letterSpacing: 2,
        }}>
          LIVE
        </div>
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24 }}>
        <button
          onClick={() => setView("pit")}
          style={{
            padding: "10px 28px",
            background: view === "pit" ? "#39ff14" : "transparent",
            border: "2px solid #39ff14",
            borderRight: "1px solid #39ff14",
            color: view === "pit" ? "#0a0a0f" : "#39ff14",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 3,
            cursor: "pointer",
            textTransform: "uppercase",
            transition: "all 0.2s",
          }}
        >
          THE PIT
        </button>
        <button
          onClick={() => setView("fights")}
          style={{
            padding: "10px 28px",
            background: view === "fights" ? "#39ff14" : "transparent",
            border: "2px solid #39ff14",
            borderLeft: "1px solid #39ff14",
            color: view === "fights" ? "#0a0a0f" : "#39ff14",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 3,
            cursor: "pointer",
            textTransform: "uppercase",
            transition: "all 0.2s",
          }}
        >
          FIGHTS
        </button>
      </div>

      {/* Content */}
      {view === "pit" ? <PitView /> : <FightsView />}
    </main>
  );
}

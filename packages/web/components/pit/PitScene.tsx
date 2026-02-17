"use client";

import { useState, useEffect, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────

export interface PitAgent {
  agentId: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
}

export interface ChatBubble {
  id: string;
  agentId: string;
  message: string;
  type: "chat" | "callout";
  timestamp: number;
}

export interface WagerOffer {
  from: string;
  amount: number;
  timestamp: number;
}

export interface WagerWindow {
  id: string;
  from: string;
  target: string;
  fromCharacter: string;
  targetCharacter: string;
  wager: number;
  status: "open" | "accepted" | "declined" | "negotiating";
  offers?: WagerOffer[];
  timestamp: number;
}

export interface PitQueueInfo {
  maxCapacity: number;
  currentCount: number;
  queuedAgents: { username: string; characterId: string; position: number }[];
}

export interface PitSceneProps {
  agents: PitAgent[];
  bubbles: ChatBubble[];
  wagers: WagerWindow[];
  agentCount: number;
  queue?: PitQueueInfo;
}

// ── Config ────────────────────────────────────────────────────

const PIT_CONFIG = {
  bgImage: "/sprites/pit-bg.png",
  floorImage: "/sprites/pit-floor.png",
  crowdImage: "/sprites/pit-crowd.png",
  accentColor: "#39ff14",
  accentGlow: "rgba(57,255,20,0.3)",
  maxCapacity: 50,
};

// Wider bounds — room for up to 50 agents
const PIT_BOUNDS = {
  xMin: -1.4,
  xMax: 1.0,
  yMin: 0.0,
  yMax: 0.85,
};

// ── Mood System ───────────────────────────────────────────────

type Mood = "quiet" | "active" | "heated";

function getMood(agentCount: number, hasActiveWager: boolean): Mood {
  if (hasActiveWager || agentCount >= 20) return "heated";
  if (agentCount >= 8) return "active";
  return "quiet";
}

const MOOD_STYLES: Record<Mood, { filter: string; particleCount: number; glowOpacity: number }> = {
  quiet: { filter: "brightness(0.7) saturate(0.8) hue-rotate(-10deg)", particleCount: 8, glowOpacity: 0.1 },
  active: { filter: "brightness(0.85) saturate(1.0)", particleCount: 16, glowOpacity: 0.25 },
  heated: { filter: "brightness(1.0) saturate(1.2) contrast(1.05)", particleCount: 30, glowOpacity: 0.45 },
};

// ── Position Utilities ────────────────────────────────────────

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function getAgentPosition(agentId: string, allAgents?: PitAgent[]): { x: number; y: number } {
  const h = hashCode(agentId);

  // Use roster-aware low-discrepancy placement so online agents spread
  // across the full pit instead of clustering near the middle.
  if (allAgents && allAgents.length > 1) {
    const sorted = [...allAgents].sort((a, b) => a.agentId.localeCompare(b.agentId));
    const index = sorted.findIndex((a) => a.agentId === agentId);
    if (index >= 0) {
      const seed1 = (h % 997) / 997;
      const seed2 = ((h >> 7) % 991) / 991;
      const xRatio = fract(index * 0.61803398875 + seed1);
      const yRatio = fract(index * 0.38196601125 + seed2);

      const x = PIT_BOUNDS.xMin + xRatio * (PIT_BOUNDS.xMax - PIT_BOUNDS.xMin);
      const y = PIT_BOUNDS.yMin + yRatio * (PIT_BOUNDS.yMax - PIT_BOUNDS.yMin);
      return { x, y };
    }
  }

  // Stable fallback for unknown roster state.
  const x = PIT_BOUNDS.xMin + (h % 1000) / 1000 * (PIT_BOUNDS.xMax - PIT_BOUNDS.xMin);
  const y = PIT_BOUNDS.yMin + ((h >> 10) % 1000) / 1000 * (PIT_BOUNDS.yMax - PIT_BOUNDS.yMin);
  return { x, y };
}

// Get wander offset for a given time — deterministic per agent
function getWanderOffset(agentId: string, timeSec: number): { x: number; y: number } {
  const seed = hashCode(agentId);
  const phaseX = (seed % 100) / 100 * Math.PI * 2;
  const phaseY = ((seed >> 8) % 100) / 100 * Math.PI * 2;
  const speedX = 0.15 + (seed % 30) / 100;
  const speedY = 0.1 + ((seed >> 4) % 30) / 100;
  return {
    x: Math.sin(timeSec * speedX + phaseX) * 1.8,
    y: Math.sin(timeSec * speedY + phaseY) * 0.6,
  };
}

// Screen coordinate conversion
function toScreen(pos: { x: number; y: number }, wander: { x: number; y: number } = { x: 0, y: 0 }) {
  const depthScale = 1.0 - pos.y * 0.3;
  const screenX = 50 + pos.x * 29 + wander.x;
  const bottomPct = 2 + pos.y * 40 + wander.y;
  const zIdx = Math.round((1 - pos.y) * 30) + 10;
  return { screenX, bottomPct, depthScale, zIdx };
}

// Get effective position — accounts for wager proximity
function getEffectivePosition(
  agent: PitAgent,
  wagers: WagerWindow[],
  allAgents: PitAgent[],
): { pos: { x: number; y: number }; isInWager: boolean; facingRight: boolean } {
  const activeWager = wagers.find(
    (w) => (w.from === agent.username || w.target === agent.username) && w.status !== "declined"
  );

  const basePos = getAgentPosition(agent.agentId, allAgents);

  if (!activeWager) {
    return { pos: basePos, isInWager: false, facingRight: true };
  }

  const otherName = activeWager.from === agent.username ? activeWager.target : activeWager.from;
  const otherAgent = allAgents.find((a) => a.username === otherName);
  if (!otherAgent) {
    return { pos: basePos, isInWager: true, facingRight: true };
  }

  const theirPos = getAgentPosition(otherAgent.agentId, allAgents);
  const meetX = (basePos.x + theirPos.x) / 2;
  const meetY = Math.min((basePos.y + theirPos.y) / 2, PIT_BOUNDS.yMax * 0.7);

  // Position agents side by side at meeting point
  const isFrom = activeWager.from === agent.username;
  const offset = isFrom ? -0.1 : 0.1;
  const facingRight = isFrom; // from agent faces right (toward target)

  return { pos: { x: meetX + offset, y: meetY }, isInWager: true, facingRight };
}

// ── Ambient Particles ─────────────────────────────────────────

function AmbientParticles({ count }: { count: number }) {
  const particles = useMemo(() =>
    Array.from({ length: count }).map((_, i) => ({
      x: Math.random() * 100,
      delay: Math.random() * 8,
      dur: 6 + Math.random() * 8,
      size: 2 + Math.random() * 3,
      opacity: 0.3 + Math.random() * 0.4,
    })),
  [count]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 5 }}>
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${p.x}%`,
            bottom: "-5%",
            width: p.size,
            height: p.size,
            background: PIT_CONFIG.accentColor,
            opacity: p.opacity,
            borderRadius: "50%",
            boxShadow: `0 0 4px ${PIT_CONFIG.accentColor}`,
            animation: `particleRise ${p.dur}s ${p.delay}s linear infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ── Agent Sprite ──────────────────────────────────────────────
// Uses CSS transitions for smooth movement instead of React state updates.
// Position updates happen every 3s; CSS interpolates at 60fps.

function PitAgentSprite({
  agent,
  bubble,
  wagers,
  allAgents,
  globalFrame,
}: {
  agent: PitAgent;
  bubble?: ChatBubble;
  wagers: WagerWindow[];
  allAgents: PitAgent[];
  globalFrame: number;
}) {
  const [wanderTarget, setWanderTarget] = useState({ x: 0, y: 0 });
  const { pos: effectivePos, isInWager, facingRight } = getEffectivePosition(agent, wagers, allAgents);

  // Update wander target every 3 seconds — CSS transition handles interpolation
  useEffect(() => {
    if (isInWager) {
      setWanderTarget({ x: 0, y: 0 });
      return;
    }
    const update = () => {
      const t = Date.now() / 1000;
      setWanderTarget(getWanderOffset(agent.agentId, t));
    };
    update();
    const iv = setInterval(update, 3000);
    return () => clearInterval(iv);
  }, [agent.agentId, isInWager]);

  const wander = isInWager ? { x: 0, y: 0 } : wanderTarget;
  const { screenX, bottomPct, depthScale, zIdx } = toScreen(effectivePos, wander);
  const spriteSize = Math.round(130 * depthScale);
  const sheetSize = spriteSize * 4;
  const sheetUrl = `/sprites/${agent.characterId}-idle-sheet.png`;
  const flip = isInWager ? (facingRight ? 1 : -1) : 1;

  // Bubble age for fade-out (0-1 where 1 = fresh, 0 = expired)
  const bubbleAge = bubble ? Math.max(0, 1 - (Date.now() - bubble.timestamp) / 5000) : 0;
  const bubbleOpacity = bubbleAge > 0.2 ? 1 : bubbleAge / 0.2; // Fade out in last 20%

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${bottomPct}%`,
        left: `${screenX}%`,
        transform: "translateX(-50%)",
        zIndex: zIdx,
        // CSS transition for smooth movement — this is the key fix for jank
        transition: isInWager
          ? "left 0.8s ease-out, bottom 0.8s ease-out"
          : "left 3s ease-in-out, bottom 3s ease-in-out",
        willChange: "left, bottom",
      }}
    >
      {/* Chat bubble with lifecycle animation */}
      {bubble && bubbleOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: spriteSize + 10,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 12px",
            background: bubble.type === "callout" ? "rgba(255,107,0,0.92)" : "rgba(10,10,15,0.92)",
            border: `1px solid ${bubble.type === "callout" ? "#ff6b00" : "rgba(57,255,20,0.4)"}`,
            color: bubble.type === "callout" ? "#fff" : "#ccc",
            fontSize: 11,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            zIndex: zIdx + 50,
            pointerEvents: "none",
            animation: "bubblePopIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
            opacity: bubbleOpacity,
            transition: "opacity 0.5s ease-out",
          }}
        >
          {bubble.message}
          <div style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: `6px solid ${bubble.type === "callout" ? "rgba(255,107,0,0.92)" : "rgba(10,10,15,0.92)"}`,
          }} />
        </div>
      )}

      {/* Username label */}
      <div
        style={{
          position: "absolute",
          bottom: spriteSize - 4,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: Math.round(9 * depthScale),
          color: isInWager ? "#ff6b00" : PIT_CONFIG.accentColor,
          fontFamily: "monospace",
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          textShadow: "0 0 6px rgba(0,0,0,0.9)",
          pointerEvents: "none",
          transition: "color 0.5s",
        }}
      >
        {agent.username}
      </div>

      {/* Ground shadow */}
      <div
        style={{
          position: "absolute",
          bottom: -6 * depthScale,
          left: "50%",
          transform: "translateX(-50%)",
          width: 60 * depthScale,
          height: 12 * depthScale,
          borderRadius: "50%",
          background: `radial-gradient(ellipse, rgba(0,0,0,0.5) 0%, transparent 70%)`,
        }}
      />

      {/* Sprite — frame from shared global timer */}
      <div
        style={{
          width: spriteSize,
          height: spriteSize,
          backgroundImage: `url(${sheetUrl})`,
          backgroundSize: `${sheetSize}px ${spriteSize}px`,
          backgroundPosition: `-${(globalFrame % 4) * spriteSize}px 0`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          filter: isInWager
            ? `drop-shadow(0 0 12px rgba(255,107,0,0.5))`
            : `drop-shadow(0 0 6px ${PIT_CONFIG.accentColor}30)`,
          transform: flip === -1 ? "scaleX(-1)" : "none",
          transition: "filter 0.5s, transform 0.3s",
        }}
      />
    </div>
  );
}

// ── Wager Negotiation Window ──────────────────────────────────
// Positioned between the two involved agents. Shows live negotiation.

function WagerNegotiationWindow({ wager, agents }: { wager: WagerWindow; agents: PitAgent[] }) {
  const fromAgent = agents.find((a) => a.username === wager.from);
  const targetAgent = agents.find((a) => a.username === wager.target);
  if (!fromAgent || !targetAgent) return null;

  // Position at meeting point between agents
  const fromPos = getAgentPosition(fromAgent.agentId, agents);
  const targetPos = getAgentPosition(targetAgent.agentId, agents);
  const meetX = (fromPos.x + targetPos.x) / 2;
  const meetY = Math.min((fromPos.y + targetPos.y) / 2, PIT_BOUNDS.yMax * 0.7);
  const screen = toScreen({ x: meetX, y: meetY });

  const isAccepted = wager.status === "accepted";
  const isNegotiating = wager.status === "negotiating";
  const offers = wager.offers ?? [];

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${screen.bottomPct + 22}%`,
        left: `${screen.screenX}%`,
        transform: "translateX(-50%)",
        zIndex: 100,
        pointerEvents: "none",
        transition: "left 0.8s ease-out, bottom 0.8s ease-out",
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          background: isAccepted
            ? "rgba(57,255,20,0.12)"
            : isNegotiating
            ? "rgba(255,165,0,0.12)"
            : "rgba(255,107,0,0.12)",
          border: `2px solid ${isAccepted ? "#39ff14" : "#ff6b00"}`,
          textAlign: "center",
          fontFamily: "monospace",
          minWidth: 180,
          animation: isAccepted ? "wagerPulse 1s ease-in-out infinite" : "none",
          boxShadow: isAccepted
            ? "0 0 25px rgba(57,255,20,0.5), 0 0 50px rgba(57,255,20,0.2)"
            : "0 0 15px rgba(255,107,0,0.3)",
          backdropFilter: "blur(4px)",
        }}
      >
        {/* Header */}
        <div style={{ fontSize: 9, letterSpacing: 2, color: "#888", marginBottom: 4 }}>
          {isAccepted ? "⚔ WAGER LOCKED ⚔" : isNegotiating ? "⚔ NEGOTIATING ⚔" : "⚔ WAGER ⚔"}
        </div>

        {/* Names */}
        <div style={{ fontSize: 11, color: "#ccc", marginBottom: 6 }}>
          <span style={{ color: "#39ff14", fontWeight: 700 }}>{wager.from}</span>
          <span style={{ color: "#555", margin: "0 6px" }}>vs</span>
          <span style={{ color: "#ff6b00", fontWeight: 700 }}>{wager.target}</span>
        </div>

        {/* Offer history — shows bartering back and forth */}
        {offers.length > 0 && (
          <div style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 6,
            marginBottom: 6,
            maxHeight: 80,
            overflowY: "auto",
          }}>
            {offers.slice(-4).map((offer, i) => (
              <div key={i} style={{
                fontSize: 10,
                color: offer.from === wager.from ? "#39ff14" : "#ff6b00",
                textAlign: offer.from === wager.from ? "left" : "right",
                opacity: i < offers.slice(-4).length - 1 ? 0.5 : 1,
                marginBottom: 2,
              }}>
                {offer.from}: {(offer.amount / 1000).toFixed(0)}K
              </div>
            ))}
          </div>
        )}

        {/* Current amount */}
        <div style={{
          fontSize: 20,
          fontWeight: 900,
          color: isAccepted ? "#39ff14" : "#ff6b00",
          letterSpacing: 1,
        }}>
          {(wager.wager / 1000).toFixed(0)}K $ARENA
        </div>

        {/* Status */}
        <div style={{
          fontSize: 9,
          letterSpacing: 2,
          marginTop: 4,
          color: isAccepted ? "#39ff14" : isNegotiating ? "#ffa500" : "#ff6b00",
          textTransform: "uppercase",
          fontWeight: 700,
          animation: isNegotiating ? "negotiatePulse 2s ease-in-out infinite" : "none",
        }}>
          {wager.status === "open" && "OPEN CHALLENGE"}
          {wager.status === "negotiating" && "BARTERING..."}
          {wager.status === "accepted" && "FIGHT STARTING"}
          {wager.status === "declined" && "DECLINED"}
        </div>
      </div>
    </div>
  );
}

// ── Queue Overlay ─────────────────────────────────────────────

function QueueOverlay({ queue }: { queue: PitQueueInfo }) {
  const fillPct = Math.min(100, (queue.currentCount / queue.maxCapacity) * 100);

  return (
    <div style={{
      position: "absolute",
      top: 30,
      left: 8,
      zIndex: 55,
      padding: "8px 12px",
      background: "rgba(57,255,20,0.06)",
      border: "1px solid rgba(57,255,20,0.15)",
      fontFamily: "monospace",
      fontSize: 10,
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      borderRadius: 6,
      minWidth: 140,
    }}>
      <div style={{ color: "#eee", letterSpacing: 2, marginBottom: 4 }}>PIT CAPACITY</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Progress bar */}
        <div style={{
          flex: 1,
          height: 4,
          background: "rgba(255,255,255,0.1)",
          borderRadius: 2,
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${fillPct}%`,
            background: fillPct >= 90 ? "#ff3939" : fillPct >= 70 ? "#ffa500" : "#39ff14",
            transition: "width 0.5s, background 0.5s",
          }} />
        </div>
        <span style={{
          color: fillPct >= 90 ? "#ff3939" : "#39ff14",
          fontWeight: 700,
        }}>
          {queue.currentCount}/{queue.maxCapacity}
        </span>
      </div>
      {queue.queuedAgents.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 4 }}>
          <div style={{ color: "#ff6b00", letterSpacing: 2, marginBottom: 3 }}>
            QUEUE: {queue.queuedAgents.length}
          </div>
          {queue.queuedAgents.slice(0, 5).map((a, i) => (
            <div key={i} style={{ color: "#eee", fontSize: 9 }}>
              #{a.position} {a.username}
            </div>
          ))}
          {queue.queuedAgents.length > 5 && (
            <div style={{ color: "#ccc", fontSize: 9 }}>+{queue.queuedAgents.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Demo Data ─────────────────────────────────────────────────

const DEMO_AGENTS: PitAgent[] = [
  { agentId: "pit-alpha-ronin", username: "ronin", characterId: "ronin", elo: 1450, wins: 12, losses: 3 },
  { agentId: "pit-zeta-knight", username: "knight", characterId: "knight", elo: 1380, wins: 9, losses: 5 },
  { agentId: "pit-gamma-cyborg", username: "cyborg", characterId: "cyborg", elo: 1520, wins: 15, losses: 2 },
  { agentId: "pit-omega-demon", username: "demon", characterId: "demon", elo: 1290, wins: 7, losses: 8 },
  { agentId: "pit-sigma-phantom", username: "phantom", characterId: "phantom", elo: 1410, wins: 11, losses: 4 },
  { agentId: "pit-kappa-samurai", username: "samurai", characterId: "ronin", elo: 1350, wins: 8, losses: 6 },
  { agentId: "pit-theta-shadow", username: "shadow", characterId: "phantom", elo: 1440, wins: 10, losses: 4 },
  { agentId: "pit-delta-titan", username: "titan", characterId: "knight", elo: 1500, wins: 14, losses: 3 },
];

const DEMO_BUBBLES: ChatBubble[] = [
  { id: "demo-b1", agentId: "pit-alpha-ronin", message: "who's next?", type: "chat", timestamp: Date.now() },
  { id: "demo-b2", agentId: "pit-theta-shadow", message: "ez clap", type: "chat", timestamp: Date.now() },
];

const DEMO_WAGERS: WagerWindow[] = [];

const DEMO_QUEUE: PitQueueInfo = {
  maxCapacity: 50,
  currentCount: 8,
  queuedAgents: [
    { username: "blaze", characterId: "demon", position: 1 },
    { username: "frost", characterId: "knight", position: 2 },
    { username: "volt", characterId: "cyborg", position: 3 },
  ],
};

// ── Main PitScene Component ───────────────────────────────────

export default function PitScene({ agents, bubbles, wagers, agentCount, queue }: PitSceneProps) {
  const showDemo = agents.length === 0;
  const displayAgents = showDemo ? DEMO_AGENTS : agents;
  const displayBubbles = showDemo ? DEMO_BUBBLES : bubbles;
  const displayWagers = showDemo ? DEMO_WAGERS : wagers;
  const displayCount = showDemo ? DEMO_AGENTS.length : agentCount;
  const displayQueue = showDemo ? DEMO_QUEUE : queue;

  const hasActiveWager = displayWagers.some((w) => w.status === "open" || w.status === "accepted" || w.status === "negotiating");
  const mood = getMood(displayCount, hasActiveWager);
  const moodStyle = MOOD_STYLES[mood];

  // Single shared frame counter — one timer instead of one per agent
  const [globalFrame, setGlobalFrame] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setGlobalFrame((f) => (f + 1) % 4), 220);
    return () => clearInterval(iv);
  }, []);

  // Bubble map — latest bubble per agent, with age tracking
  const bubbleMap = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, ChatBubble>();
    const active = showDemo
      ? displayBubbles
      : displayBubbles.filter((b) => now - b.timestamp < 5000);
    for (const b of active) {
      map.set(b.agentId, b);
    }
    return map;
  }, [displayBubbles, showDemo]);

  return (
    <div style={{
      position: "relative",
      width: "100%",
      height: "calc(100vh - 200px)",
      minHeight: 500,
      overflow: "hidden",
      background: "#080810",
    }}>
      {/* ── Background panorama ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "55%",
          backgroundImage: `url(${PIT_CONFIG.bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          filter: `blur(1.2px) ${moodStyle.filter}`,
          transition: "filter 1.5s ease",
        }}
      />
      {/* Background edge fades */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "55%",
          background: "linear-gradient(to right, #080810 0%, transparent 6%, transparent 94%, #080810 100%)",
          zIndex: 0,
        }}
      />

      {/* ── Vignette ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse at 50% 30%, transparent 30%, #08081099 70%, #080810cc 85%),
            linear-gradient(to bottom, transparent 40%, #08081066 55%, #080810aa 68%, #080810 85%)
          `,
          zIndex: 1,
        }}
      />

      {/* ── Crowd layer ── */}
      <div
        style={{
          position: "absolute",
          bottom: "42%",
          left: 0,
          right: 0,
          height: "18%",
          zIndex: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "-2%",
            right: "-2%",
            height: "100%",
            backgroundImage: `url(${PIT_CONFIG.crowdImage})`,
            backgroundSize: "auto 100%",
            backgroundRepeat: "repeat-x",
            backgroundPosition: "center bottom",
            imageRendering: "pixelated",
            filter: "brightness(0.7)",
            opacity: 0.85,
          }}
        />
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "35%",
          background: "linear-gradient(to bottom, #080810, transparent)",
        }} />
        <div style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to right, #080810 0%, transparent 10%, transparent 90%, #080810 100%)",
        }} />
      </div>

      {/* ── Floor — expanded for more space ── */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "55%",
          perspective: "800px",
          perspectiveOrigin: "50% 15%",
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "-50%",
            right: "-50%",
            height: "130%",
            transform: "rotateX(60deg)",
            transformOrigin: "center bottom",
            backgroundImage: `url(${PIT_CONFIG.floorImage})`,
            backgroundSize: "180px 180px",
            backgroundRepeat: "repeat",
            imageRendering: "pixelated",
          }}
        />
        {/* Floor glow ring */}
        <div
          style={{
            position: "absolute",
            bottom: "3%",
            left: "50%",
            transform: "translateX(-50%) rotateX(60deg)",
            transformOrigin: "center bottom",
            width: "80%",
            height: "90%",
            borderRadius: "50%",
            border: `2px solid ${PIT_CONFIG.accentGlow}`,
            boxShadow: `0 0 ${Math.round(20 + moodStyle.glowOpacity * 60)}px ${PIT_CONFIG.accentGlow}, inset 0 0 40px rgba(0,0,0,0.3)`,
            transition: "box-shadow 1.5s ease",
            pointerEvents: "none",
          }}
        />
        {/* Gentle edge fades */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to right, #08081066 0%, transparent 4%, transparent 96%, #08081066 100%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "6%",
          background: "linear-gradient(to top, #080810, transparent)",
          pointerEvents: "none",
        }} />
      </div>

      {/* ── Ambient particles ── */}
      <AmbientParticles count={moodStyle.particleCount} />

      {/* ── Heated mood vignette ── */}
      {mood === "heated" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: "inset 0 0 120px rgba(57,255,20,0.15), inset 0 0 60px rgba(57,255,20,0.1)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      )}

      {/* ── Agent sprites ── */}
      {displayAgents.map((agent) => (
        <PitAgentSprite
          key={agent.agentId}
          agent={agent}
          bubble={bubbleMap.get(agent.agentId)}
          wagers={displayWagers}
          allAgents={displayAgents}
          globalFrame={globalFrame}
        />
      ))}

      {/* ── Wager windows ── */}
      {displayWagers
        .filter((w) => w.status !== "declined")
        .map((w) => (
          <WagerNegotiationWindow key={w.id} wager={w} agents={displayAgents} />
        ))}

      {/* ── Queue overlay ── */}
      {displayQueue && <QueueOverlay queue={displayQueue} />}

      {/* ── Keyframes ── */}
      <style>{`
        @keyframes particleRise {
          0% { transform: translateY(0) scale(1); opacity: 0.4; }
          100% { transform: translateY(-100vh) scale(0.3); opacity: 0; }
        }
        @keyframes bubblePopIn {
          from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.8); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes wagerPulse {
          0%, 100% { box-shadow: 0 0 25px rgba(57,255,20,0.5), 0 0 50px rgba(57,255,20,0.2); }
          50% { box-shadow: 0 0 35px rgba(57,255,20,0.7), 0 0 70px rgba(57,255,20,0.3); }
        }
        @keyframes negotiatePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

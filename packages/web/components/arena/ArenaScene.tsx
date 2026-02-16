"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FightHUD } from "./FightHUD";
import type { FightState } from "./useGameState";
import { soundEngine } from "./SoundEngine";

// ── Types ──────────────────────────────────────────────────────

type AnimState = "idle" | "attack" | "block" | "dodge" | "hurt" | "ko";

interface ArenaSceneProps {
  gameState: FightState | null;
  arenaId?: string;
}

interface ArenaConfig {
  id: string;
  name: string;
  bgImage: string;
  floorImage: string;
  crowdImage: string;
  accentColor: string;
  accentGlow: string;
  bgTint: string;
}

// ── Arena Themes ────────────────────────────────────────────────

const ARENAS: Record<string, ArenaConfig> = {
  gothic: {
    id: "gothic",
    name: "Shadow Colosseum",
    bgImage: "/sprites/arena-bg.png",
    floorImage: "/sprites/arena-floor.png",
    crowdImage: "/sprites/crowd-gothic.png",
    accentColor: "#39ff14",
    accentGlow: "rgba(57,255,20,0.3)",
    bgTint: "#080810",
  },
  volcanic: {
    id: "volcanic",
    name: "Inferno Forge",
    bgImage: "/sprites/arena-volcanic-bg.png",
    floorImage: "/sprites/arena-volcanic-floor.png",
    crowdImage: "/sprites/crowd-volcanic.png",
    accentColor: "#ff6600",
    accentGlow: "rgba(255,102,0,0.3)",
    bgTint: "#100808",
  },
  ice: {
    id: "ice",
    name: "Frozen Depths",
    bgImage: "/sprites/arena-ice-bg.png",
    floorImage: "/sprites/arena-ice-floor.png",
    crowdImage: "/sprites/crowd-ice.png",
    accentColor: "#44bbff",
    accentGlow: "rgba(68,187,255,0.3)",
    bgTint: "#080810",
  },
  neon: {
    id: "neon",
    name: "Neon District",
    bgImage: "/sprites/arena-neon-bg.png",
    floorImage: "/sprites/arena-neon-floor.png",
    crowdImage: "/sprites/crowd-neon.png",
    accentColor: "#ff00ff",
    accentGlow: "rgba(255,0,255,0.3)",
    bgTint: "#0a0812",
  },
};

const ARENA_IDS = Object.keys(ARENAS);

function getRandomArena(): ArenaConfig {
  const id = ARENA_IDS[Math.floor(Math.random() * ARENA_IDS.length)];
  return ARENAS[id];
}

// ── Action → AnimState mapping ─────────────────────────────────

function getAnimState(
  action: string | undefined,
  isHurt: boolean,
  isKO: boolean,
): AnimState {
  if (isKO) return "ko";
  if (isHurt) return "hurt";
  if (!action) return "idle";
  const a = action.toLowerCase();
  if (
    a.includes("punch") ||
    a.includes("kick") ||
    a.includes("uppercut") ||
    a.includes("sweep") ||
    a.includes("grab")
  )
    return "attack";
  if (a.includes("block")) return "block";
  if (a.includes("dodge")) return "dodge";
  if (a.includes("taunt")) return "idle";
  return "idle";
}

// ── 2.5D Position System ────────────────────────────────────────

interface FighterPos {
  x: number; // -1 (far left) to 1 (far right)
  y: number; // 0 (front/close) to 1 (back/far)
  z: number; // jump height — 0 = on ground, >0 = airborne
}

// Arena bounds — fighters confined to the fightable floor area
const ARENA_BOUNDS = {
  xMin: -0.75,
  xMax: 0.75,
  yMin: 0.0,
  yMax: 0.55,
};

function clampToArena(pos: FighterPos): FighterPos {
  return {
    x: Math.max(ARENA_BOUNDS.xMin, Math.min(ARENA_BOUNDS.xMax, pos.x)),
    y: Math.max(ARENA_BOUNDS.yMin, Math.min(ARENA_BOUNDS.yMax, pos.y)),
    z: Math.max(0, pos.z),
  };
}

function getTargetPosition(
  animState: AnimState,
  side: "left" | "right",
  basePos: FighterPos,
  opponentPos: FighterPos,
): FighterPos {
  // Calculate midpoint between fighters for attack proximity
  const midX = (basePos.x + opponentPos.x) / 2;
  const midY = (basePos.y + opponentPos.y) / 2;
  const towardOpponent = opponentPos.x > basePos.x ? 1 : -1;

  // Combat range — how close fighters get during attacks (gap between them)
  const STRIKE_GAP = 0.12; // tight enough to look like striking distance

  switch (animState) {
    case "attack":
      // Lunge to striking distance of opponent — close the gap significantly
      return clampToArena({
        x: opponentPos.x - STRIKE_GAP * towardOpponent,
        y: midY - 0.02,
        z: 0,
      });
    case "dodge":
      // Evade away from opponent — big retreat
      return clampToArena({
        x: basePos.x - 0.22 * towardOpponent,
        y: basePos.y + 0.08,
        z: 0,
      });
    case "hurt":
      // Knocked back from where they are (not base — reacts from current)
      return clampToArena({
        x: basePos.x - 0.16 * towardOpponent,
        y: basePos.y + 0.04,
        z: 0,
      });
    case "ko":
      return clampToArena({
        x: basePos.x - 0.2 * towardOpponent,
        y: basePos.y + 0.06,
        z: 0,
      });
    case "block":
      // Brace — hold ground but lean slightly forward
      return clampToArena({
        x: basePos.x + 0.06 * towardOpponent,
        y: basePos.y - 0.02,
        z: 0,
      });
    default:
      return clampToArena({ ...basePos, z: 0 });
  }
}

// Lerp speed varies by action — attacks close fast, idle drifts slowly
function getLerpSpeed(animState: AnimState): number {
  switch (animState) {
    case "attack": return 0.14; // fast lunge
    case "hurt": return 0.12;   // quick knockback
    case "dodge": return 0.1;   // swift dodge
    case "ko": return 0.06;
    case "block": return 0.1;
    default: return 0.04;       // gentle idle drift
  }
}

// Should this action trigger a jump?
function shouldJump(action: string | undefined): boolean {
  if (!action) return false;
  const a = action.toLowerCase();
  return (
    a.includes("uppercut") ||
    a.includes("jump") ||
    a.includes("aerial") ||
    a.includes("flying") ||
    a.includes("kick")
  );
}

function isHeavyAction(action: string): boolean {
  const a = action.toLowerCase();
  return a.includes("heavy") || a.includes("uppercut") || a.includes("sweep") || a.includes("grab");
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Hit Spark Particles ─────────────────────────────────────────

function HitSparks({
  pos,
  arena,
  intensity,
}: {
  pos: FighterPos;
  arena: ArenaConfig;
  intensity: "light" | "heavy";
}) {
  const count = intensity === "heavy" ? 8 : 5;
  const screenX = 50 + pos.x * 30;
  const bottomPct = 12 + pos.y * 16;

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${bottomPct + 8}%`,
        left: `${screenX}%`,
        transform: "translateX(-50%)",
        zIndex: 40,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * 360 + Math.random() * 40 - 20;
        const dist = 30 + Math.random() * 40;
        const size = intensity === "heavy" ? 4 + Math.random() * 4 : 3 + Math.random() * 3;
        const dx = Math.cos((angle * Math.PI) / 180) * dist;
        const dy = Math.sin((angle * Math.PI) / 180) * dist;
        const dur = 0.3 + Math.random() * 0.3;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              width: size,
              height: size,
              background: i % 3 === 0 ? "#fff" : arena.accentColor,
              boxShadow: `0 0 6px ${arena.accentColor}`,
              borderRadius: 1,
              animation: `sparkBurst ${dur}s ease-out forwards`,
              ["--dx" as string]: `${dx}px`,
              ["--dy" as string]: `${dy}px`,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Round Callout Overlay ───────────────────────────────────────

type CalloutType = "round" | "fight" | "ko";

function CalloutOverlay({
  type,
  roundNum,
  arena,
}: {
  type: CalloutType;
  roundNum?: number;
  arena: ArenaConfig;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), type === "ko" ? 2000 : 1400);
    return () => clearTimeout(t);
  }, [type]);

  if (!visible) return null;

  const text =
    type === "round"
      ? `ROUND ${roundNum ?? 1}`
      : type === "fight"
        ? "FIGHT!"
        : "K.O.!";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontSize: type === "ko" ? 80 : 64,
          fontWeight: 900,
          fontFamily: "monospace",
          color: type === "ko" ? "#ff3333" : arena.accentColor,
          textShadow: `
            0 0 30px ${type === "ko" ? "#ff0000" : arena.accentColor},
            0 0 60px ${type === "ko" ? "rgba(255,0,0,0.5)" : arena.accentGlow},
            3px 3px 0 #000,
            -1px -1px 0 #000
          `,
          letterSpacing: type === "fight" ? 12 : 8,
          textTransform: "uppercase",
          animation: "calloutSlam 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ── Fighter Sprite Component ───────────────────────────────────

const ANIM_FPS: Record<AnimState, number> = {
  idle: 5,
  attack: 10,
  block: 8,
  dodge: 12,
  hurt: 10,
  ko: 6,
};

const ANIM_LOOP: Record<AnimState, boolean> = {
  idle: true,
  attack: false,
  block: false,
  dodge: false,
  hurt: false,
  ko: false,
};

function FighterSprite({
  characterId,
  animState,
  flipX,
  pos,
  arena,
  isLanding,
}: {
  characterId: string;
  animState: AnimState;
  flipX: boolean;
  pos: FighterPos;
  arena: ArenaConfig;
  isLanding: boolean;
}) {
  const [frame, setFrame] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const prevAnimRef = useRef(animState);

  useEffect(() => {
    if (animState !== prevAnimRef.current) {
      setFrame(0);
      prevAnimRef.current = animState;
    }

    const fps = ANIM_FPS[animState];
    const loop = ANIM_LOOP[animState];

    timerRef.current = setInterval(() => {
      setFrame((f) => {
        if (loop) return (f + 1) % 4;
        return Math.min(f + 1, 3);
      });
    }, 1000 / fps);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [animState]);

  const sheetUrl = `/sprites/${characterId}-${animState}-sheet.png`;

  const isShaking = animState === "hurt";
  const isKO = animState === "ko";
  const isActing = animState === "attack" || animState === "dodge" || animState === "block";
  const airborne = pos.z > 0.5;

  const depthScale = 1.0 - pos.y * 0.25;
  const screenX = 50 + pos.x * 30;
  // bottom % — front (y=0) sits low on floor, back (y=0.55) sits higher on screen
  const bottomPct = 12 + pos.y * 16;
  const zIdx = Math.round((1 - pos.y) * 20) + 10 + (airborne ? 5 : 0);
  const spriteSize = Math.round(160 * depthScale);
  const sheetSize = spriteSize * 4;

  // Jump visual offset — pos.z maps to pixels upward
  const jumpOffset = pos.z * 1.8;
  // Landing squash — briefly compress the sprite on landing
  const squashY = isLanding ? "scaleY(0.85) scaleX(1.12)" : "";

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${bottomPct}%`,
        left: `${screenX}%`,
        transform: `
          translateX(-50%)
          translateY(${-jumpOffset}px)
          ${flipX ? "scaleX(-1)" : ""}
          ${squashY}
          ${isShaking ? `translateX(${Math.random() > 0.5 ? 4 : -4}px)` : ""}
          ${isKO ? "rotate(15deg) translateY(20px)" : ""}
        `,
        transition: isShaking ? "none" : "all 0.15s ease-out",
        zIndex: zIdx,
      }}
    >
      {/* Ground glow pulse — shows when performing an action */}
      {isActing && (
        <div
          style={{
            position: "absolute",
            bottom: -12 * depthScale,
            left: "50%",
            transform: "translateX(-50%)",
            width: 100 * depthScale,
            height: 20 * depthScale,
            borderRadius: "50%",
            background: `radial-gradient(ellipse, ${arena.accentColor}66 0%, ${arena.accentColor}22 40%, transparent 70%)`,
            boxShadow: `0 0 20px ${arena.accentGlow}`,
            animation: "glowPulse 0.5s ease-out forwards",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Landing ring — expands outward on impact */}
      {isLanding && (
        <div
          style={{
            position: "absolute",
            bottom: -6 * depthScale,
            left: "50%",
            transform: "translateX(-50%)",
            width: 80 * depthScale,
            height: 16 * depthScale,
            borderRadius: "50%",
            border: `2px solid ${arena.accentColor}88`,
            animation: "landingRing 0.4s ease-out forwards",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Drop shadow — grows/shrinks with jump height */}
      <div
        style={{
          position: "absolute",
          bottom: -8 * depthScale,
          left: "50%",
          transform: `translateX(-50%) translateY(${jumpOffset * 0.3}px)`,
          width: (90 - pos.z * 0.3) * depthScale,
          height: (14 - pos.z * 0.06) * depthScale,
          borderRadius: "50%",
          background: `rgba(0,0,0,${0.6 - pos.z * 0.003})`,
          filter: `blur(${(5 + pos.z * 0.05) * depthScale}px)`,
          transition: "all 0.1s ease-out",
        }}
      />

      {/* Sprite */}
      <div
        style={{
          width: spriteSize,
          height: spriteSize,
          backgroundImage: `url(${sheetUrl})`,
          backgroundSize: `${sheetSize}px ${spriteSize}px`,
          backgroundPosition: `${-(frame * spriteSize)}px 0`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}

// ── Damage Number Popup ────────────────────────────────────────

function DamagePopup({
  damage,
  pos,
}: {
  damage: number;
  pos: FighterPos;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!visible || damage === 0) return null;

  const screenX = 50 + pos.x * 30;
  const bottomPct = 12 + pos.y * 16;

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${bottomPct + 14}%`,
        left: `${screenX}%`,
        transform: "translateX(-50%)",
        color: "#ff3333",
        fontSize: 36,
        fontWeight: 900,
        fontFamily: "monospace",
        textShadow: "0 0 10px #ff0000, 2px 2px 0 #000",
        animation: "damageFloat 1.2s ease-out forwards",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      -{damage}
    </div>
  );
}

// ── Arena Ground ────────────────────────────────────────────────

function ArenaGround({ arena }: { arena: ArenaConfig }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "42%",
        perspective: "800px",
        perspectiveOrigin: "50% 20%",
        zIndex: 1,
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "-20%",
          right: "-20%",
          height: "100%",
          transform: "rotateX(60deg)",
          transformOrigin: "center bottom",
          backgroundImage: `url(${arena.floorImage})`,
          backgroundSize: "180px 180px",
          backgroundRepeat: "repeat",
          imageRendering: "pixelated",
        }}
      />

      {/* Arena ring glow */}
      <div
        style={{
          position: "absolute",
          bottom: "5%",
          left: "50%",
          transform: "translateX(-50%) rotateX(60deg)",
          transformOrigin: "center bottom",
          width: "70%",
          height: "85%",
          borderRadius: "50%",
          border: `2px solid ${arena.accentGlow}`,
          boxShadow: `0 0 40px ${arena.accentGlow}, inset 0 0 40px rgba(0,0,0,0.3)`,
          pointerEvents: "none",
        }}
      />

      {/* Center mark */}
      <div
        style={{
          position: "absolute",
          bottom: "42%",
          left: "50%",
          transform: "translateX(-50%) rotateX(60deg)",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: arena.accentColor,
          boxShadow: `0 0 15px ${arena.accentColor}`,
        }}
      />

      {/* Side fades */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to right, ${arena.bgTint} 0%, transparent 15%, transparent 85%, ${arena.bgTint} 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* Bottom fade */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "15%",
          background: `linear-gradient(to top, ${arena.bgTint}, transparent)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ── Crowd Layer with Depth of Field ─────────────────────────────

function CrowdLayer({ arena }: { arena: ArenaConfig }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "32%",
        left: 0,
        right: 0,
        height: "24%",
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Single crowd image — crisp pixel art, no heavy blur */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "-2%",
          right: "-2%",
          height: "100%",
          backgroundImage: `url(${arena.crowdImage})`,
          backgroundSize: "auto 100%",
          backgroundRepeat: "repeat-x",
          backgroundPosition: "center bottom",
          imageRendering: "pixelated",
          filter: "brightness(0.7)",
          opacity: 0.9,
        }}
      />
      {/* Gradient fade into arena background at top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "35%",
          background: `linear-gradient(to bottom, ${arena.bgTint}, transparent)`,
        }}
      />
      {/* Side fades */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(to right, ${arena.bgTint} 0%, transparent 8%, transparent 92%, ${arena.bgTint} 100%)`,
        }}
      />
    </div>
  );
}

// ── Ambient Arena Particles ─────────────────────────────────────

// Deterministic pseudo-random to avoid SSR/client hydration mismatch
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49307;
  return x - Math.floor(x);
}

function AmbientParticles({ arena }: { arena: ArenaConfig }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (arena.id === "volcanic") {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${8 + seededRandom(i * 6 + 1) * 84}%`,
              bottom: `${35 + seededRandom(i * 6 + 2) * 20}%`,
              width: 2 + seededRandom(i * 6 + 3) * 3,
              height: 2 + seededRandom(i * 6 + 4) * 3,
              background: i % 3 === 0 ? "#ff6600" : "#ff3300",
              borderRadius: "50%",
              boxShadow: "0 0 4px #ff4400",
              opacity: 0.7,
              animation: `emberFloat ${3 + seededRandom(i * 6 + 5) * 4}s ease-in-out infinite`,
              animationDelay: `${seededRandom(i * 6 + 6) * 5}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (arena.id === "ice") {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${seededRandom(i * 4 + 100) * 100}%`,
              top: `-5%`,
              width: 2,
              height: 2,
              background: i % 4 === 0 ? "#88ddff" : "#ffffff",
              borderRadius: "50%",
              opacity: 0.4 + seededRandom(i * 4 + 101) * 0.3,
              animation: `snowfall ${5 + seededRandom(i * 4 + 102) * 8}s linear infinite`,
              animationDelay: `${seededRandom(i * 4 + 103) * 8}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (arena.id === "neon") {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${seededRandom(i * 3 + 200) * 100}%`,
              top: `-2%`,
              width: 1,
              height: 8 + seededRandom(i * 3 + 201) * 16,
              background: "rgba(150,180,255,0.15)",
              animation: `rainDrop ${0.6 + seededRandom(i * 3 + 202) * 0.8}s linear infinite`,
              animationDelay: `${seededRandom(i * 3 + 203) * 2}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (arena.id === "gothic") {
    return (
      <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${10 + seededRandom(i * 4 + 300) * 80}%`,
              top: `${15 + seededRandom(i * 4 + 301) * 35}%`,
              width: 3,
              height: 3,
              background: "#39ff14",
              borderRadius: "50%",
              boxShadow: "0 0 8px #39ff14",
              opacity: 0,
              animation: `energyMote ${4 + seededRandom(i * 4 + 302) * 4}s ease-in-out infinite`,
              animationDelay: `${seededRandom(i * 4 + 303) * 6}s`,
            }}
          />
        ))}
      </div>
    );
  }

  return null;
}

// ── Main Arena Scene ───────────────────────────────────────────

const CHARACTER_MAP: Record<string, string> = {
  p1: "knight",
  p2: "ronin",
};

function getCharacterId(agentId: string | undefined, isP1: boolean): string {
  return isP1 ? CHARACTER_MAP.p1 : CHARACTER_MAP.p2;
}

export function ArenaScene({ gameState, arenaId }: ArenaSceneProps) {
  const [arena, setArena] = useState<ArenaConfig>(ARENAS.gothic);
  const arenaInitRef = useRef(false);

  useEffect(() => {
    if (arenaInitRef.current) return;
    arenaInitRef.current = true;
    if (arenaId && ARENAS[arenaId]) {
      setArena(ARENAS[arenaId]);
    } else {
      setArena(getRandomArena());
    }
  }, [arenaId]);

  // ── Sound Engine Init ──────────────────────────────
  const soundInitRef = useRef(false);

  const initSound = useCallback(() => {
    if (soundInitRef.current) return;
    if (soundEngine.init()) {
      soundInitRef.current = true;
      // Start crowd ambient if fight is already running
      if (gameState) soundEngine.playCrowdAmbient(true);
    }
  }, [gameState]);

  // Start crowd ambient when game first loads (if sound already init)
  const crowdStartedRef = useRef(false);
  useEffect(() => {
    if (gameState && soundInitRef.current && !crowdStartedRef.current) {
      soundEngine.playCrowdAmbient(true);
      crowdStartedRef.current = true;
    }
  }, [gameState]);

  // Cleanup sound engine on unmount
  useEffect(() => {
    return () => soundEngine.cleanup();
  }, []);

  const lastResult = gameState?.lastResult;
  const isP1Hurt = lastResult ? lastResult.p2Damage > 0 : false;
  const isP2Hurt = lastResult ? lastResult.p1Damage > 0 : false;
  const isP1KO = gameState ? gameState.p1.hp <= 0 : false;
  const isP2KO = gameState ? gameState.p2.hp <= 0 : false;

  const lastEntry =
    gameState?.history && gameState.history.length > 0
      ? gameState.history[gameState.history.length - 1]
      : null;

  // Two-phase animation: show attack lunge FIRST, then hurt reaction
  const [animPhase, setAnimPhase] = useState<"action" | "reaction">("action");
  const phaseExchangeRef = useRef(0);

  useEffect(() => {
    if (!gameState || gameState.exchange === phaseExchangeRef.current) return;
    phaseExchangeRef.current = gameState.exchange;

    // Phase 1: show the action (attack lunge) for 600ms
    setAnimPhase("action");
    const t = setTimeout(() => setAnimPhase("reaction"), 600);
    return () => clearTimeout(t);
  }, [gameState?.exchange]);

  // During "action" phase, suppress hurt so attacks animate first
  const showP1Hurt = animPhase === "reaction" && isP1Hurt;
  const showP2Hurt = animPhase === "reaction" && isP2Hurt;

  const p1Anim = getAnimState(lastEntry?.p1Action, showP1Hurt, isP1KO);
  const p2Anim = getAnimState(lastEntry?.p2Action, showP2Hurt, isP2KO);

  const p1Char = getCharacterId(gameState?.p1.agentId, true);
  const p2Char = getCharacterId(gameState?.p2.agentId, false);

  // ── 2.5D Fighter Positions ──────────────────────────────
  const BASE_P1: FighterPos = { x: -0.45, y: 0.25, z: 0 };
  const BASE_P2: FighterPos = { x: 0.45, y: 0.25, z: 0 };

  const [p1Pos, setP1Pos] = useState<FighterPos>(BASE_P1);
  const [p2Pos, setP2Pos] = useState<FighterPos>(BASE_P2);
  const [p1Landing, setP1Landing] = useState(false);
  const [p2Landing, setP2Landing] = useState(false);
  const animFrameRef = useRef<number>(null);

  // Jump velocity tracking (not in state — updated in rAF loop)
  const p1JumpVel = useRef(0);
  const p2JumpVel = useRef(0);
  const p1WasAirborne = useRef(false);
  const p2WasAirborne = useRef(false);

  // Base positions drift over time to create dynamic circling
  const p1Base = useRef<FighterPos>({ ...BASE_P1 });
  const p2Base = useRef<FighterPos>({ ...BASE_P2 });
  const exchangeCount = useRef(0);

  // Shift base positions each exchange so fighters reposition dynamically
  useEffect(() => {
    if (!gameState) return;
    if (gameState.exchange <= exchangeCount.current) return;
    exchangeCount.current = gameState.exchange;

    // Subtle base drift — small shifts create natural circling feeling
    const drift = () => {
      const dx = (Math.random() - 0.5) * 0.08;
      const dy = (Math.random() - 0.5) * 0.05;
      return { dx, dy };
    };

    const d1 = drift();
    const d2 = drift();
    p1Base.current = clampToArena({
      x: p1Base.current.x + d1.dx,
      y: p1Base.current.y + d1.dy,
      z: 0,
    });
    p2Base.current = clampToArena({
      x: p2Base.current.x + d2.dx,
      y: p2Base.current.y + d2.dy,
      z: 0,
    });

    // Keep fighters at a minimum resting separation (wider than strike gap)
    const MIN_REST_GAP = 0.35;
    if (Math.abs(p1Base.current.x - p2Base.current.x) < MIN_REST_GAP) {
      const center = (p1Base.current.x + p2Base.current.x) / 2;
      p1Base.current.x = clampToArena({
        x: center - MIN_REST_GAP / 2,
        y: 0,
        z: 0,
      }).x;
      p2Base.current.x = clampToArena({
        x: center + MIN_REST_GAP / 2,
        y: 0,
        z: 0,
      }).x;
    }
  }, [gameState?.exchange]);

  // Trigger jumps on specific actions
  useEffect(() => {
    if (shouldJump(lastEntry?.p1Action) && p1JumpVel.current === 0 && p1Pos.z < 1) {
      p1JumpVel.current = 4.5; // launch velocity
    }
    if (shouldJump(lastEntry?.p2Action) && p2JumpVel.current === 0 && p2Pos.z < 1) {
      p2JumpVel.current = 4.5;
    }
  }, [lastEntry?.p1Action, lastEntry?.p2Action]);

  useEffect(() => {
    let cancelled = false;
    const GRAVITY = 0.25;

    const animate = () => {
      if (cancelled) return;

      const target1 = getTargetPosition(p1Anim, "left", p1Base.current, p2Pos);
      const target2 = getTargetPosition(p2Anim, "right", p2Base.current, p1Pos);
      const speed1 = getLerpSpeed(p1Anim);
      const speed2 = getLerpSpeed(p2Anim);

      setP1Pos((prev) => {
        // Jump physics
        let z = prev.z + p1JumpVel.current;
        p1JumpVel.current -= GRAVITY;
        if (z <= 0) {
          z = 0;
          // Landing detection
          if (p1WasAirborne.current) {
            setP1Landing(true);
            setTimeout(() => setP1Landing(false), 300);
          }
          p1JumpVel.current = 0;
        }
        p1WasAirborne.current = z > 0.5;

        return clampToArena({
          x: lerp(prev.x, target1.x, speed1),
          y: lerp(prev.y, target1.y, speed1),
          z,
        });
      });

      setP2Pos((prev) => {
        let z = prev.z + p2JumpVel.current;
        p2JumpVel.current -= GRAVITY;
        if (z <= 0) {
          z = 0;
          if (p2WasAirborne.current) {
            setP2Landing(true);
            setTimeout(() => setP2Landing(false), 300);
          }
          p2JumpVel.current = 0;
        }
        p2WasAirborne.current = z > 0.5;

        return clampToArena({
          x: lerp(prev.x, target2.x, speed2),
          y: lerp(prev.y, target2.y, speed2),
          z,
        });
      });

      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [p1Anim, p2Anim]);

  // Dynamic facing — fighters always face each other
  const p1FacingRight = p1Pos.x < p2Pos.x;

  // ── Camera Shake + Zoom Pulse ───────────────────────────
  const [shakeClass, setShakeClass] = useState("");
  const sceneRef = useRef<HTMLDivElement>(null);

  // ── Damage tracking ─────────────────────────────────────
  const [damageKey, setDamageKey] = useState(0);
  const prevExchange = useRef(0);

  // ── Callout system ──────────────────────────────────────
  const [callout, setCallout] = useState<{ type: CalloutType; round?: number; key: number } | null>(null);
  const calloutKeyRef = useRef(0);
  const prevRoundRef = useRef(0);

  // Trigger effects on exchange
  useEffect(() => {
    if (!gameState) return;
    if (gameState.exchange === prevExchange.current) return;

    const isNewExchange = gameState.exchange > prevExchange.current;
    prevExchange.current = gameState.exchange;
    setDamageKey((k) => k + 1);

    if (!isNewExchange) return;

    const totalDamage = (lastResult?.p1Damage ?? 0) + (lastResult?.p2Damage ?? 0);
    if (totalDamage > 0) {
      // Camera shake — intensity based on damage
      const intensity = totalDamage > 20 ? "heavy" : "light";
      setShakeClass(intensity === "heavy" ? "shake-heavy" : "shake-light");
      setTimeout(() => setShakeClass(""), 350);
    }

    // ── Combat Sounds ────────────────────────────────
    if (soundInitRef.current && lastEntry) {
      const p1Act = lastEntry.p1Action.toLowerCase();
      const p2Act = lastEntry.p2Action.toLowerCase();
      const p1Dmg = lastResult?.p1Damage ?? 0;
      const p2Dmg = lastResult?.p2Damage ?? 0;

      if (p2Dmg > 0) {
        // P1 hit P2
        if (isHeavyAction(p1Act)) soundEngine.playHitHeavy();
        else soundEngine.playHitLight();
      }
      if (p1Dmg > 0) {
        // P2 hit P1 — slight offset so both don't stack exactly
        setTimeout(() => {
          if (isHeavyAction(p2Act)) soundEngine.playHitHeavy();
          else soundEngine.playHitLight();
        }, 80);
      }
      // Block clang — blocker took no damage while opponent attacked
      if (p1Act.includes("block") && p1Dmg === 0 && p2Dmg === 0) {
        soundEngine.playBlock();
      } else if (p2Act.includes("block") && p1Dmg === 0 && p2Dmg === 0) {
        soundEngine.playBlock();
      }
      // Dodge whoosh — dodger evaded, no damage exchanged
      if ((p1Act.includes("dodge") || p2Act.includes("dodge")) && p1Dmg === 0 && p2Dmg === 0) {
        soundEngine.playDodge();
      }
    }

    // KO callout + stinger
    if (isP1KO || isP2KO) {
      calloutKeyRef.current += 1;
      setCallout({ type: "ko", key: calloutKeyRef.current });
      if (soundInitRef.current) soundEngine.playKO();
    }
  }, [gameState?.exchange]);

  // Round start callout
  useEffect(() => {
    if (!gameState) return;
    const currentRound = gameState.p1.roundWins + gameState.p2.roundWins + 1;
    if (currentRound !== prevRoundRef.current && gameState.exchange === 0) {
      prevRoundRef.current = currentRound;
      calloutKeyRef.current += 1;
      setCallout({ type: "round", round: currentRound, key: calloutKeyRef.current });
      if (soundInitRef.current) soundEngine.playRoundBell();
      // Follow up with FIGHT! after a delay
      setTimeout(() => {
        calloutKeyRef.current += 1;
        setCallout({ type: "fight", key: calloutKeyRef.current });
        if (soundInitRef.current) soundEngine.playCrowdCheer();
      }, 1200);
    }
  }, [gameState?.p1.roundWins, gameState?.p2.roundWins, gameState?.exchange]);

  // Victory fanfare when fight ends
  const fightOverFiredRef = useRef(false);
  useEffect(() => {
    if (gameState?.status === "fight_over" && !fightOverFiredRef.current) {
      fightOverFiredRef.current = true;
      if (soundInitRef.current) {
        setTimeout(() => soundEngine.playVictory(), 800);
        setTimeout(() => soundEngine.playCrowdCheer(), 400);
      }
    }
    if (gameState?.status !== "fight_over") {
      fightOverFiredRef.current = false;
    }
  }, [gameState?.status]);

  // Landing thud when fighters touch ground after a jump
  useEffect(() => {
    if (p1Landing && soundInitRef.current) soundEngine.playLandingThud();
  }, [p1Landing]);
  useEffect(() => {
    if (p2Landing && soundInitRef.current) soundEngine.playLandingThud();
  }, [p2Landing]);

  return (
    <div
      ref={sceneRef}
      className={shakeClass}
      onClick={initSound}
      style={{
        width: "100%",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
        background: arena.bgTint,
        cursor: soundInitRef.current ? "default" : "pointer",
      }}
    >
      {/* Arena background panorama — depth-of-field blur for distant bg */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: 1920,
          height: "68%",
          backgroundImage: `url(${arena.bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          filter: "blur(1.2px)",
        }}
      />

      {/* Vignette overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse at 50% 35%, transparent 30%, ${arena.bgTint}cc 85%),
            linear-gradient(to bottom, transparent 45%, ${arena.bgTint} 72%)
          `,
          zIndex: 1,
        }}
      />

      {/* Crowd layer — behind fighters, with depth blur */}
      <CrowdLayer arena={arena} />

      {/* Ambient particles */}
      <AmbientParticles arena={arena} />

      {/* Full-width arena ground */}
      <ArenaGround arena={arena} />

      {/* Fighters */}
      <FighterSprite
        characterId={p1Char}
        animState={p1Anim}
        flipX={!p1FacingRight}
        pos={p1Pos}
        arena={arena}
        isLanding={p1Landing}
      />
      <FighterSprite
        characterId={p2Char}
        animState={p2Anim}
        flipX={p1FacingRight}
        pos={p2Pos}
        arena={arena}
        isLanding={p2Landing}
      />

      {/* Hit Sparks */}
      {lastResult && lastResult.p2Damage > 0 && (
        <HitSparks
          key={`spark-p2-${damageKey}`}
          pos={p2Pos}
          arena={arena}
          intensity={lastResult.p2Damage > 15 ? "heavy" : "light"}
        />
      )}
      {lastResult && lastResult.p1Damage > 0 && (
        <HitSparks
          key={`spark-p1-${damageKey}`}
          pos={p1Pos}
          arena={arena}
          intensity={lastResult.p1Damage > 15 ? "heavy" : "light"}
        />
      )}

      {/* Damage popups */}
      {lastResult && lastResult.p2Damage > 0 && (
        <DamagePopup
          key={`p2-${damageKey}`}
          damage={lastResult.p2Damage}
          pos={p2Pos}
        />
      )}
      {lastResult && lastResult.p1Damage > 0 && (
        <DamagePopup
          key={`p1-${damageKey}`}
          damage={lastResult.p1Damage}
          pos={p1Pos}
        />
      )}

      {/* Round / Fight / KO Callout */}
      {callout && (
        <CalloutOverlay
          key={callout.key}
          type={callout.type}
          roundNum={callout.round}
          arena={arena}
        />
      )}

      {/* HUD */}
      {gameState && <FightHUD state={gameState} />}

      {/* Arena name plate */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          color: arena.accentGlow,
          fontSize: 10,
          letterSpacing: 6,
          textTransform: "uppercase",
          fontFamily: "monospace",
          fontWeight: 700,
        }}
      >
        {arena.name}
      </div>

      {/* CSS Animations */}
      <style>{`
        /* ── Camera Shake ─────────────────────────── */
        .shake-light {
          animation: cameraShakeLight 0.3s ease-out;
        }
        .shake-heavy {
          animation: cameraShakeHeavy 0.35s ease-out;
        }

        @keyframes cameraShakeLight {
          0% { transform: translate(0, 0) scale(1); }
          15% { transform: translate(-2px, 1px) scale(1.008); }
          30% { transform: translate(2px, -1px) scale(1.012); }
          45% { transform: translate(-1px, 0px) scale(1.006); }
          60% { transform: translate(1px, 1px) scale(1.002); }
          100% { transform: translate(0, 0) scale(1); }
        }

        @keyframes cameraShakeHeavy {
          0% { transform: translate(0, 0) scale(1); }
          10% { transform: translate(-3px, 2px) scale(1.015); }
          25% { transform: translate(3px, -2px) scale(1.025); }
          40% { transform: translate(-2px, 1px) scale(1.018); }
          55% { transform: translate(2px, -1px) scale(1.008); }
          70% { transform: translate(-1px, 0) scale(1.003); }
          100% { transform: translate(0, 0) scale(1); }
        }

        /* ── Action Glow Pulse ────────────────────── */
        @keyframes glowPulse {
          0% { opacity: 0; transform: translateX(-50%) scale(0.6); }
          30% { opacity: 1; transform: translateX(-50%) scale(1); }
          100% { opacity: 0; transform: translateX(-50%) scale(1.3); }
        }

        /* ── Landing Ring ────────────────────────── */
        @keyframes landingRing {
          0% { opacity: 0.8; transform: translateX(-50%) scale(0.5); }
          50% { opacity: 0.5; transform: translateX(-50%) scale(1.5); }
          100% { opacity: 0; transform: translateX(-50%) scale(2.2); }
        }

        /* ── Damage Float ─────────────────────────── */
        @keyframes damageFloat {
          0% { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-60px); }
        }

        /* ── Hit Spark Burst ──────────────────────── */
        @keyframes sparkBurst {
          0% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(var(--dx), var(--dy)) scale(0.3);
            opacity: 0;
          }
        }

        /* ── Round Callout Slam ───────────────────── */
        @keyframes calloutSlam {
          0% {
            transform: scale(2.5);
            opacity: 0;
          }
          25% {
            transform: scale(1);
            opacity: 1;
          }
          70% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(1.1);
            opacity: 0;
          }
        }

        /* ── Ambient: Volcanic Embers ─────────────── */
        @keyframes emberFloat {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          15% { opacity: 0.8; }
          50% { transform: translateY(-40px) translateX(10px); opacity: 0.6; }
          85% { opacity: 0.3; }
          100% { transform: translateY(-80px) translateX(-5px); opacity: 0; }
        }

        /* ── Ambient: Snowfall ────────────────────── */
        @keyframes snowfall {
          0% { transform: translateY(-20px) translateX(0); opacity: 0; }
          10% { opacity: 0.6; }
          90% { opacity: 0.3; }
          100% { transform: translateY(100vh) translateX(30px); opacity: 0; }
        }

        /* ── Ambient: Neon Rain ───────────────────── */
        @keyframes rainDrop {
          0% { transform: translateY(-20px); opacity: 0; }
          10% { opacity: 0.3; }
          90% { opacity: 0.15; }
          100% { transform: translateY(100vh); opacity: 0; }
        }

        /* ── Ambient: Gothic Energy Motes ─────────── */
        @keyframes energyMote {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          30% { opacity: 0.6; transform: translateY(-10px) scale(1); }
          60% { opacity: 0.4; transform: translateY(-25px) scale(0.8); }
          100% { opacity: 0; transform: translateY(-40px) scale(0.3); }
        }
      `}</style>
    </div>
  );
}

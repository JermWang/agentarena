# Pit & Spectator Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform The Pit into a grand 2.5D lobby scene with AI-generated backgrounds, agent sprites with chat bubbles, wager trade windows, and add human spectator chat to the Fights tab with wallet-based accounts.

**Architecture:** Generate pit background assets via Gemini Imagen API. Build a `PitScene` component reusing the ArenaScene 2.5D positioning/depth system. Merge the pit scene + action log into the spectate page's "THE PIT" tab. Add a spectator chat panel to the "FIGHTS" tab using the existing WebSocket infrastructure and RainbowKit wallet auth.

**Tech Stack:** Gemini Imagen API (free credits), React + Next.js 16, RainbowKit/wagmi (wallet auth), WebSocket (real-time chat), Canvas API (sprite rendering)

---

### Task 1: Generate Pit Background Assets via Gemini

**Files:**
- Create: `packages/server/scripts/generate-pit-assets.ts`
- Output: `packages/web/public/sprites/pit-bg.png`, `pit-floor.png`, `pit-crowd.png`

**Step 1: Create the asset generation script**

```typescript
// packages/server/scripts/generate-pit-assets.ts
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, "../../web/public/sprites");
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
  console.error("Set GOOGLE_API_KEY env var");
  process.exit(1);
}

interface GenerationTask {
  name: string;
  filename: string;
  prompt: string;
}

const TASKS: GenerationTask[] = [
  {
    name: "Pit Background",
    filename: "pit-bg.png",
    prompt: `Digital painting of a massive underground fighting arena lobby, dark atmospheric scene.
Grand stone colosseum interior with tiered seating rising into darkness on both sides.
Wide open floor area in the center, worn stone tiles.
Neon green magical torches and braziers provide eerie lighting along the walls.
Gothic architecture with massive pillars, arched doorways, and chains hanging from ceiling.
Dark fantasy style. Moody, atmospheric. Green accent lighting.
The space feels grand and spacious, like a famous underground venue.
No characters or fighters in the scene. Empty but alive with ambient light.
Style: detailed painterly digital art, dark color palette with neon green highlights.
Resolution: 1920x1080. Landscape orientation.`,
  },
  {
    name: "Pit Floor Texture",
    filename: "pit-floor.png",
    prompt: `Seamless tileable stone floor texture for a dark fantasy fighting arena.
Worn cobblestone with subtle cracks, old bloodstains, moss in gaps.
Dark gray and charcoal tones with subtle green-tinted lighting highlights.
Top-down view. Seamless repeating pattern.
Style: detailed painterly digital art matching a gothic underground colosseum.
Resolution: 512x512. Must tile seamlessly.`,
  },
  {
    name: "Pit Crowd Silhouettes",
    filename: "pit-crowd.png",
    prompt: `Silhouette of spectator crowd for a dark fantasy underground fighting arena.
Dark shadowy figures sitting in tiered stone seating, barely visible.
Hints of neon green light reflecting off some figures.
Semi-transparent feel, atmospheric background element.
Wide panoramic format. Very dark with subtle figure outlines.
Style: painterly digital art, dark atmospheric.
Resolution: 1920x200. Wide banner format.`,
  },
];

async function generateImage(task: GenerationTask): Promise<Buffer> {
  console.log(`Generating: ${task.name}...`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Generate an image: ${task.prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          responseMimeType: "image/png",
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();

  // Extract image from response
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.mimeType?.startsWith("image/")) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }
  }

  throw new Error("No image in Gemini response");
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const task of TASKS) {
    try {
      const imageBuffer = await generateImage(task);
      const outPath = join(OUTPUT_DIR, task.filename);
      writeFileSync(outPath, imageBuffer);
      console.log(`  Saved: ${outPath} (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error(`  FAILED: ${task.name}:`, err);
    }
  }

  console.log("\nDone! Assets saved to:", OUTPUT_DIR);
}

main();
```

**Step 2: Run the generation script**

Run: `cd /home/hackerman/arena/packages/server && GOOGLE_API_KEY=$GOOGLE_API_KEY npx tsx scripts/generate-pit-assets.ts`
Expected: 3 PNG files created in `packages/web/public/sprites/`

**Step 3: Verify assets exist and have reasonable sizes**

Run: `ls -la /home/hackerman/arena/packages/web/public/sprites/pit-*.png`
Expected: 3 files, bg should be 500KB-2MB, floor 100-500KB, crowd 50-200KB

**Step 4: If Gemini 2.0 Flash doesn't support image generation, try Imagen API**

The Gemini API may need a different model for image generation. If the above fails, update the script to use `imagen-3.0-generate-002`:

```typescript
// Alternative: use Imagen 3 endpoint
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: task.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: task.filename.includes("crowd") ? "16:3" : task.filename.includes("floor") ? "1:1" : "16:9",
      },
    }),
  }
);
```

**Step 5: Commit**

```bash
git add packages/server/scripts/generate-pit-assets.ts packages/web/public/sprites/pit-*.png
git commit -m "feat: generate pit background assets via Gemini Imagen API"
```

---

### Task 2: Build PitScene Component (2.5D Lobby)

**Files:**
- Create: `packages/web/components/pit/PitScene.tsx`

This component reuses ArenaScene's 2.5D positioning math but renders multiple agents in a wider space with chat bubbles and wager windows.

**Step 1: Create the PitScene component**

```typescript
// packages/web/components/pit/PitScene.tsx
"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────

interface PitAgent {
  agentId: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
}

interface ChatBubble {
  id: string;
  agentId: string;
  message: string;
  type: "chat" | "callout";
  timestamp: number;
}

interface WagerWindow {
  id: string;
  from: string;
  target: string;
  fromCharacter: string;
  targetCharacter: string;
  wager: number;
  status: "open" | "accepted" | "declined";
  timestamp: number;
}

interface PitSceneProps {
  agents: PitAgent[];
  bubbles: ChatBubble[];
  wagers: WagerWindow[];
  agentCount: number;
}

// ── Pit Arena Config ──────────────────────────────────────────

const PIT_CONFIG = {
  bgImage: "/sprites/pit-bg.png",
  floorImage: "/sprites/pit-floor.png",
  crowdImage: "/sprites/pit-crowd.png",
  accentColor: "#39ff14",
  accentGlow: "rgba(57,255,20,0.3)",
};

// Wider bounds than fight arena — more room for agents
const PIT_BOUNDS = {
  xMin: -0.9,
  xMax: 0.9,
  yMin: 0.0,
  yMax: 0.6,
};

// ── Mood System ───────────────────────────────────────────────

type Mood = "quiet" | "active" | "heated";

function getMood(agentCount: number, hasActiveWager: boolean): Mood {
  if (hasActiveWager || agentCount >= 9) return "heated";
  if (agentCount >= 4) return "active";
  return "quiet";
}

const MOOD_STYLES: Record<Mood, { filter: string; particleCount: number; glowOpacity: number }> = {
  quiet: { filter: "brightness(0.7) saturate(0.8) hue-rotate(-10deg)", particleCount: 8, glowOpacity: 0.1 },
  active: { filter: "brightness(0.85) saturate(1.0)", particleCount: 16, glowOpacity: 0.25 },
  heated: { filter: "brightness(1.0) saturate(1.2) contrast(1.05)", particleCount: 30, glowOpacity: 0.45 },
};

// ── Stable agent positions (deterministic from agentId) ──────

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getAgentPosition(agentId: string): { x: number; y: number } {
  const h = hashCode(agentId);
  const x = PIT_BOUNDS.xMin + (h % 1000) / 1000 * (PIT_BOUNDS.xMax - PIT_BOUNDS.xMin);
  const y = PIT_BOUNDS.yMin + ((h >> 10) % 1000) / 1000 * (PIT_BOUNDS.yMax - PIT_BOUNDS.yMin);
  return { x, y };
}

// ── Ambient Particles ─────────────────────────────────────────

function AmbientParticles({ count }: { count: number }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 5 }}>
      {Array.from({ length: count }).map((_, i) => {
        const x = Math.random() * 100;
        const delay = Math.random() * 8;
        const dur = 6 + Math.random() * 8;
        const size = 2 + Math.random() * 3;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              bottom: "-5%",
              width: size,
              height: size,
              background: PIT_CONFIG.accentColor,
              opacity: 0.3 + Math.random() * 0.4,
              borderRadius: "50%",
              boxShadow: `0 0 4px ${PIT_CONFIG.accentColor}`,
              animation: `particleRise ${dur}s ${delay}s linear infinite`,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Agent Sprite in Pit ───────────────────────────────────────

function PitAgentSprite({
  agent,
  bubble,
}: {
  agent: PitAgent;
  bubble?: ChatBubble;
}) {
  const [frame, setFrame] = useState(0);
  const pos = getAgentPosition(agent.agentId);
  const depthScale = 1.0 - pos.y * 0.25;
  const screenX = 50 + pos.x * 30;
  const bottomPct = 12 + pos.y * 16;
  const zIdx = Math.round((1 - pos.y) * 20) + 10;
  const spriteSize = Math.round(140 * depthScale);
  const sheetSize = spriteSize * 4;

  useEffect(() => {
    const iv = setInterval(() => setFrame((f) => (f + 1) % 4), 200);
    return () => clearInterval(iv);
  }, []);

  const sheetUrl = `/sprites/${agent.characterId}-idle-sheet.png`;

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${bottomPct}%`,
        left: `${screenX}%`,
        transform: "translateX(-50%)",
        zIndex: zIdx,
      }}
    >
      {/* Chat bubble */}
      {bubble && (
        <div
          style={{
            position: "absolute",
            bottom: spriteSize + 8,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 12px",
            background: bubble.type === "callout" ? "rgba(255,107,0,0.9)" : "rgba(10,10,15,0.9)",
            border: `1px solid ${bubble.type === "callout" ? "#ff6b00" : "rgba(57,255,20,0.4)"}`,
            color: bubble.type === "callout" ? "#fff" : "#ccc",
            fontSize: 11,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            zIndex: zIdx + 50,
            animation: "bubbleFadeIn 0.3s ease-out",
            pointerEvents: "none",
          }}
        >
          {bubble.message}
          {/* Speech bubble triangle */}
          <div style={{
            position: "absolute",
            bottom: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            borderTop: `6px solid ${bubble.type === "callout" ? "rgba(255,107,0,0.9)" : "rgba(10,10,15,0.9)"}`,
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
          fontSize: 9 * depthScale,
          color: PIT_CONFIG.accentColor,
          fontFamily: "monospace",
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          textShadow: "0 0 4px rgba(0,0,0,0.8)",
          pointerEvents: "none",
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

      {/* Sprite */}
      <div
        style={{
          width: spriteSize,
          height: spriteSize,
          backgroundImage: `url(${sheetUrl})`,
          backgroundSize: `${sheetSize}px ${spriteSize}px`,
          backgroundPosition: `-${frame * spriteSize}px 0`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          filter: `drop-shadow(0 0 8px ${PIT_CONFIG.accentColor}30)`,
        }}
      />
    </div>
  );
}

// ── Wager Trade Window ────────────────────────────────────────

function WagerTradeWindow({ wager, agents }: { wager: WagerWindow; agents: PitAgent[] }) {
  const fromAgent = agents.find((a) => a.username === wager.from);
  const targetAgent = agents.find((a) => a.username === wager.target);
  if (!fromAgent || !targetAgent) return null;

  const fromPos = getAgentPosition(fromAgent.agentId);
  const targetPos = getAgentPosition(targetAgent.agentId);
  const midX = 50 + ((fromPos.x + targetPos.x) / 2) * 30;
  const midY = Math.max(12 + fromPos.y * 16, 12 + targetPos.y * 16) + 18;
  const isAccepted = wager.status === "accepted";

  return (
    <div
      style={{
        position: "absolute",
        bottom: `${midY}%`,
        left: `${midX}%`,
        transform: "translateX(-50%)",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          padding: "8px 16px",
          background: isAccepted ? "rgba(57,255,20,0.15)" : "rgba(255,107,0,0.15)",
          border: `2px solid ${isAccepted ? "#39ff14" : "#ff6b00"}`,
          textAlign: "center",
          fontFamily: "monospace",
          animation: isAccepted ? "wagerPulse 1s ease-in-out infinite" : "none",
          boxShadow: isAccepted
            ? "0 0 20px rgba(57,255,20,0.4), 0 0 40px rgba(57,255,20,0.2)"
            : "0 0 10px rgba(255,107,0,0.3)",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#999", marginBottom: 4 }}>
          WAGER
        </div>
        <div style={{
          fontSize: 18,
          fontWeight: 900,
          color: isAccepted ? "#39ff14" : "#ff6b00",
          letterSpacing: 1,
        }}>
          {(wager.wager / 1000).toFixed(0)}K $ARENA
        </div>
        <div style={{ fontSize: 11, color: "#ccc", marginTop: 4 }}>
          <span style={{ color: "#39ff14" }}>{wager.from}</span>
          <span style={{ color: "#777", margin: "0 6px" }}>vs</span>
          <span style={{ color: "#ff6b00" }}>{wager.target}</span>
        </div>
        <div style={{
          fontSize: 9,
          letterSpacing: 2,
          marginTop: 4,
          color: isAccepted ? "#39ff14" : "#ff6b00",
          textTransform: "uppercase",
          fontWeight: 700,
        }}>
          {wager.status === "open" ? "OPEN CHALLENGE" : wager.status === "accepted" ? "ACCEPTED" : "DECLINED"}
        </div>
      </div>
    </div>
  );
}

// ── Main PitScene Component ───────────────────────────────────

export default function PitScene({ agents, bubbles, wagers, agentCount }: PitSceneProps) {
  const hasActiveWager = wagers.some((w) => w.status === "open" || w.status === "accepted");
  const mood = getMood(agentCount, hasActiveWager);
  const moodStyle = MOOD_STYLES[mood];

  // Only show recent bubbles (last 5 seconds)
  const now = Date.now();
  const activeBubbles = bubbles.filter((b) => now - b.timestamp < 5000);
  const bubbleMap = new Map<string, ChatBubble>();
  for (const b of activeBubbles) {
    bubbleMap.set(b.agentId, b); // latest bubble per agent
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 200px)", overflow: "hidden", background: "#080810" }}>
      {/* Background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${PIT_CONFIG.bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: moodStyle.filter,
          transition: "filter 1.5s ease",
        }}
      />

      {/* Crowd layer */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: 0,
          right: 0,
          height: "25%",
          backgroundImage: `url(${PIT_CONFIG.crowdImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          opacity: 0.6,
          pointerEvents: "none",
        }}
      />

      {/* Floor */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "-10%",
          right: "-10%",
          height: "40%",
          transform: "perspective(500px) rotateX(25deg)",
          transformOrigin: "bottom center",
          backgroundImage: `url(${PIT_CONFIG.floorImage})`,
          backgroundSize: "180px 180px",
          backgroundRepeat: "repeat",
          imageRendering: "pixelated" as const,
          opacity: 0.7,
        }}
      />

      {/* Floor glow — intensifies with mood */}
      <div
        style={{
          position: "absolute",
          bottom: "5%",
          left: "20%",
          right: "20%",
          height: "20%",
          borderRadius: "50%",
          background: `radial-gradient(ellipse, ${PIT_CONFIG.accentColor}${Math.round(moodStyle.glowOpacity * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
          transition: "all 1.5s ease",
          pointerEvents: "none",
        }}
      />

      {/* Ambient particles */}
      <AmbientParticles count={moodStyle.particleCount} />

      {/* Vignette on heated mood */}
      {mood === "heated" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: `inset 0 0 120px rgba(57,255,20,0.15), inset 0 0 60px rgba(57,255,20,0.1)`,
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      )}

      {/* Agent sprites */}
      {agents.map((agent) => (
        <PitAgentSprite
          key={agent.agentId}
          agent={agent}
          bubble={bubbleMap.get(agent.agentId)}
        />
      ))}

      {/* Wager trade windows */}
      {wagers
        .filter((w) => w.status !== "declined")
        .map((w) => (
          <WagerTradeWindow key={w.id} wager={w} agents={agents} />
        ))}

      {/* Keyframes */}
      <style>{`
        @keyframes particleRise {
          0% { transform: translateY(0) scale(1); opacity: 0.4; }
          100% { transform: translateY(-100vh) scale(0.3); opacity: 0; }
        }
        @keyframes bubbleFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes wagerPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(57,255,20,0.4), 0 0 40px rgba(57,255,20,0.2); }
          50% { box-shadow: 0 0 30px rgba(57,255,20,0.6), 0 0 60px rgba(57,255,20,0.3); }
        }
      `}</style>
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd /home/hackerman/arena/packages/web && npx tsc --noEmit components/pit/PitScene.tsx 2>&1 | head -20`

**Step 3: Commit**

```bash
git add packages/web/components/pit/PitScene.tsx
git commit -m "feat: add PitScene 2.5D lobby component with mood system, chat bubbles, wager windows"
```

---

### Task 3: Integrate PitScene into Spectate Page

**Files:**
- Modify: `packages/web/app/spectate/page.tsx` — replace PitView text chat with PitScene + action log layout

**Step 1: Update the PitView in spectate page**

Replace the existing `PitView` function in `spectate/page.tsx` to:
- Render the `PitScene` component as the main visual (75% width)
- Keep the action log as a scrolling sidebar (25% width)
- Bottom bar shows agent roster strip
- Pass WebSocket events as bubbles/wagers to PitScene

Key changes to `PitView`:
- Import `PitScene` from `../../components/pit/PitScene`
- Track `bubbles: ChatBubble[]` and `wagers: WagerWindow[]` state arrays
- Map WebSocket `pit_chat` events to both the action log AND PitScene bubbles
- Map `callout_issued` events to both the action log AND PitScene wager windows
- Map `callout_accepted` / `callout_declined` to update wager status
- Layout: flex row with PitScene on left, action log on right
- Bottom agent roster bar with character icons

**Step 2: Verify the page loads and renders the scene**

Run: open `http://localhost:3000/spectate` and verify PitScene renders with background

**Step 3: Commit**

```bash
git add packages/web/app/spectate/page.tsx
git commit -m "feat: integrate PitScene into spectate page with action log sidebar"
```

---

### Task 4: Add Spectator Chat to Fights Tab

**Files:**
- Modify: `packages/web/app/spectate/page.tsx` — add chat panel to FightsView

**Step 1: Add spectator chat state and WebSocket to FightsView**

Update `FightsView` to:
- Connect to WebSocket for spectator chat events
- Left panel (60%): active fight cards (existing)
- Right panel (40%): spectator chat with message input
- Chat input only enabled when wallet is connected
- Use `useAccount()` from wagmi to get connected wallet address
- Display username as ENS name or truncated address

Key additions:
- `spectatorMessages: { from: string; displayName: string; message: string; timestamp: number }[]`
- WebSocket sends `{ type: "spectator_chat", message, walletAddress }`
- WebSocket receives `{ event: "spectator_message", data: { ... } }`
- Chat input with send button, rate limited to 1 msg/sec
- "Connect wallet to chat" prompt when not connected

**Step 2: Add wallet-gated chat input component**

```typescript
function SpectatorChat() {
  const { address, isConnected } = useAccount();
  const [messages, setMessages] = useState<SpectatorMessage[]>([]);
  const [input, setInput] = useState("");
  const [lastSent, setLastSent] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ... WebSocket connection for spectator_chat channel
  // ... rate limiting (1 msg/sec)
  // ... auto-scroll on new messages

  if (!isConnected) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "#888" }}>
        <p>Connect your wallet to join the chat</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 6, fontSize: 12, fontFamily: "monospace" }}>
            <span style={{ color: "#39ff14", fontWeight: 700 }}>
              {msg.displayName}
            </span>
            : <span style={{ color: "#ccc" }}>{msg.message}</span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      {/* Input */}
      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid rgba(57,255,20,0.2)" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 280))}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Say something..."
          style={{
            flex: 1, padding: "8px 12px",
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(57,255,20,0.2)",
            color: "#fff", fontFamily: "monospace", fontSize: 12,
            outline: "none",
          }}
        />
        <button onClick={sendMessage} style={{
          padding: "8px 16px",
          background: "#39ff14", color: "#0a0a0f",
          border: "none", fontWeight: 700, fontSize: 12,
          letterSpacing: 1, cursor: "pointer",
        }}>
          SEND
        </button>
      </div>
    </div>
  );
}
```

**Step 3: Verify fights tab shows chat panel**

Open `http://localhost:3000/spectate`, click FIGHTS tab, verify chat panel appears on right side

**Step 4: Commit**

```bash
git add packages/web/app/spectate/page.tsx
git commit -m "feat: add wallet-gated spectator chat to fights tab"
```

---

### Task 5: Add wagmi useAccount Import and Fight Wager Display

**Files:**
- Modify: `packages/web/app/spectate/page.tsx` — add wagmi import at top
- Modify: `FightsView` — show wager amounts on fight cards

**Step 1: Add import and update fight cards**

Add to top of spectate page:
```typescript
import { useAccount } from "wagmi";
```

Update fight cards to prominently show wager amounts:
```typescript
{f.wager && f.wager > 0 && (
  <div style={{
    fontSize: 14, fontWeight: 700, color: "#ff6b00",
    marginTop: 8, letterSpacing: 1,
  }}>
    {(f.wager / 1000).toFixed(0)}K $ARENA ON THE LINE
  </div>
)}
```

**Step 2: Commit**

```bash
git add packages/web/app/spectate/page.tsx
git commit -m "feat: show wager amounts on fight cards, add wagmi import"
```

---

### Task 6: Dynamic Mood Polish & Animations

**Files:**
- Modify: `packages/web/components/pit/PitScene.tsx` — add idle wander animation for agents

**Step 1: Add gentle idle wander**

Update `getAgentPosition` to return a base position, then add a slow wandering animation using `useEffect` with a timer that slightly adjusts each agent's x/y over time (sine wave oscillation around their base position).

**Step 2: Add sprite facing direction**

Agents should face each other during callouts. When a wager is active, both involved agents flip to face each other.

**Step 3: Commit**

```bash
git add packages/web/components/pit/PitScene.tsx
git commit -m "feat: add idle wander and callout facing to pit agents"
```

---

### Task 7: Final Integration Test & Cleanup

**Step 1: Verify full flow**
- Open localhost:3000
- Click SPECTATE
- Pit tab: see 2.5D scene with background, verify mood system
- Fights tab: see fight cards + spectator chat
- Connect wallet: verify chat input enables

**Step 2: Remove old standalone pit page route (optional)**
The `/pit` route is now redundant since The Pit is inside `/spectate`. Can keep it as a direct link or remove.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete pit & spectator experience - 2.5D lobby, chat, wager windows"
```

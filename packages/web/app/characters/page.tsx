"use client";

import { useState, useCallback } from "react";
// ── Character Data ────────────────────────────────────────────

const characters = [
  {
    id: "ronin",
    name: "Ronin",
    glow: "#ff6b6b",
    preview: "/sprites/ronin-preview.png",
    idleSheet: "/sprites/ronin-idle-sheet.png",
    style: "Counter-Fighter",
    difficulty: "★★★☆",
    traits: ["Pattern Reading", "Heavy Punishes", "Mid-Range"],
    description:
      "A disgraced samurai who fights with calculated fury. Reads opponent patterns and delivers devastating counter-attacks.",
  },
  {
    id: "knight",
    name: "Knight",
    glow: "#74b9ff",
    preview: "/sprites/knight-preview.png",
    idleSheet: "/sprites/knight-idle-sheet.png",
    style: "Defensive Wall",
    difficulty: "★★☆☆",
    traits: ["High Guard", "Stamina Efficient", "Punish Windows"],
    description:
      "An armored sentinel who outlasts opponents through superior defense. Waits for mistakes with iron patience.",
  },
  {
    id: "cyborg",
    name: "Cyborg",
    glow: "#39ff14",
    preview: "/sprites/cyborg-preview.png",
    idleSheet: "/sprites/cyborg-idle-sheet.png",
    style: "Optimal Machine",
    difficulty: "★★★★",
    traits: ["Frame Perfect", "Stamina Math", "Calculated"],
    description:
      "Half human, half machine. Every action is mathematically optimal. Masters stamina management and frame data.",
  },
  {
    id: "demon",
    name: "Demon",
    glow: "#ff6600",
    preview: "/sprites/demon-preview.png",
    idleSheet: "/sprites/demon-idle-sheet.png",
    style: "Pressure Rush",
    difficulty: "★★★☆",
    traits: ["Relentless", "High Damage", "Risky"],
    description:
      "A hellborn brawler who never lets up. Trades defense for overwhelming aggression. High risk, high reward.",
  },
  {
    id: "phantom",
    name: "Phantom",
    glow: "#c084fc",
    preview: "/sprites/phantom-preview.png",
    idleSheet: "/sprites/phantom-idle-sheet.png",
    style: "Evasive Trickster",
    difficulty: "★★★★",
    traits: ["Dodge Master", "Counter Hits", "Unpredictable"],
    description:
      "A spectral fighter who phases through attacks. Relies on evasion and misdirection to punish overcommitment.",
  },
];

// ── Page Component ────────────────────────────────────────────

export default function CharactersPage() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = characters[selectedIndex];

  const navigate = useCallback(
    (dir: number) => {
      setSelectedIndex(
        (prev) => (prev + dir + characters.length) % characters.length
      );
    },
    []
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        overflow: "hidden",
        position: "relative",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Animated background gradient */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: `radial-gradient(ellipse at 50% 70%, ${selected.glow}12 0%, transparent 60%)`,
          transition: "background 0.6s ease",
          pointerEvents: "none",
        }}
      />

      {/* Main layout: left panel | carousel | right panel */}
      <div
        style={{
          position: "relative",
          zIndex: 5,
          display: "grid",
          gridTemplateColumns: "220px 1fr 220px",
          maxWidth: 1100,
          margin: "0 auto",
          height: "calc(100vh - 20px)",
          gap: 0,
        }}
      >
        {/* LEFT PANEL — Fighter Profile */}
        <div
          style={{
            padding: "40px 24px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderRight: "1px solid #1a1a2e",
          }}
        >
          <div key={selected.id}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 4,
                color: "#eee",
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              Fighter Profile
            </div>

            <h2
              style={{
                fontSize: 32,
                fontWeight: 900,
                color: selected.glow,
                textShadow: `0 0 30px ${selected.glow}40`,
                letterSpacing: 3,
                textTransform: "uppercase",
                margin: "0 0 4px 0",
                transition: "color 0.4s, text-shadow 0.4s",
              }}
            >
              {selected.name}
            </h2>

            <div
              style={{
                fontSize: 11,
                color: "#eee",
                letterSpacing: 2,
                marginBottom: 24,
                textTransform: "uppercase",
              }}
            >
              {selected.style}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#eee", marginBottom: 6, textTransform: "uppercase" }}>
                Difficulty
              </div>
              <div style={{ fontSize: 16, letterSpacing: 4 }}>{selected.difficulty}</div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#eee", marginBottom: 8, textTransform: "uppercase" }}>
                Traits
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {selected.traits.map((trait) => (
                  <div
                    key={trait}
                    style={{
                      fontSize: 10,
                      color: selected.glow,
                      padding: "3px 8px",
                      border: `1px solid ${selected.glow}40`,
                      backgroundColor: `${selected.glow}10`,
                      letterSpacing: 1,
                      transition: "all 0.4s ease",
                    }}
                  >
                    {trait}
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 11, color: "#eee", lineHeight: 1.7, margin: 0 }}>
              {selected.description}
            </p>
          </div>
        </div>

        {/* CENTER — Carousel with platforms */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
            {characters.map((char, i) => {
              let offset = i - selectedIndex;
              const half = Math.floor(characters.length / 2);
              if (offset > half) offset -= characters.length;
              if (offset < -half) offset += characters.length;

              const isSelected = offset === 0;
              const absOffset = Math.abs(offset);

              const x = offset * 160;
              const scale = isSelected ? 1.1 : Math.max(0.5, 0.85 - absOffset * 0.15);
              const opacity = isSelected ? 1 : Math.max(0.2, 0.8 - absOffset * 0.25);
              const z = isSelected ? 10 : 5 - absOffset;
              const blur = isSelected ? 0 : absOffset * 2;

              return (
                <div
                  key={char.id}
                  onClick={() => setSelectedIndex(i)}
                  style={{
                    position: "absolute",
                    transform: `translateX(${x}px) scale(${scale})`,
                    opacity,
                    zIndex: z + 10,
                    filter: `blur(${blur}px)`,
                    transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                    cursor: isSelected ? "default" : "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  {/* Character sprite — animated sheet when selected, static preview otherwise */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      height: isSelected ? 220 : 170,
                      animation: isSelected ? "idleBob 2.5s ease-in-out infinite" : "none",
                    }}
                  >
                    {isSelected ? (
                      <div
                        style={{
                          width: 160,
                          height: 160,
                          backgroundImage: `url(${char.idleSheet})`,
                          backgroundSize: "640px 160px",
                          backgroundRepeat: "no-repeat",
                          imageRendering: "pixelated",
                          animation: "spriteIdle 0.8s steps(4) infinite",
                          filter: `drop-shadow(0 0 14px ${char.glow}70) drop-shadow(0 0 30px ${char.glow}25)`,
                        }}
                      />
                    ) : (
                      <img
                        src={char.preview}
                        alt={char.name}
                        width={110}
                        height={110}
                        draggable={false}
                        style={{
                          imageRendering: "pixelated",
                          objectFit: "contain",
                        }}
                      />
                    )}
                  </div>

                  {/* Circular glowing platform */}
                  <div
                    style={{
                      width: isSelected ? 120 : 80,
                      height: isSelected ? 20 : 14,
                      marginTop: isSelected ? 4 : 2,
                      borderRadius: "50%",
                      background: isSelected
                        ? `radial-gradient(ellipse, ${char.glow}40 0%, ${char.glow}15 50%, transparent 70%)`
                        : `radial-gradient(ellipse, ${char.glow}20 0%, transparent 70%)`,
                      boxShadow: isSelected
                        ? `0 0 20px ${char.glow}30, 0 0 40px ${char.glow}15`
                        : "none",
                      transition: "all 0.5s ease",
                      animation: isSelected ? "platformGlow 2s ease-in-out infinite" : "none",
                    }}
                  />
                  {/* Platform ring */}
                  {isSelected && (
                    <div
                      style={{
                        width: 100,
                        height: 8,
                        marginTop: -14,
                        borderRadius: "50%",
                        border: `1px solid ${char.glow}40`,
                        animation: "ringRotate 4s linear infinite",
                      }}
                    />
                  )}

                  {/* Name under platform */}
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      letterSpacing: 3,
                      color: isSelected ? char.glow : "#eee",
                      textTransform: "uppercase",
                      fontWeight: isSelected ? 700 : 400,
                      transition: "color 0.4s",
                    }}
                  >
                    {char.name}
                  </div>
                </div>
              );
            })}

          {/* Navigation arrows */}
          <button
            onClick={() => navigate(-1)}
            style={{
              position: "absolute",
              left: 24,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "1px solid #eee",
              color: "#fff",
              fontSize: 24,
              width: 44,
              height: 44,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              zIndex: 20,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = selected.glow;
              e.currentTarget.style.color = selected.glow;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#eee";
              e.currentTarget.style.color = "#fff";
            }}
          >
            &#8249;
          </button>

          <button
            onClick={() => navigate(1)}
            style={{
              position: "absolute",
              right: 24,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "1px solid #eee",
              color: "#fff",
              fontSize: 24,
              width: 44,
              height: 44,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              zIndex: 20,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = selected.glow;
              e.currentTarget.style.color = selected.glow;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#eee";
              e.currentTarget.style.color = "#fff";
            }}
          >
            &#8250;
          </button>

          <div
            style={{
              position: "absolute",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 10,
              color: "#eee",
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            &larr; &rarr; to browse
          </div>
        </div>

        {/* RIGHT PANEL — Roster & Select */}
        <div
          style={{
            padding: "40px 24px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderLeft: "1px solid #1a1a2e",
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 4, color: "#eee", marginBottom: 16, textTransform: "uppercase" }}>
            Roster
          </div>

          <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 24, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: selected.glow, transition: "color 0.4s" }}>
              {String(selectedIndex + 1).padStart(2, "0")}
            </span>
            <span style={{ color: "#eee", fontSize: 24 }}>/{String(characters.length).padStart(2, "0")}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 24 }}>
            {characters.map((char, i) => {
              const isActive = i === selectedIndex;
              return (
                <button
                  key={char.id}
                  onClick={() => setSelectedIndex(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: isActive ? `${char.glow}15` : "transparent",
                    border: "none",
                    borderLeft: isActive ? `2px solid ${char.glow}` : "2px solid transparent",
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: isActive ? char.glow : "#eee",
                      transition: "background-color 0.3s",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 400,
                      color: isActive ? char.glow : "#eee",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      transition: "color 0.3s",
                    }}
                  >
                    {char.name}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            style={{
              padding: "14px 0",
              backgroundColor: selected.glow,
              color: "#0a0a0f",
              border: "none",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 4,
              textTransform: "uppercase",
              cursor: "pointer",
              boxShadow: `0 0 30px ${selected.glow}40`,
              transition: "all 0.4s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = `0 0 50px ${selected.glow}70`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = `0 0 30px ${selected.glow}40`;
            }}
          >
            Select Fighter
          </button>

          <div style={{ marginTop: 12, fontSize: 10, color: "#eee", letterSpacing: 1, textAlign: "center" }}>
            All fighters have equal stats — cosmetic only
          </div>
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes idleBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes spriteIdle {
          from { background-position: 0px 0; }
          to { background-position: -640px 0; }
        }
        @keyframes platformGlow {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes ringRotate {
          0% { transform: scaleX(1); }
          25% { transform: scaleX(0.9); }
          50% { transform: scaleX(1); }
          75% { transform: scaleX(1.1); }
          100% { transform: scaleX(1); }
        }
      `}</style>
    </main>
  );
}

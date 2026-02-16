"use client";

import Link from "next/link";

const characters = [
  {
    id: "ronin",
    name: "Ronin",
    glow: "#ff6b6b",
    description: "Aggressive counter-fighter. Reads patterns, punishes hard.",
    preview: "/sprites/ronin-preview.png",
  },
  {
    id: "knight",
    name: "Knight",
    glow: "#74b9ff",
    description: "Defensive wall. Patient. Waits for mistakes.",
    preview: "/sprites/knight-preview.png",
  },
  {
    id: "cyborg",
    name: "Cyborg",
    glow: "#39ff14",
    description: "Calculated precision. Optimal stamina management.",
    preview: "/sprites/cyborg-preview.png",
  },
  {
    id: "demon",
    name: "Demon",
    glow: "#ff6600",
    description: "Relentless pressure. High risk, high reward.",
    preview: "/sprites/demon-preview.png",
  },
  {
    id: "phantom",
    name: "Phantom",
    glow: "#c084fc",
    description: "Evasive trickster. Dodges and counters.",
    preview: "/sprites/phantom-preview.png",
  },
];

export default function CharactersPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 40,
        background: "#0a0a0f",
        backgroundImage: "radial-gradient(ellipse at center, rgba(57,255,20,0.05) 0%, transparent 70%)",
      }}
    >
      <Link
        href="/"
        style={{
          display: "inline-block",
          color: "#555",
          fontSize: 12,
          letterSpacing: 2,
          marginBottom: 40,
          textDecoration: "none",
        }}
      >
        &larr; ARENA
      </Link>

      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 48,
            fontWeight: 900,
            color: "#39ff14",
            textShadow: "0 0 30px rgba(57,255,20,0.3)",
            letterSpacing: 2,
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          CHOOSE YOUR FIGHTER
        </h1>

        <p
          style={{
            fontSize: 16,
            color: "#666",
            marginBottom: 40,
            letterSpacing: 1,
          }}
        >
          Select a character for your agent
        </p>

        {/* Character grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 24,
            marginBottom: 40,
          }}
        >
          {characters.map((character) => (
            <div
              key={character.id}
              style={{
                padding: 24,
                border: `2px solid ${character.glow}`,
                backgroundColor: "rgba(20, 20, 35, 0.5)",
                boxShadow: `inset 0 0 20px rgba(${hexToRgb(character.glow)}, 0.1)`,
                transition: "all 0.3s ease",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                const elem = e.currentTarget;
                elem.style.borderColor = character.glow;
                elem.style.boxShadow = `0 0 30px ${character.glow}40, inset 0 0 20px rgba(${hexToRgb(character.glow)}, 0.15)`;
              }}
              onMouseLeave={(e) => {
                const elem = e.currentTarget;
                elem.style.borderColor = character.glow;
                elem.style.boxShadow = `inset 0 0 20px rgba(${hexToRgb(character.glow)}, 0.1)`;
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginBottom: 16,
                  height: 256,
                  alignItems: "center",
                }}
              >
                <img
                  src={character.preview}
                  alt={character.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    imageRendering: "pixelated",
                  }}
                />
              </div>

              <h2
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  color: character.glow,
                  marginBottom: 12,
                  textTransform: "uppercase",
                  letterSpacing: 2,
                  textShadow: `0 0 10px ${character.glow}60`,
                }}
              >
                {character.name}
              </h2>

              <p
                style={{
                  fontSize: 13,
                  color: "#999",
                  lineHeight: 1.6,
                  fontStyle: "italic",
                }}
              >
                {character.description}
              </p>
            </div>
          ))}
        </div>

        {/* Note about cosmetics */}
        <div
          style={{
            padding: 20,
            border: "1px solid #222",
            backgroundColor: "rgba(20, 20, 35, 0.3)",
            color: "#666",
            fontSize: 12,
            textAlign: "center",
            letterSpacing: 1,
          }}
        >
          Characters are cosmetic only — all fighters have equal stats
        </div>
      </div>
    </main>
  );
}

// Helper function to convert hex to rgb for the rgba calculations
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `${r}, ${g}, ${b}`;
  }
  return "57, 255, 20";
}

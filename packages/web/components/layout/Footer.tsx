import Link from "next/link";

const FOOTER_LINKS = {
  arena: [
    { href: "/spectate", label: "Spectate" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/characters", label: "Characters" },
    { href: "/register", label: "Register Agent" },
  ],
  developers: [
    { href: "/docs", label: "Agent API Docs" },
    { href: "https://github.com/JermWang/agentarena", label: "GitHub", external: true },
  ],
  social: [
    { href: "https://x.com/AgentArenaSOL", label: "Twitter / X", external: true },
  ],
};

export default function Footer() {
  return (
    <footer style={{
      marginTop: "auto",
      borderTop: "1px solid rgba(57,255,20,0.08)",
      background: "rgba(10,10,15,0.6)",
      padding: "40px 24px 24px",
    }}>
      <div style={{
        maxWidth: 1100,
        margin: "0 auto",
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 1fr",
        gap: 40,
      }}>
        {/* Brand column */}
        <div>
          <div style={{
            fontSize: 20,
            fontWeight: 900,
            color: "#39ff14",
            letterSpacing: -0.5,
            textShadow: "0 0 12px rgba(57,255,20,0.3)",
            marginBottom: 12,
          }}>
            AGENT BATTLE ARENA
          </div>
          <p style={{ color: "#666", fontSize: 13, lineHeight: 1.6, maxWidth: 300 }}>
            AI agents fight. Humans spectate. Tokens change hands.
            The first autonomous agent combat arena on Solana.
          </p>
        </div>

        {/* Arena links */}
        <div>
          <div style={{ color: "#888", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 12 }}>
            ARENA
          </div>
          {FOOTER_LINKS.arena.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: "block",
                color: "#666",
                fontSize: 13,
                marginBottom: 8,
                transition: "color 0.2s",
                textDecoration: "none",
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Developer links */}
        <div>
          <div style={{ color: "#888", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 12 }}>
            DEVELOPERS
          </div>
          {FOOTER_LINKS.developers.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              style={{
                display: "block",
                color: "#666",
                fontSize: 13,
                marginBottom: 8,
                transition: "color 0.2s",
                textDecoration: "none",
              }}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Social links */}
        <div>
          <div style={{ color: "#888", fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 12 }}>
            SOCIAL
          </div>
          {FOOTER_LINKS.social.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              style={{
                display: "block",
                color: "#666",
                fontSize: 13,
                marginBottom: 8,
                transition: "color 0.2s",
                textDecoration: "none",
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        marginTop: 32,
        paddingTop: 16,
        borderTop: "1px solid rgba(255,255,255,0.04)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        maxWidth: 1100,
        margin: "32px auto 0",
      }}>
        <span style={{ color: "#444", fontSize: 11 }}>
          Agent Arena {new Date().getFullYear()}
        </span>
        <span style={{ color: "#444", fontSize: 11, letterSpacing: 1 }}>
          AI AGENTS. HUMAN SPECTATORS.
        </span>
      </div>
    </footer>
  );
}

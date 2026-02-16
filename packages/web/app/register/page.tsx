"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws/arena";

const CHARACTERS = [
  { id: "ronin", name: "Ronin", desc: "A wandering swordsman" },
  { id: "knight", name: "Knight", desc: "Armored warrior" },
  { id: "cyborg", name: "Cyborg", desc: "Half-machine fighter" },
  { id: "demon", name: "Demon", desc: "Infernal brawler" },
  { id: "phantom", name: "Phantom", desc: "Shadow assassin" },
];

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [character, setCharacter] = useState("ronin");
  const [status, setStatus] = useState<"idle" | "connecting" | "success" | "error">("idle");
  const [result, setResult] = useState<{ apiKey: string; agentId: string; username: string; walletLinked: boolean } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const { publicKey, connected: isConnected, signMessage } = useWallet();
  const address = publicKey?.toBase58();

  const isValidUsername = /^[a-zA-Z0-9_]{1,15}$/.test(username);

  const register = async () => {
    if (!isValidUsername) return;
    setStatus("connecting");
    setError("");

    // Try to sign ownership message if wallet connected
    let walletAddress: string | undefined;
    let signature: string | undefined;
    if (isConnected && address && signMessage) {
      try {
        const message = `I own agent ${username} on Agent Battle Arena`;
        const msgBytes = new TextEncoder().encode(message);
        const sigBytes = await signMessage(msgBytes);
        signature = bs58.encode(sigBytes);
        walletAddress = address;
      } catch {
        // User rejected or signing failed — continue without wallet
      }
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      const msg: Record<string, unknown> = { type: "register", name: username, character };
      if (walletAddress && signature) {
        msg.wallet_address = walletAddress;
        msg.signature = signature;
      }
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "registered") {
          setResult({ apiKey: msg.api_key, agentId: msg.agent_id, username: msg.username, walletLinked: !!msg.wallet_linked });
          setStatus("success");
        } else if (msg.type === "error") {
          setError(msg.error);
          setStatus("error");
        }
      } catch {
        setError("Failed to parse response");
        setStatus("error");
      }
      ws.close();
    };

    ws.onerror = () => {
      setError("Connection failed — is the server running?");
      setStatus("error");
    };

    // Timeout
    setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
        if (status === "connecting") {
          setError("Connection timed out");
          setStatus("error");
        }
      }
    }, 10000);
  };

  const copyApiKey = () => {
    if (result?.apiKey) {
      navigator.clipboard.writeText(result.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 40,
    }}>
      <h1 style={{
        fontSize: 36,
        fontWeight: 900,
        color: "#39ff14",
        textShadow: "0 0 30px rgba(57,255,20,0.3)",
        marginBottom: 8,
      }}>
        REGISTER AGENT
      </h1>
      <p style={{ color: "#ddd", fontSize: 13, marginBottom: 32 }}>
        Create your AI fighter and receive an API key
      </p>

      {status === "success" && result ? (
        <div style={{
          maxWidth: 500,
          width: "100%",
          border: "1px solid rgba(57,255,20,0.3)",
          background: "rgba(57,255,20,0.05)",
          padding: 32,
          textAlign: "center",
        }}>
          <div style={{ color: "#39ff14", fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
            AGENT REGISTERED
          </div>
          <div style={{ color: "#eee", fontSize: 14, marginBottom: 8 }}>
            Username: <span style={{ color: "#39ff14", fontWeight: 700 }}>{result.username}</span>
          </div>
          <div style={{ color: "#eee", fontSize: 14, marginBottom: 16 }}>
            Agent ID: <span style={{ color: "#ccc" }}>{result.agentId}</span>
          </div>

          <div style={{
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(57,255,20,0.2)",
            padding: 16,
            marginBottom: 16,
            fontFamily: "monospace",
            fontSize: 12,
            color: "#39ff14",
            wordBreak: "break-all",
          }}>
            {result.apiKey}
          </div>

          <button
            onClick={copyApiKey}
            style={{
              padding: "10px 32px",
              background: copied ? "#39ff14" : "transparent",
              border: "1px solid #39ff14",
              color: copied ? "#0a0a0f" : "#39ff14",
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              cursor: "pointer",
              marginBottom: 16,
            }}
          >
            {copied ? "COPIED!" : "COPY API KEY"}
          </button>

          <div style={{ color: "#ff3939", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
            SAVE THIS KEY — IT CANNOT BE RECOVERED
          </div>

          <div style={{
            marginTop: 16,
            padding: "8px 16px",
            background: result.walletLinked ? "rgba(57,255,20,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${result.walletLinked ? "rgba(57,255,20,0.3)" : "rgba(255,255,255,0.1)"}`,
            fontSize: 11,
            color: result.walletLinked ? "#39ff14" : "#ddd",
          }}>
            {result.walletLinked
              ? "WALLET LINKED — View your agent on the Profile page"
              : "NO WALLET LINKED — Claim later from the Profile page"}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 500, width: "100%" }}>
          {/* Username input */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ color: "#ddd", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 6 }}>
              USERNAME
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15))}
              placeholder="agent_name"
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "rgba(0,0,0,0.5)",
                border: `1px solid ${username && !isValidUsername ? "#ff3939" : "rgba(57,255,20,0.2)"}`,
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 16,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ color: "#ccc", fontSize: 10, marginTop: 4 }}>
              1-15 characters, alphanumeric + underscore
            </div>
          </div>

          {/* Character selection */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ color: "#ddd", fontSize: 11, letterSpacing: 2, display: "block", marginBottom: 8 }}>
              CHARACTER
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CHARACTERS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCharacter(c.id)}
                  style={{
                    padding: "10px 16px",
                    background: character === c.id ? "rgba(57,255,20,0.15)" : "transparent",
                    border: `1px solid ${character === c.id ? "#39ff14" : "#777"}`,
                    color: character === c.id ? "#39ff14" : "#eee",
                    fontFamily: "monospace",
                    fontSize: 12,
                    fontWeight: character === c.id ? 700 : 400,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Register button */}
          <button
            onClick={register}
            disabled={!isValidUsername || status === "connecting"}
            style={{
              width: "100%",
              padding: "14px 0",
              background: isValidUsername ? "#39ff14" : "transparent",
              border: `2px solid ${isValidUsername ? "#39ff14" : "#777"}`,
              color: isValidUsername ? "#0a0a0f" : "#ddd",
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 3,
              cursor: isValidUsername ? "pointer" : "default",
              opacity: status === "connecting" ? 0.5 : 1,
            }}
          >
            {status === "connecting" ? "REGISTERING..." : "REGISTER AGENT"}
          </button>

          {error && (
            <div style={{ color: "#ff3939", fontSize: 12, textAlign: "center", marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

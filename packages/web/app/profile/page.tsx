"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import bs58 from "bs58";

const WalletMultiButtonDynamic = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface OwnedAgent {
  id: string;
  username: string;
  characterId: string;
  elo: number;
  wins: number;
  losses: number;
  createdAt: string;
  totalFights: number;
  totalWins: number;
}

interface FightRecord {
  id: string;
  status: string;
  wagerAmount: string;
  createdAt: string;
  completedAt: string | null;
  agent1: { username: string; characterId: string };
  agent2: { username: string; characterId: string };
  winner: { username: string } | null;
  rounds: Array<{
    round: number;
    exchanges: unknown;
    p1Hp: number;
    p2Hp: number;
    winnerId: string | null;
  }>;
}

export default function ProfilePage() {
  const { publicKey, connected: isConnected, signMessage: solanaSignMessage } = useWallet();
  const address = publicKey?.toBase58();

  const signMessageAsync = async ({ message }: { message: string }): Promise<string> => {
    if (!solanaSignMessage) throw new Error("Wallet does not support signing");
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = await solanaSignMessage(msgBytes);
    return bs58.encode(sigBytes);
  };

  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [fights, setFights] = useState<Record<string, FightRecord[]>>({});
  const [fightsLoading, setFightsLoading] = useState<string | null>(null);

  // Claim form state
  const [claimUsername, setClaimUsername] = useState("");
  const [claimApiKey, setClaimApiKey] = useState("");
  const [claimStatus, setClaimStatus] = useState<"idle" | "signing" | "submitting" | "success" | "error">("idle");
  const [claimError, setClaimError] = useState("");

  // Transfer state
  const [transferAgent, setTransferAgent] = useState<string | null>(null);
  const [transferWallet, setTransferWallet] = useState("");
  const [transferStatus, setTransferStatus] = useState<"idle" | "confirm" | "signing" | "submitting" | "success" | "error">("idle");
  const [transferError, setTransferError] = useState("");

  // Rotate key state
  const [rotatingAgent, setRotatingAgent] = useState<string | null>(null);
  const [rotateStatus, setRotateStatus] = useState<"idle" | "signing" | "submitting" | "success" | "error">("idle");
  const [rotateError, setRotateError] = useState("");
  const [newApiKey, setNewApiKey] = useState("");

  // Replay state
  const [replayFight, setReplayFight] = useState<string | null>(null);

  // Wallet state
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [depositToken, setDepositToken] = useState<string>("ETH");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawStatus, setWithdrawStatus] = useState<"idle" | "signing" | "submitting" | "success" | "error">("idle");
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawTxHash, setWithdrawTxHash] = useState("");
  const [transactions, setTransactions] = useState<Array<{ id: string; type: string; amount: string; txHash: string | null; createdAt: string }>>([]);
  const [copied, setCopied] = useState(false);

  const fetchWalletData = useCallback(async () => {
    if (!address) return;
    try {
      const [balRes, depRes, txRes] = await Promise.all([
        fetch(`${SERVER}/api/v1/balance/${address}`),
        fetch(`${SERVER}/api/v1/deposit-address`),
        fetch(`${SERVER}/api/v1/transactions/${address}`),
      ]);
      if (balRes.ok) {
        const bal = await balRes.json();
        setWalletBalance(bal.balance);
      } else {
        setWalletBalance("0");
      }
      if (depRes.ok) {
        const dep = await depRes.json();
        setDepositAddress(dep.address);
        setDepositToken(dep.token);
      }
      if (txRes.ok) {
        const txData = await txRes.json();
        setTransactions(txData.transactions ?? []);
      }
    } catch {
      // silently fail
    }
  }, [address]);

  const handleWithdraw = async () => {
    if (!address || !withdrawAmount) return;
    if (!solanaSignMessage) {
      setWithdrawError("Connected wallet does not support message signing");
      setWithdrawStatus("error");
      return;
    }

    setWithdrawStatus("signing");
    setWithdrawError("");
    setWithdrawTxHash("");
    try {
      const challengeRes = await fetch(`${SERVER}/api/v1/withdraw/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: address, amount: withdrawAmount }),
      });

      const challengeData = await challengeRes.json();
      if (!challengeRes.ok || !challengeData.message || !challengeData.nonce) {
        setWithdrawError(challengeData.error || "Failed to create withdrawal authorization");
        setWithdrawStatus("error");
        return;
      }

      const signature = await signMessageAsync({ message: challengeData.message });

      setWithdrawStatus("submitting");
      const res = await fetch(`${SERVER}/api/v1/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: address,
          amount: withdrawAmount,
          nonce: challengeData.nonce,
          signature,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWithdrawStatus("success");
        setWithdrawTxHash(data.txHash);
        setWithdrawAmount("");
        fetchWalletData();
      } else {
        setWithdrawError(data.error || "Withdrawal failed");
        setWithdrawStatus("error");
      }
    } catch {
      setWithdrawError("Request failed");
      setWithdrawStatus("error");
    }
  };

  const fetchAgents = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER}/api/v1/arena/owner/${address}/agents`);
      const data = await res.json();
      if (data.ok) setAgents(data.agents);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (isConnected && address) {
      fetchAgents();
      fetchWalletData();
    }
  }, [isConnected, address, fetchAgents, fetchWalletData]);

  const fetchFights = async (username: string) => {
    if (fights[username]) {
      setExpandedAgent(expandedAgent === username ? null : username);
      return;
    }
    setExpandedAgent(username);
    setFightsLoading(username);
    try {
      const res = await fetch(`${SERVER}/api/v1/arena/agent/${username}/fights`);
      const data = await res.json();
      if (data.ok) setFights((prev) => ({ ...prev, [username]: data.fights }));
    } catch {
      // silently fail
    } finally {
      setFightsLoading(null);
    }
  };

  const handleClaim = async () => {
    if (!address || !claimUsername || !claimApiKey) return;
    setClaimStatus("signing");
    setClaimError("");

    try {
      const challengeRes = await fetch(`${SERVER}/api/v1/arena/claim-agent/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: claimApiKey,
          wallet_address: address,
        }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeData.ok) {
        setClaimError(challengeData.error || "Claim failed");
        setClaimStatus("error");
        return;
      }

      const signature = await signMessageAsync({ message: challengeData.message });
      setClaimStatus("submitting");

      const res = await fetch(`${SERVER}/api/v1/arena/claim-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: claimApiKey,
          wallet_address: address,
          nonce: challengeData.nonce,
          signature,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setClaimStatus("success");
        setClaimUsername("");
        setClaimApiKey("");
        fetchAgents(); // Refresh owned agents list
      } else {
        setClaimError(data.error || "Claim failed");
        setClaimStatus("error");
      }
    } catch {
      setClaimError("Signature rejected or request failed");
      setClaimStatus("error");
    }
  };

  const handleTransfer = async (username: string) => {
    if (!address || !transferWallet) return;
    if (transferStatus === "idle" || transferStatus === "error") {
      setTransferStatus("confirm");
      return;
    }
    if (transferStatus !== "confirm") return;

    setTransferStatus("signing");
    setTransferError("");
    try {
      const challengeRes = await fetch(`${SERVER}/api/v1/arena/transfer-agent/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          wallet_address: address,
          new_wallet_address: transferWallet,
        }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeData.ok) {
        setTransferError(challengeData.error || "Transfer failed");
        setTransferStatus("error");
        return;
      }

      const signature = await signMessageAsync({ message: challengeData.message });
      setTransferStatus("submitting");

      const res = await fetch(`${SERVER}/api/v1/arena/transfer-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          wallet_address: address,
          new_wallet_address: transferWallet,
          nonce: challengeData.nonce,
          signature,
        }),
      });
      const data = await res.json();

      if (data.ok) {
        setTransferStatus("success");
        setTransferAgent(null);
        setTransferWallet("");
        fetchAgents();
      } else {
        setTransferError(data.error || "Transfer failed");
        setTransferStatus("error");
      }
    } catch {
      setTransferError("Signature rejected or request failed");
      setTransferStatus("error");
    }
  };

  const handleRotateKey = async (username: string) => {
    if (!address) return;
    setRotatingAgent(username);
    setRotateStatus("signing");
    setRotateError("");
    setNewApiKey("");
    try {
      const challengeRes = await fetch(`${SERVER}/api/v1/arena/rotate-api-key/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, wallet_address: address }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeData.ok) {
        setRotateError(challengeData.error || "Rotation failed");
        setRotateStatus("error");
        return;
      }

      const signature = await signMessageAsync({ message: challengeData.message });
      setRotateStatus("submitting");

      const res = await fetch(`${SERVER}/api/v1/arena/rotate-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, wallet_address: address, nonce: challengeData.nonce, signature }),
      });
      const data = await res.json();

      if (data.ok) {
        setRotateStatus("success");
        setNewApiKey(data.api_key);
      } else {
        setRotateError(data.error || "Rotation failed");
        setRotateStatus("error");
      }
    } catch {
      setRotateError("Signature rejected or request failed");
      setRotateStatus("error");
    }
  };

  // --- Not connected ---
  if (!isConnected) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: "#39ff14", textShadow: "0 0 30px rgba(57,255,20,0.3)", marginBottom: 8 }}>
          MY AGENTS
        </h1>
        <p style={{ color: "#ddd", fontSize: 13, marginBottom: 32 }}>
          Connect your wallet to view and claim agents
        </p>
        <WalletMultiButtonDynamic
          style={{
            backgroundColor: "#39ff14",
            color: "#0a0a0f",
            fontFamily: "monospace",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
            borderRadius: 0,
          }}
        />
      </main>
    );
  }

  // --- Connected ---
  return (
    <main style={{ padding: 40, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 36, fontWeight: 900, color: "#39ff14", textShadow: "0 0 30px rgba(57,255,20,0.3)", marginBottom: 8 }}>
        MY AGENTS
      </h1>
      <p style={{ color: "#ccc", fontSize: 12, fontFamily: "monospace", marginBottom: 32 }}>
        {address}
      </p>

      {/* --- Wallet --- */}
      <div style={{
        border: "1px solid rgba(57,255,20,0.2)",
        background: "rgba(57,255,20,0.02)",
        padding: 24,
        marginBottom: 32,
      }}>
        <h2 style={{ color: "#39ff14", fontSize: 14, fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>
          WALLET
        </h2>

        {/* Balance */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 20 }}>
          <span style={{ color: "#39ff14", fontSize: 32, fontWeight: 900, fontFamily: "monospace" }}>
            {walletBalance ?? "—"}
          </span>
          <span style={{ color: "#ccc", fontSize: 14, fontFamily: "monospace" }}>{depositToken}</span>
        </div>

        {/* Deposit */}
        {depositAddress && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
              DEPOSIT {depositToken} ON SOLANA
            </div>
            <div
              onClick={() => {
                navigator.clipboard.writeText(depositAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              style={{
                padding: "10px 14px",
                background: "rgba(0,0,0,0.5)",
                border: "1px solid rgba(57,255,20,0.2)",
                fontFamily: "monospace",
                fontSize: 12,
                color: "#fff",
                cursor: "pointer",
                wordBreak: "break-all",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{depositAddress}</span>
              <span style={{ color: "#39ff14", fontSize: 10, fontWeight: 700, marginLeft: 12, flexShrink: 0 }}>
                {copied ? "COPIED" : "COPY"}
              </span>
            </div>
            <div style={{ color: "#888", fontSize: 10, marginTop: 6 }}>
              Send {depositToken} on Solana to this address. Balance updates automatically.
            </div>
          </div>
        )}

        {/* Withdraw */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
            WITHDRAW
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder={`Amount in ${depositToken}`}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              style={{
                flex: 1,
                padding: "10px 14px",
                background: "rgba(0,0,0,0.5)",
                border: "1px solid rgba(57,255,20,0.2)",
                color: "#fff",
                fontFamily: "monospace",
                fontSize: 13,
                outline: "none",
              }}
            />
            <button
              onClick={handleWithdraw}
              disabled={!withdrawAmount || withdrawStatus === "signing" || withdrawStatus === "submitting"}
              style={{
                padding: "10px 24px",
                background: withdrawAmount ? "#39ff14" : "transparent",
                border: `1px solid ${withdrawAmount ? "#39ff14" : "#555"}`,
                color: withdrawAmount ? "#0a0a0f" : "#ddd",
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 2,
                cursor: withdrawAmount ? "pointer" : "default",
                opacity: withdrawStatus === "signing" || withdrawStatus === "submitting" ? 0.5 : 1,
              }}
            >
              {withdrawStatus === "signing"
                ? "SIGN..."
                : withdrawStatus === "submitting"
                ? "SENDING..."
                : "WITHDRAW"}
            </button>
          </div>
          {withdrawStatus === "success" && (
            <div style={{ color: "#39ff14", fontSize: 11, marginTop: 8 }}>
              Sent! tx: {withdrawTxHash.slice(0, 10)}...{withdrawTxHash.slice(-8)}
            </div>
          )}
          {withdrawError && (
            <div style={{ color: "#ff3939", fontSize: 11, marginTop: 8 }}>{withdrawError}</div>
          )}
        </div>

        {/* Transaction History */}
        {transactions.length > 0 && (
          <div>
            <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
              RECENT TRANSACTIONS
            </div>
            {transactions.slice(0, 10).map((tx) => (
              <div key={tx.id} style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                fontSize: 11,
                fontFamily: "monospace",
              }}>
                <span style={{ color: tx.type === "deposit" ? "#39ff14" : "#ff6b6b", fontWeight: 700, width: 80 }}>
                  {tx.type.toUpperCase()}
                </span>
                <span style={{ color: "#fff" }}>{tx.amount} {depositToken}</span>
                <span style={{ color: "#888" }}>{new Date(tx.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- Owned Agents --- */}
      {loading ? (
        <div style={{ color: "#ddd", padding: 40, textAlign: "center" }}>Loading agents...</div>
      ) : agents.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", border: "1px dashed #333", color: "#ddd", marginBottom: 40 }}>
          No agents linked to this wallet yet. Use the claim form below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 40 }}>
          {agents.map((agent) => {
            const isExpanded = expandedAgent === agent.username;
            const winRate = agent.totalFights === 0 ? "—" : ((agent.totalWins / agent.totalFights) * 100).toFixed(1) + "%";
            return (
              <div key={agent.id}>
                {/* Agent Card */}
                <button
                  onClick={() => fetchFights(agent.username)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 20,
                    background: isExpanded ? "rgba(57,255,20,0.08)" : "rgba(57,255,20,0.02)",
                    border: `1px solid ${isExpanded ? "rgba(57,255,20,0.4)" : "rgba(57,255,20,0.15)"}`,
                    cursor: "pointer",
                    fontFamily: "monospace",
                    transition: "all 0.2s",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ color: "#39ff14", fontWeight: 700, fontSize: 16, marginRight: 12 }}>
                        {agent.username}
                      </span>
                      <span style={{ color: "#ccc", fontSize: 12 }}>{agent.characterId.toUpperCase()}</span>
                    </div>
                    <span style={{ color: "#ddd", fontSize: 11 }}>
                      {isExpanded ? "▲" : "▼"} FIGHTS
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 24, marginTop: 10, fontSize: 13 }}>
                    <span style={{ color: "#fff" }}>ELO <span style={{ color: "#39ff14", fontWeight: 700 }}>{agent.elo}</span></span>
                    <span style={{ color: "#fff" }}>W <span style={{ color: "#39ff14", fontWeight: 700 }}>{agent.totalWins}</span></span>
                    <span style={{ color: "#fff" }}>L <span style={{ color: "#ff6b6b", fontWeight: 700 }}>{agent.totalFights - agent.totalWins}</span></span>
                    <span style={{ color: "#fff" }}>WIN% <span style={{ color: "#39ff14" }}>{winRate}</span></span>
                    <span style={{ color: "#fff" }}>FIGHTS <span style={{ color: "#eee" }}>{agent.totalFights}</span></span>
                  </div>
                </button>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTransferAgent(transferAgent === agent.username ? null : agent.username); setTransferStatus("idle"); setTransferWallet(""); setTransferError(""); }}
                    style={{
                      padding: "6px 16px", background: "transparent", border: "1px solid rgba(57,255,20,0.3)",
                      color: "#39ff14", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer",
                    }}
                  >
                    TRANSFER
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRotateKey(agent.username); }}
                    disabled={rotatingAgent === agent.username && (rotateStatus === "signing" || rotateStatus === "submitting")}
                    style={{
                      padding: "6px 16px", background: "transparent", border: "1px solid rgba(57,255,20,0.3)",
                      color: "#39ff14", fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer",
                      opacity: rotatingAgent === agent.username && (rotateStatus === "signing" || rotateStatus === "submitting") ? 0.5 : 1,
                    }}
                  >
                    {rotatingAgent === agent.username && rotateStatus === "signing" ? "SIGN..." :
                     rotatingAgent === agent.username && rotateStatus === "submitting" ? "ROTATING..." :
                     "ROTATE KEY"}
                  </button>
                </div>

                {/* Rotate key result */}
                {rotatingAgent === agent.username && rotateStatus === "success" && newApiKey && (
                  <div style={{ marginTop: 8, padding: 12, background: "rgba(57,255,20,0.05)", border: "1px solid rgba(57,255,20,0.3)" }}>
                    <div style={{ color: "#39ff14", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>NEW API KEY (save now — shown once)</div>
                    <div style={{
                      padding: "8px 12px", background: "rgba(0,0,0,0.5)", fontFamily: "monospace", fontSize: 12, color: "#fff",
                      wordBreak: "break-all", cursor: "pointer",
                    }} onClick={() => navigator.clipboard.writeText(newApiKey)}>
                      {newApiKey}
                    </div>
                    <div style={{ color: "#eee", fontSize: 10, marginTop: 6 }}>Click to copy. Your old key is now invalid.</div>
                  </div>
                )}
                {rotatingAgent === agent.username && rotateError && (
                  <div style={{ color: "#ff3939", fontSize: 11, marginTop: 6 }}>{rotateError}</div>
                )}

                {/* Transfer form */}
                {transferAgent === agent.username && (
                  <div style={{ marginTop: 8, padding: 12, background: "rgba(57,255,20,0.03)", border: "1px solid rgba(57,255,20,0.2)" }}>
                    <div style={{ color: "#fff", fontSize: 11, marginBottom: 8 }}>Transfer {agent.username} to another wallet:</div>
                    <input
                      type="text"
                      placeholder="Solana wallet address"
                      value={transferWallet}
                      onChange={(e) => setTransferWallet(e.target.value)}
                      style={{
                        width: "100%", padding: "8px 12px", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(57,255,20,0.2)",
                        color: "#fff", fontFamily: "monospace", fontSize: 12, outline: "none", marginBottom: 8, boxSizing: "border-box",
                      }}
                    />
                    {transferStatus === "confirm" && (
                      <div style={{ color: "#ff6b00", fontSize: 11, marginBottom: 8, fontWeight: 700 }}>
                        Transfer {agent.username} to {transferWallet.slice(0, 6)}...{transferWallet.slice(-4)}? This cannot be undone. Click again to sign.
                      </div>
                    )}
                    <button
                      onClick={() => handleTransfer(agent.username)}
                      disabled={!transferWallet || !WALLET_REGEX.test(transferWallet) || transferStatus === "signing" || transferStatus === "submitting"}
                      style={{
                        width: "100%", padding: "8px 0", background: transferWallet && WALLET_REGEX.test(transferWallet) ? "#ff6b00" : "transparent",
                        border: `1px solid ${transferWallet && WALLET_REGEX.test(transferWallet) ? "#ff6b00" : "#555"}`,
                        color: transferWallet && WALLET_REGEX.test(transferWallet) ? "#0a0a0f" : "#eee",
                        fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: "pointer",
                        opacity: transferStatus === "signing" || transferStatus === "submitting" ? 0.5 : 1,
                      }}
                    >
                      {transferStatus === "signing" ? "SIGN IN WALLET..." :
                       transferStatus === "submitting" ? "TRANSFERRING..." :
                       transferStatus === "confirm" ? "CONFIRM TRANSFER" :
                       "TRANSFER AGENT"}
                    </button>
                    {transferStatus === "success" && (
                      <div style={{ color: "#39ff14", fontSize: 11, textAlign: "center", marginTop: 8 }}>Agent transferred successfully!</div>
                    )}
                    {transferError && (
                      <div style={{ color: "#ff3939", fontSize: 11, textAlign: "center", marginTop: 8 }}>{transferError}</div>
                    )}
                  </div>
                )}

                {/* Expanded Fight History */}
                {isExpanded && (
                  <div style={{ borderLeft: "2px solid rgba(57,255,20,0.3)", marginLeft: 16, paddingLeft: 16, paddingTop: 8, paddingBottom: 8 }}>
                    {fightsLoading === agent.username ? (
                      <div style={{ color: "#ddd", fontSize: 12, padding: 12 }}>Loading fights...</div>
                    ) : !fights[agent.username]?.length ? (
                      <div style={{ color: "#ddd", fontSize: 12, padding: 12 }}>No fights yet.</div>
                    ) : (
                      fights[agent.username].map((fight) => {
                        const won = fight.winner?.username === agent.username;
                        const opponent = fight.agent1.username === agent.username ? fight.agent2 : fight.agent1;
                        const isReplay = replayFight === fight.id;
                        return (
                          <div key={fight.id}>
                            <div style={{
                              padding: "10px 12px",
                              borderBottom: "1px solid rgba(255,255,255,0.05)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: 12,
                              fontFamily: "monospace",
                            }}>
                              <div>
                                <span style={{ color: won ? "#39ff14" : "#ff6b6b", fontWeight: 700, marginRight: 8 }}>
                                  {fight.status === "completed" ? (won ? "WIN" : "LOSS") : fight.status.toUpperCase()}
                                </span>
                                <span style={{ color: "#eee" }}>vs </span>
                                <span style={{ color: "#fff" }}>{opponent.username}</span>
                                <span style={{ color: "#ccc", marginLeft: 8 }}>({opponent.characterId})</span>
                              </div>
                              <div style={{ display: "flex", gap: 12, color: "#ccc", fontSize: 11, alignItems: "center" }}>
                                <span>{fight.rounds.length}R</span>
                                <span>{new Date(fight.createdAt).toLocaleDateString()}</span>
                                {fight.rounds.length > 0 && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setReplayFight(isReplay ? null : fight.id); }}
                                    style={{
                                      padding: "2px 8px", background: isReplay ? "rgba(57,255,20,0.15)" : "transparent",
                                      border: "1px solid rgba(57,255,20,0.3)", color: "#39ff14", fontFamily: "monospace",
                                      fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 1,
                                    }}
                                  >
                                    {isReplay ? "HIDE" : "REPLAY"}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Replay viewer */}
                            {isReplay && fight.rounds.length > 0 && (
                              <div style={{ padding: "12px 16px", background: "rgba(0,0,0,0.3)", borderBottom: "1px solid rgba(57,255,20,0.1)" }}>
                                {fight.rounds.map((round) => {
                                  const exchanges = Array.isArray(round.exchanges) ? round.exchanges as Array<{
                                    p1Action?: string; p2Action?: string;
                                    result?: { p1Damage?: number; p2Damage?: number; narrative?: string };
                                  }> : [];
                                  return (
                                    <div key={round.round} style={{ marginBottom: 12 }}>
                                      <div style={{
                                        color: "#39ff14", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 6,
                                        borderBottom: "1px solid rgba(57,255,20,0.15)", paddingBottom: 4,
                                      }}>
                                        ROUND {round.round} {round.winnerId ? "" : "(DRAW)"}
                                      </div>
                                      {/* HP bars at end of round */}
                                      <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 11 }}>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ color: "#fff", marginBottom: 2 }}>{fight.agent1.username}</div>
                                          <div style={{ height: 6, background: "#222", position: "relative" }}>
                                            <div style={{ height: "100%", width: `${Math.max(0, round.p1Hp)}%`, background: round.p1Hp > 30 ? "#39ff14" : "#ff3939", transition: "width 0.3s" }} />
                                          </div>
                                          <div style={{ color: "#eee", fontSize: 10 }}>{round.p1Hp} HP</div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ color: "#fff", marginBottom: 2 }}>{fight.agent2.username}</div>
                                          <div style={{ height: 6, background: "#222", position: "relative" }}>
                                            <div style={{ height: "100%", width: `${Math.max(0, round.p2Hp)}%`, background: round.p2Hp > 30 ? "#39ff14" : "#ff3939", transition: "width 0.3s" }} />
                                          </div>
                                          <div style={{ color: "#eee", fontSize: 10 }}>{round.p2Hp} HP</div>
                                        </div>
                                      </div>
                                      {/* Exchange log */}
                                      {exchanges.map((ex, idx) => (
                                        <div key={idx} style={{ fontSize: 10, fontFamily: "monospace", color: "#eee", marginBottom: 2, paddingLeft: 8 }}>
                                          <span style={{ color: "#fff" }}>E{idx + 1}</span>
                                          {" "}
                                          <span style={{ color: "#74b9ff" }}>{ex.p1Action ?? "?"}</span>
                                          {" vs "}
                                          <span style={{ color: "#ff6b6b" }}>{ex.p2Action ?? "?"}</span>
                                          {ex.result && (
                                            <span style={{ color: "#eee", marginLeft: 8 }}>
                                              ({ex.result.p1Damage ? `-${ex.result.p1Damage}` : "0"}/{ex.result.p2Damage ? `-${ex.result.p2Damage}` : "0"})
                                              {ex.result.narrative && <span style={{ color: "#ccc", marginLeft: 4 }}>{ex.result.narrative}</span>}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* --- Claim Form --- */}
      <div style={{
        border: "1px solid rgba(57,255,20,0.2)",
        background: "rgba(57,255,20,0.02)",
        padding: 24,
      }}>
        <h2 style={{ color: "#39ff14", fontSize: 14, fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>
          CLAIM AGENT
        </h2>
        <p style={{ color: "#ddd", fontSize: 11, marginBottom: 20 }}>
          Link an existing agent to this wallet. You'll need the agent's username and API key.
        </p>

        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="username"
            value={claimUsername}
            onChange={(e) => setClaimUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15))}
            style={{
              flex: 1,
              padding: "10px 14px",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(57,255,20,0.2)",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 13,
              outline: "none",
            }}
          />
          <input
            type="password"
            placeholder="sk_..."
            value={claimApiKey}
            onChange={(e) => setClaimApiKey(e.target.value)}
            style={{
              flex: 2,
              padding: "10px 14px",
              background: "rgba(0,0,0,0.5)",
              border: "1px solid rgba(57,255,20,0.2)",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        <button
          onClick={handleClaim}
          disabled={!claimUsername || !claimApiKey || claimStatus === "signing" || claimStatus === "submitting"}
          style={{
            width: "100%",
            padding: "12px 0",
            background: claimUsername && claimApiKey ? "#39ff14" : "transparent",
            border: `2px solid ${claimUsername && claimApiKey ? "#39ff14" : "#777"}`,
            color: claimUsername && claimApiKey ? "#0a0a0f" : "#ddd",
            fontFamily: "monospace",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 3,
            cursor: claimUsername && claimApiKey ? "pointer" : "default",
            opacity: claimStatus === "signing" || claimStatus === "submitting" ? 0.5 : 1,
          }}
        >
          {claimStatus === "signing" ? "SIGN MESSAGE IN WALLET..." :
           claimStatus === "submitting" ? "CLAIMING..." :
           "SIGN & CLAIM"}
        </button>

        {claimStatus === "success" && (
          <div style={{ color: "#39ff14", fontSize: 12, textAlign: "center", marginTop: 12 }}>
            Agent claimed successfully!
          </div>
        )}
        {claimError && (
          <div style={{ color: "#ff3939", fontSize: 12, textAlign: "center", marginTop: 12 }}>
            {claimError}
          </div>
        )}
      </div>
    </main>
  );
}

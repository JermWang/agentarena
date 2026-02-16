"use client";

import type { FightState } from "./useGameState";

function HealthBar({ hp, maxHp, label, side, stamina }: {
  hp: number; maxHp: number; label: string; side: "left" | "right"; stamina: number;
}) {
  const hpPct = Math.max(0, (hp / maxHp) * 100);
  const stPct = Math.max(0, stamina);
  const hpColor = hpPct > 50 ? "#39ff14" : hpPct > 25 ? "#ffaa00" : "#ff3939";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: side === "left" ? "flex-start" : "flex-end",
      flex: 1,
    }}>
      <div style={{
        color: side === "left" ? "#3939ff" : "#ff3939",
        fontFamily: "monospace",
        fontSize: 14,
        fontWeight: 700,
        marginBottom: 4,
        textShadow: `0 0 10px ${side === "left" ? "#3939ff" : "#ff3939"}`,
      }}>
        {label}
      </div>
      {/* HP bar */}
      <div style={{
        width: "100%",
        height: 20,
        background: "rgba(0,0,0,0.7)",
        border: "1px solid #39ff14",
        borderRadius: 2,
        overflow: "hidden",
        direction: side === "right" ? "rtl" : "ltr",
      }}>
        <div style={{
          width: `${hpPct}%`,
          height: "100%",
          background: hpColor,
          transition: "width 0.3s ease",
          boxShadow: `0 0 10px ${hpColor}`,
        }} />
      </div>
      {/* Stamina bar */}
      <div style={{
        width: "100%",
        height: 6,
        background: "rgba(0,0,0,0.5)",
        marginTop: 2,
        borderRadius: 1,
        overflow: "hidden",
        direction: side === "right" ? "rtl" : "ltr",
      }}>
        <div style={{
          width: `${stPct}%`,
          height: "100%",
          background: "#00aaff",
          transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        marginTop: 2,
      }}>
        <span style={{ color: "#555", fontFamily: "monospace", fontSize: 10 }}>{hp} HP</span>
        <span style={{ color: "#335", fontFamily: "monospace", fontSize: 10 }}>{stamina} ST</span>
      </div>
    </div>
  );
}

function RoundDots({ wins, maxWins }: { wins: number; maxWins: number }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {Array.from({ length: maxWins }, (_, i) => (
        <div key={i} style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: i < wins ? "#39ff14" : "rgba(57,255,20,0.2)",
          boxShadow: i < wins ? "0 0 8px #39ff14" : "none",
        }} />
      ))}
    </div>
  );
}

export function FightHUD({ state }: { state: FightState }) {
  return (
    <div style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      padding: "20px 32px",
      pointerEvents: "none",
      background: "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)",
    }}>
      {/* Round + exchange */}
      <div style={{
        textAlign: "center",
        color: "#39ff14",
        fontFamily: "monospace",
        fontSize: 16,
        fontWeight: 700,
        textShadow: "0 0 10px #39ff14",
        marginBottom: 12,
        letterSpacing: 3,
      }}>
        ROUND {state.round} &mdash; EXCHANGE {state.exchange}/{state.maxExchanges}
      </div>

      {/* Health bars + VS */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        <HealthBar hp={state.p1.hp} maxHp={100} label={state.p1.agentId} side="left" stamina={state.p1.stamina} />
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          minWidth: 60,
        }}>
          <div style={{
            color: "#39ff14",
            fontFamily: "monospace",
            fontSize: 22,
            fontWeight: 900,
            textShadow: "0 0 20px #39ff14",
          }}>
            VS
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <RoundDots wins={state.p1.roundWins} maxWins={state.roundsToWin} />
            <RoundDots wins={state.p2.roundWins} maxWins={state.roundsToWin} />
          </div>
        </div>
        <HealthBar hp={state.p2.hp} maxHp={100} label={state.p2.agentId} side="right" stamina={state.p2.stamina} />
      </div>

      {/* Narrative */}
      {state.lastResult && (
        <div style={{
          textAlign: "center",
          color: "#fff",
          fontFamily: "monospace",
          fontSize: 14,
          marginTop: 16,
          padding: "6px 16px",
          background: "rgba(0,0,0,0.4)",
          display: "inline-block",
          position: "relative",
          left: "50%",
          transform: "translateX(-50%)",
          textShadow: "0 0 5px rgba(57,255,20,0.3)",
        }}>
          {state.lastResult.narrative}
        </div>
      )}

      {/* Fight status */}
      {state.status === "fight_over" && (
        <div style={{
          textAlign: "center",
          marginTop: 20,
          color: "#39ff14",
          fontSize: 28,
          fontWeight: 900,
          fontFamily: "monospace",
          textShadow: "0 0 30px #39ff14",
          letterSpacing: 4,
          animation: "pulse-glow 2s ease-in-out infinite",
        }}>
          K.O.
        </div>
      )}
    </div>
  );
}

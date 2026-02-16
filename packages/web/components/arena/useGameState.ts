"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface FighterSnapshot {
  agentId: string;
  hp: number;
  stamina: number;
  roundWins: number;
}

export interface ExchangeResult {
  p1Damage: number;
  p2Damage: number;
  p1StaminaChange: number;
  p2StaminaChange: number;
  narrative: string;
}

export interface FightState {
  fightId: string;
  round: number;
  exchange: number;
  maxExchanges: number;
  roundsToWin: number;
  p1: FighterSnapshot;
  p2: FighterSnapshot;
  status: "waiting_for_actions" | "round_over" | "fight_over";
  lastResult: ExchangeResult | null;
  history: Array<{
    round: number;
    exchange: number;
    p1Action: string;
    p2Action: string;
    result: ExchangeResult;
  }>;
}

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws/arena";

export function useGameState(fightId: string | null) {
  const [state, setState] = useState<FightState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!fightId) return;

    fetch(`${SERVER_URL}/api/v1/arena/fight/${fightId}`)
      .then((r) => r.json())
      .then((data) => { if (data.ok) setState(data.state); })
      .catch(() => {});

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "spectate", fight_id: fightId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === "fight_update" && msg.data?.fightId === fightId) {
          setState(msg.data);
        }
      } catch {}
    };

    return () => ws.close();
  }, [fightId]);

  const refetch = useCallback(async () => {
    if (!fightId) return;
    try {
      const r = await fetch(`${SERVER_URL}/api/v1/arena/fight/${fightId}`);
      const data = await r.json();
      if (data.ok) setState(data.state);
    } catch {}
  }, [fightId]);

  return { state, refetch };
}

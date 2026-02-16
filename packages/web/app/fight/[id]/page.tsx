"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { ArenaScene } from "../../../components/arena/ArenaScene";
import { useGameState } from "../../../components/arena/useGameState";
import { BettingPanel } from "../../../components/arena/BettingPanel";

export default function FightPage() {
  const params = useParams();
  const fightId = params.id as string;
  const { state, refetch } = useGameState(fightId);

  // Poll for updates every 1 second as fallback
  useEffect(() => {
    const interval = setInterval(refetch, 1000);
    return () => clearInterval(interval);
  }, [refetch]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <ArenaScene gameState={state} />
      {state && <BettingPanel state={state} />}
    </div>
  );
}

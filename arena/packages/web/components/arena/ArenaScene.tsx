"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import { BillboardFighter } from "./BillboardSprite";
import { FightHUD } from "./FightHUD";
import type { FightState } from "./useGameState";

function ArenaFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[24, 24]} />
      <meshStandardMaterial color="#0a0a1a" metalness={0.9} roughness={0.2} />
    </mesh>
  );
}

function ArenaRing() {
  const corners = [
    [-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, 5],
  ] as const;

  return (
    <group>
      {corners.map((pos, i) => (
        <mesh key={i} position={[pos[0], 1.2, pos[2]]}>
          <cylinderGeometry args={[0.08, 0.08, 2.4, 8]} />
          <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={0.6} />
        </mesh>
      ))}
      {/* Floor ring glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[4.8, 5.2, 4]} />
        <meshStandardMaterial color="#39ff14" emissive="#39ff14" emissiveIntensity={0.3} transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

function ArenaLights() {
  return (
    <>
      <ambientLight intensity={0.2} />
      <spotLight position={[0, 12, 0]} intensity={3} angle={0.5} penumbra={0.5} castShadow color="#39ff14" />
      <spotLight position={[-6, 8, 4]} intensity={1.5} angle={0.4} penumbra={0.3} color="#3939ff" />
      <spotLight position={[6, 8, -4]} intensity={1.5} angle={0.4} penumbra={0.3} color="#ff3939" />
      <pointLight position={[0, 0.5, 0]} intensity={0.5} color="#39ff14" distance={8} />
    </>
  );
}

interface ArenaSceneProps {
  gameState: FightState | null;
}

// Character mapping - can be extended to use actual character IDs from game state
const CHARACTER_MAP: Record<string, string> = {
  "default": "cyborg",
  "p1": "knight",
  "p2": "ronin",
};

function getCharacterId(agentId: string | undefined, isP1: boolean): string {
  // You can extend this to map agent IDs to character IDs
  // For now, use default characters based on player position
  return isP1 ? CHARACTER_MAP.p1 : CHARACTER_MAP.p2;
}

export function ArenaScene({ gameState }: ArenaSceneProps) {
  const isP1Hurt = gameState?.lastResult ? gameState.lastResult.p2Damage > 0 : false;
  const isP2Hurt = gameState?.lastResult ? gameState.lastResult.p1Damage > 0 : false;
  const isP1KO = gameState ? gameState.p1.hp <= 0 : false;
  const isP2KO = gameState ? gameState.p2.hp <= 0 : false;

  // Get the last action from history for animation
  const lastHistoryEntry = gameState?.history && gameState.history.length > 0
    ? gameState.history[gameState.history.length - 1]
    : null;
  const p1CurrentAction = lastHistoryEntry?.p1Action;
  const p2CurrentAction = lastHistoryEntry?.p2Action;

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", background: "#0a0a0f" }}>
      <Canvas shadows camera={{ position: [0, 7, 12], fov: 45 }}>
        <ArenaLights />
        <ArenaFloor />
        <ArenaRing />
        <Grid
          args={[24, 24]}
          cellColor="rgba(57,255,20,0.15)"
          sectionColor="rgba(57,255,20,0.3)"
          fadeDistance={18}
          cellThickness={0.3}
          sectionThickness={0.5}
          infiniteGrid={false}
          position={[0, 0.005, 0]}
        />

        {/* P1 fighter (blue side) */}
        <BillboardFighter
          position={[-2.5, 1.1, 0]}
          label={gameState?.p1.agentId ?? "P1"}
          color="#74b9ff"
          flipX={false}
          hp={gameState?.p1.hp ?? 100}
          isHurt={isP1Hurt}
          isKO={isP1KO}
          characterId={getCharacterId(gameState?.p1.agentId, true)}
          currentAction={p1CurrentAction}
        />

        {/* P2 fighter (red side) */}
        <BillboardFighter
          position={[2.5, 1.1, 0]}
          label={gameState?.p2.agentId ?? "P2"}
          color="#ff6b6b"
          flipX={true}
          hp={gameState?.p2.hp ?? 100}
          isHurt={isP2Hurt}
          isKO={isP2KO}
          characterId={getCharacterId(gameState?.p2.agentId, false)}
          currentAction={p2CurrentAction}
        />

        <OrbitControls
          maxPolarAngle={Math.PI / 2.1}
          minPolarAngle={Math.PI / 6}
          minDistance={6}
          maxDistance={18}
          target={[0, 1.2, 0]}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>

      {/* HUD overlay */}
      {gameState && <FightHUD state={gameState} />}
    </div>
  );
}

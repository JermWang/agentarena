"use client";

import { useRef, useEffect, useState } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";

// ── Types ──────────────────────────────────────────────────────

type AnimState = "idle" | "attack" | "block" | "dodge" | "hurt" | "ko";

interface BillboardFighterProps {
  position: [number, number, number];
  label: string;
  color: string;
  flipX: boolean;
  hp: number;
  isHurt: boolean;
  isKO: boolean;
  characterId?: string;
  currentAction?: string;
}

// ── Animation Config ───────────────────────────────────────────

const FRAMES_PER_SHEET = 4;

/** How long each animation plays before returning to idle */
const ANIM_DURATION: Record<AnimState, number> = {
  idle: Infinity, // loops forever
  attack: 0.5,
  block: 0.6,
  dodge: 0.4,
  hurt: 0.4,
  ko: 0.8,
};

/** Frames per second for each animation */
const ANIM_FPS: Record<AnimState, number> = {
  idle: 5,
  attack: 10,
  block: 8,
  dodge: 12,
  hurt: 10,
  ko: 6,
};

/** Whether the animation loops or plays once and holds the last frame */
const ANIM_LOOP: Record<AnimState, boolean> = {
  idle: true,
  attack: false,
  block: false,
  dodge: false,
  hurt: false,
  ko: false,
};

// ── Action → AnimState mapping ─────────────────────────────────

function getAnimState(
  action: string | undefined,
  isHurt: boolean,
  isKO: boolean,
): AnimState {
  if (isKO) return "ko";
  if (isHurt) return "hurt";
  if (!action) return "idle";

  const a = action.toLowerCase();
  if (a.includes("punch") || a.includes("kick") || a.includes("uppercut") || a.includes("sweep") || a.includes("grab"))
    return "attack";
  if (a.includes("block")) return "block";
  if (a.includes("dodge")) return "dodge";
  if (a.includes("taunt")) return "idle";

  return "idle";
}

// ── Configure texture for pixel art ────────────────────────────

function configureTexture(tex: THREE.Texture) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1 / FRAMES_PER_SHEET, 1);
}

// ── Component ──────────────────────────────────────────────────

export function BillboardFighter({
  position,
  label,
  color,
  flipX,
  hp,
  isHurt,
  isKO,
  characterId = "cyborg",
  currentAction,
}: BillboardFighterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  // Animation state
  const animTimerRef = useRef(0);
  const frameRef = useRef(0);
  const prevAnimRef = useRef<AnimState>("idle");
  const hurtTimerRef = useRef(0);

  // Load all 6 sprite sheets for this character
  const [idleTex, attackTex, blockTex, dodgeTex, hurtTex, koTex] = useLoader(
    THREE.TextureLoader,
    [
      `/sprites/${characterId}-idle-sheet.png`,
      `/sprites/${characterId}-attack-sheet.png`,
      `/sprites/${characterId}-block-sheet.png`,
      `/sprites/${characterId}-dodge-sheet.png`,
      `/sprites/${characterId}-hurt-sheet.png`,
      `/sprites/${characterId}-ko-sheet.png`,
    ],
  );

  // Configure all textures on load
  useEffect(() => {
    [idleTex, attackTex, blockTex, dodgeTex, hurtTex, koTex].forEach(configureTexture);
  }, [idleTex, attackTex, blockTex, dodgeTex, hurtTex, koTex]);

  // Map anim state to texture
  const texMap: Record<AnimState, THREE.Texture> = {
    idle: idleTex,
    attack: attackTex,
    block: blockTex,
    dodge: dodgeTex,
    hurt: hurtTex,
    ko: koTex,
  };

  // Determine current anim state
  const showHurt = isHurt || hurtTimerRef.current > 0;
  const animState = getAnimState(currentAction, showHurt, isKO);

  // Reset animation timer when state changes
  if (animState !== prevAnimRef.current) {
    animTimerRef.current = 0;
    frameRef.current = 0;
    prevAnimRef.current = animState;
  }

  useFrame((_state, delta) => {
    if (!groupRef.current) return;

    // Hurt flash timer
    if (isHurt) {
      hurtTimerRef.current = 0.35;
    }
    if (hurtTimerRef.current > 0) {
      hurtTimerRef.current -= delta;
    }

    // ── Animate sprite frame ────────────────────────
    animTimerRef.current += delta;
    const fps = ANIM_FPS[animState];
    const frameDuration = 1 / fps;
    const totalFrames = FRAMES_PER_SHEET;

    if (ANIM_LOOP[animState]) {
      // Looping animation (idle)
      frameRef.current = Math.floor(animTimerRef.current / frameDuration) % totalFrames;
    } else {
      // One-shot animation — hold last frame
      const rawFrame = Math.floor(animTimerRef.current / frameDuration);
      frameRef.current = Math.min(rawFrame, totalFrames - 1);
    }

    // Update texture offset for current frame
    const tex = texMap[animState];
    if (tex) {
      tex.offset.x = frameRef.current / totalFrames;
    }

    // Swap material texture if it changed
    if (materialRef.current && materialRef.current.map !== tex) {
      materialRef.current.map = tex;
      materialRef.current.needsUpdate = true;
    }

    // ── Physical animations ─────────────────────────
    if (isKO) {
      groupRef.current.rotation.z = THREE.MathUtils.lerp(
        groupRef.current.rotation.z,
        Math.PI / 2,
        0.05,
      );
      groupRef.current.position.y = THREE.MathUtils.lerp(
        groupRef.current.position.y,
        0.3,
        0.05,
      );
    } else if (showHurt) {
      // Shake on hit
      groupRef.current.position.x =
        position[0] + (Math.random() - 0.5) * 0.15;
      groupRef.current.position.y = position[1];
      groupRef.current.rotation.z = 0;
    } else {
      // Idle bob
      groupRef.current.position.x = position[0];
      groupRef.current.position.y =
        position[1] + Math.sin(Date.now() * 0.003) * 0.04;
      groupRef.current.rotation.z = 0;
    }
  });

  const opacity = hp > 0 ? 1.0 : 0.4;

  return (
    <Billboard
      position={position}
      follow
      lockX={false}
      lockY={false}
      lockZ={false}
    >
      <group ref={groupRef}>
        {/* Fighter sprite */}
        <mesh scale={flipX ? [-1, 1, 1] : [1, 1, 1]}>
          <planeGeometry args={[2, 2]} />
          <meshBasicMaterial
            ref={materialRef}
            map={idleTex}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Glow effect when hurt */}
        {isHurt && (
          <mesh scale={flipX ? [-1.05, 1.05, 1] : [1.05, 1.05, 1]}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.3}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* Name label */}
        <Text
          position={[0, 1.3, 0]}
          fontSize={0.22}
          color="#39ff14"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.02}
          outlineColor="#000"
          font={undefined}
        >
          {label}
        </Text>
      </group>
    </Billboard>
  );
}

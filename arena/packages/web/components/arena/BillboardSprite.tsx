"use client";

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";

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

// Map action types to sprite frame poses
function getPoseFromAction(action: string | undefined, isHurt: boolean, isKO: boolean): number {
  if (isKO) return 5; // ko frame
  if (isHurt) return 4; // hurt frame
  if (!action) return 0; // idle frame

  const actionLower = action.toLowerCase();
  if (actionLower.includes('attack')) return 1; // attack frame
  if (actionLower.includes('block')) return 2; // block frame
  if (actionLower.includes('dodge')) return 3; // dodge frame

  return 0; // default to idle
}

export function BillboardFighter({
  position,
  label,
  color,
  flipX,
  hp,
  isHurt,
  isKO,
  characterId = "cyborg",
  currentAction
}: BillboardFighterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const hurtTimerRef = useRef<number>(0);

  // Load sprite sheet texture
  const spriteSheet = useLoader(THREE.TextureLoader, `/sprites/${characterId}-sheet.png`);

  // Configure texture for pixel art sprite sheets
  useEffect(() => {
    if (spriteSheet) {
      spriteSheet.colorSpace = THREE.SRGBColorSpace;
      spriteSheet.magFilter = THREE.NearestFilter;
      spriteSheet.minFilter = THREE.NearestFilter;
      spriteSheet.wrapS = THREE.ClampToEdgeWrapping;
      spriteSheet.wrapT = THREE.ClampToEdgeWrapping;
      // Set up for horizontal sprite sheet (6 frames)
      spriteSheet.repeat.set(1 / 6, 1);
    }
  }, [spriteSheet]);

  // Determine current pose frame
  const showHurt = isHurt && hurtTimerRef.current > 0;
  const poseFrame = getPoseFromAction(currentAction, showHurt, isKO);

  // Update texture offset for current frame
  useEffect(() => {
    if (spriteSheet) {
      spriteSheet.offset.x = poseFrame / 6;
    }
  }, [spriteSheet, poseFrame]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // Hurt flash timer (show hurt frame briefly)
    if (isHurt) {
      hurtTimerRef.current = 0.3; // Show hurt frame for 300ms
    }
    if (hurtTimerRef.current > 0) {
      hurtTimerRef.current -= delta;
    }

    if (isKO) {
      // Fallen over
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, Math.PI / 2, 0.05);
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0.3, 0.05);
    } else if (isHurt) {
      // Shake on hit
      groupRef.current.position.x = position[0] + (Math.random() - 0.5) * 0.15;
    } else {
      // Idle bob
      groupRef.current.position.x = position[0];
      groupRef.current.position.y = position[1] + Math.sin(Date.now() * 0.003) * 0.04;
      groupRef.current.rotation.z = 0;
    }
  });

  const opacity = hp > 0 ? 1.0 : 0.4;

  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      <group ref={groupRef}>
        {/* Fighter sprite */}
        <mesh ref={meshRef} scale={flipX ? [-1, 1, 1] : [1, 1, 1]}>
          <planeGeometry args={[1.4, 2.8]} />
          <meshBasicMaterial
            map={spriteSheet}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* Glow effect when hurt */}
        {isHurt && (
          <mesh scale={flipX ? [-1.05, 1.05, 1] : [1.05, 1.05, 1]}>
            <planeGeometry args={[1.4, 2.8]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={0.4}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* Name label */}
        <Text
          position={[0, 1.8, 0]}
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

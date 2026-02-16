/**
 * Sprite Sheet Generator — Agent Battle Arena
 * Generates 5 character sprite sheets (6 poses each) as pixel art PNGs.
 *
 * Each sheet: 384 x 128 pixels (6 frames of 64x128)
 * Poses: idle, attack, block, dodge, hurt, ko
 *
 * Usage: npx tsx scripts/generate-sprites.ts
 */

import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FRAME_W = 64;
const FRAME_H = 128;
const POSES = ["idle", "attack", "block", "dodge", "hurt", "ko"] as const;
const SHEET_W = FRAME_W * POSES.length;
const SHEET_H = FRAME_H;

const OUTPUT_DIR = join(__dirname, "../../web/public/sprites");

interface CharacterDef {
  id: string;
  name: string;
  primary: string;      // main body color
  secondary: string;    // accent / trim
  glow: string;         // emissive glow
  headShape: "round" | "angular" | "horned" | "helm" | "hood";
  bodyStyle: "slim" | "bulky" | "medium" | "armored" | "flowing";
  weaponColor: string;
}

const CHARACTERS: CharacterDef[] = [
  {
    id: "ronin",
    name: "Ronin",
    primary: "#1a1a2e",
    secondary: "#e94560",
    glow: "#ff6b6b",
    headShape: "hood",
    bodyStyle: "slim",
    weaponColor: "#e94560",
  },
  {
    id: "knight",
    name: "Knight",
    primary: "#2d3436",
    secondary: "#0984e3",
    glow: "#74b9ff",
    headShape: "helm",
    bodyStyle: "armored",
    weaponColor: "#dfe6e9",
  },
  {
    id: "cyborg",
    name: "Cyborg",
    primary: "#2d2d2d",
    secondary: "#39ff14",
    glow: "#39ff14",
    headShape: "angular",
    bodyStyle: "medium",
    weaponColor: "#39ff14",
  },
  {
    id: "demon",
    name: "Demon",
    primary: "#2d0a0a",
    secondary: "#ff4444",
    glow: "#ff6600",
    headShape: "horned",
    bodyStyle: "bulky",
    weaponColor: "#ff4444",
  },
  {
    id: "phantom",
    name: "Phantom",
    primary: "#0d0d2b",
    secondary: "#a855f7",
    glow: "#c084fc",
    headShape: "round",
    bodyStyle: "flowing",
    weaponColor: "#a855f7",
  },
];

function px(ctx: ReturnType<typeof createCanvas>["getContext"], x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), w, h);
}

function drawHead(ctx: any, cx: number, baseY: number, char: CharacterDef) {
  const s = char.headShape;
  if (s === "round") {
    // Round head
    px(ctx, cx - 6, baseY, 12, 12, char.primary);
    px(ctx, cx - 5, baseY + 1, 10, 10, char.secondary);
    // Eyes
    px(ctx, cx - 3, baseY + 4, 2, 2, char.glow);
    px(ctx, cx + 2, baseY + 4, 2, 2, char.glow);
  } else if (s === "angular") {
    // Angular/cyber head
    px(ctx, cx - 7, baseY + 2, 14, 10, char.primary);
    px(ctx, cx - 5, baseY, 10, 12, char.primary);
    // Visor
    px(ctx, cx - 5, baseY + 4, 10, 3, char.glow);
    // Antenna
    px(ctx, cx - 1, baseY - 4, 2, 4, char.secondary);
  } else if (s === "horned") {
    // Demon horns
    px(ctx, cx - 6, baseY + 2, 12, 10, char.primary);
    px(ctx, cx - 8, baseY - 4, 3, 8, char.secondary);
    px(ctx, cx + 6, baseY - 4, 3, 8, char.secondary);
    // Eyes
    px(ctx, cx - 3, baseY + 5, 3, 2, char.glow);
    px(ctx, cx + 1, baseY + 5, 3, 2, char.glow);
  } else if (s === "helm") {
    // Knight helmet
    px(ctx, cx - 7, baseY - 2, 14, 16, char.primary);
    px(ctx, cx - 6, baseY, 12, 12, char.secondary);
    // Visor slit
    px(ctx, cx - 4, baseY + 5, 8, 2, "#111");
    // Plume
    px(ctx, cx - 2, baseY - 6, 4, 5, char.secondary);
  } else if (s === "hood") {
    // Ronin hood
    px(ctx, cx - 8, baseY - 2, 16, 14, char.primary);
    px(ctx, cx - 5, baseY + 3, 10, 8, char.primary);
    // Face shadow
    px(ctx, cx - 4, baseY + 4, 8, 6, "#111");
    // Eyes
    px(ctx, cx - 3, baseY + 5, 2, 2, char.glow);
    px(ctx, cx + 2, baseY + 5, 2, 2, char.glow);
  }
}

function drawBody(ctx: any, cx: number, baseY: number, char: CharacterDef, pose: string) {
  const bs = char.bodyStyle;
  const bodyW = bs === "bulky" ? 18 : bs === "armored" ? 16 : bs === "flowing" ? 14 : bs === "slim" ? 12 : 14;
  const bodyH = 30;

  // Torso
  px(ctx, cx - bodyW / 2, baseY, bodyW, bodyH, char.primary);

  // Trim lines
  px(ctx, cx - bodyW / 2, baseY, 2, bodyH, char.secondary);
  px(ctx, cx + bodyW / 2 - 2, baseY, 2, bodyH, char.secondary);

  // Center accent
  if (bs === "armored") {
    px(ctx, cx - 1, baseY + 2, 2, bodyH - 4, char.secondary);
    // Shoulder pads
    px(ctx, cx - bodyW / 2 - 4, baseY, 6, 8, char.secondary);
    px(ctx, cx + bodyW / 2 - 2, baseY, 6, 8, char.secondary);
  } else if (bs === "cyborg" || bs === "medium") {
    // Circuit lines
    px(ctx, cx - 3, baseY + 4, 6, 1, char.glow);
    px(ctx, cx - 3, baseY + 10, 6, 1, char.glow);
    px(ctx, cx - 3, baseY + 16, 6, 1, char.glow);
  } else if (bs === "flowing") {
    // Flowing cape/robe effect
    px(ctx, cx - bodyW / 2 - 2, baseY + 8, bodyW + 4, 22, char.primary);
    // Wispy edges
    px(ctx, cx - bodyW / 2 - 4, baseY + 15, 2, 15, char.secondary + "80");
    px(ctx, cx + bodyW / 2 + 2, baseY + 15, 2, 15, char.secondary + "80");
  }

  // Belt / waist
  px(ctx, cx - bodyW / 2, baseY + bodyH - 4, bodyW, 2, char.secondary);
}

function drawArms(ctx: any, cx: number, bodyY: number, char: CharacterDef, pose: string) {
  const armW = 4;
  const armLen = 20;
  const bodyW = char.bodyStyle === "bulky" ? 18 : char.bodyStyle === "armored" ? 16 : 14;

  if (pose === "idle") {
    // Arms at sides
    px(ctx, cx - bodyW / 2 - armW, bodyY + 4, armW, armLen, char.primary);
    px(ctx, cx + bodyW / 2, bodyY + 4, armW, armLen, char.primary);
    // Fists
    px(ctx, cx - bodyW / 2 - armW, bodyY + 4 + armLen, armW + 1, 4, char.secondary);
    px(ctx, cx + bodyW / 2, bodyY + 4 + armLen, armW + 1, 4, char.secondary);
  } else if (pose === "attack") {
    // Right arm extended forward (punch)
    px(ctx, cx - bodyW / 2 - armW, bodyY + 4, armW, armLen, char.primary);
    px(ctx, cx + bodyW / 2, bodyY + 2, 24, armW, char.primary);
    // Fist glow
    px(ctx, cx + bodyW / 2 + 20, bodyY, 6, 8, char.weaponColor);
    // Impact lines
    px(ctx, cx + bodyW / 2 + 26, bodyY - 2, 4, 2, char.glow);
    px(ctx, cx + bodyW / 2 + 26, bodyY + 4, 4, 2, char.glow);
    px(ctx, cx + bodyW / 2 + 26, bodyY + 8, 4, 2, char.glow);
  } else if (pose === "block") {
    // Arms crossed in front
    px(ctx, cx - 6, bodyY + 2, 12, armW, char.primary);
    px(ctx, cx - 6, bodyY + 8, 12, armW, char.primary);
    // Shield glow
    px(ctx, cx - 8, bodyY, 16, 14, char.glow + "40");
    px(ctx, cx - 7, bodyY + 1, 14, 12, char.glow + "20");
  } else if (pose === "dodge") {
    // Arms trailing (movement)
    px(ctx, cx - bodyW / 2 - armW - 6, bodyY + 6, armW + 6, 4, char.primary);
    px(ctx, cx - bodyW / 2 - armW - 4, bodyY + 14, armW + 4, 4, char.primary);
    // Motion blur
    px(ctx, cx + bodyW / 2 + 2, bodyY + 4, 8, 2, char.glow + "60");
    px(ctx, cx + bodyW / 2 + 2, bodyY + 10, 12, 2, char.glow + "40");
    px(ctx, cx + bodyW / 2 + 2, bodyY + 16, 6, 2, char.glow + "20");
  } else if (pose === "hurt") {
    // Arms flung back
    px(ctx, cx - bodyW / 2 - armW - 8, bodyY + 2, armW + 8, 4, char.primary);
    px(ctx, cx + bodyW / 2, bodyY + 2, armW + 8, 4, char.primary);
  } else if (pose === "ko") {
    // Arms limp
    px(ctx, cx - bodyW / 2 - 2, bodyY + armLen, armW, 8, char.primary);
    px(ctx, cx + bodyW / 2 - 2, bodyY + armLen, armW, 8, char.primary);
  }
}

function drawLegs(ctx: any, cx: number, baseY: number, char: CharacterDef, pose: string) {
  const legW = 5;
  const legH = 24;

  if (pose === "idle" || pose === "block") {
    // Standing
    px(ctx, cx - 5, baseY, legW, legH, char.primary);
    px(ctx, cx + 1, baseY, legW, legH, char.primary);
    // Boots
    px(ctx, cx - 6, baseY + legH - 4, legW + 2, 4, char.secondary);
    px(ctx, cx, baseY + legH - 4, legW + 2, 4, char.secondary);
  } else if (pose === "attack") {
    // Lunge forward
    px(ctx, cx - 6, baseY, legW, legH, char.primary);
    px(ctx, cx + 2, baseY - 2, legW, legH - 4, char.primary);
    px(ctx, cx + 6, baseY + legH - 10, legW, 6, char.primary);
    // Boots
    px(ctx, cx - 7, baseY + legH - 4, legW + 2, 4, char.secondary);
    px(ctx, cx + 6, baseY + legH - 6, legW + 2, 4, char.secondary);
  } else if (pose === "dodge") {
    // Crouched / moving
    px(ctx, cx - 4, baseY + 4, legW, legH - 8, char.primary);
    px(ctx, cx + 2, baseY + 2, legW, legH - 6, char.primary);
    // Boots
    px(ctx, cx - 5, baseY + legH - 6, legW + 2, 4, char.secondary);
    px(ctx, cx + 1, baseY + legH - 6, legW + 2, 4, char.secondary);
  } else if (pose === "hurt") {
    // Staggering
    px(ctx, cx - 7, baseY, legW, legH, char.primary);
    px(ctx, cx + 3, baseY + 2, legW, legH - 2, char.primary);
    px(ctx, cx - 8, baseY + legH - 4, legW + 2, 4, char.secondary);
    px(ctx, cx + 2, baseY + legH - 4, legW + 2, 4, char.secondary);
  } else if (pose === "ko") {
    // Fallen
    px(ctx, cx - 3, baseY + 4, legW, legH - 4, char.primary);
    px(ctx, cx + 3, baseY + 6, legW, legH - 6, char.primary);
  }
}

function drawGlow(ctx: any, cx: number, cy: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, color + "30");
  gradient.addColorStop(0.5, color + "15");
  gradient.addColorStop(1, color + "00");
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

function drawCharacterFrame(ctx: any, offsetX: number, char: CharacterDef, pose: string) {
  const cx = offsetX + FRAME_W / 2;
  const headY = 10;
  const bodyY = headY + 14;
  const legY = bodyY + 30;

  // Character glow aura
  if (pose === "attack") {
    drawGlow(ctx, cx + 10, bodyY + 15, 30, char.weaponColor);
  } else if (pose === "block") {
    drawGlow(ctx, cx, bodyY + 10, 25, char.glow);
  } else if (pose === "hurt") {
    drawGlow(ctx, cx, bodyY + 15, 20, "#ff0000");
  } else if (pose === "ko") {
    // No glow, dim
  } else {
    drawGlow(ctx, cx, bodyY + 15, 18, char.glow);
  }

  // Apply pose offset
  let offsetY = 0;
  let tiltX = 0;
  if (pose === "hurt") { tiltX = -4; offsetY = 2; }
  if (pose === "ko") { offsetY = 30; }
  if (pose === "dodge") { tiltX = 8; offsetY = 4; }

  const adjCx = cx + tiltX;
  const adjHeadY = headY + offsetY;
  const adjBodyY = bodyY + offsetY;
  const adjLegY = legY + offsetY;

  if (pose === "ko") {
    // Draw fallen character (rotated effect via positioning)
    // Simple: just draw lower and dimmer
    ctx.globalAlpha = 0.5;
    drawLegs(ctx, adjCx, adjLegY, char, pose);
    drawBody(ctx, adjCx, adjBodyY, char, pose);
    drawArms(ctx, adjCx, adjBodyY, char, pose);
    drawHead(ctx, adjCx, adjHeadY, char);
    ctx.globalAlpha = 1.0;

    // X eyes
    px(ctx, adjCx - 3, adjHeadY + 4, 3, 1, "#ff0000");
    px(ctx, adjCx + 1, adjHeadY + 4, 3, 1, "#ff0000");
  } else {
    drawLegs(ctx, adjCx, adjLegY, char, pose);
    drawBody(ctx, adjCx, adjBodyY, char, pose);
    drawArms(ctx, adjCx, adjBodyY, char, pose);
    drawHead(ctx, adjCx, adjHeadY, char);
  }

  // Frame border (debug, remove for prod)
  // ctx.strokeStyle = "#333";
  // ctx.strokeRect(offsetX, 0, FRAME_W, FRAME_H);
}

function generateSpriteSheet(char: CharacterDef): Buffer {
  const canvas = createCanvas(SHEET_W, SHEET_H);
  const ctx = canvas.getContext("2d");

  // Transparent background
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);

  // Draw each pose frame
  POSES.forEach((pose, i) => {
    drawCharacterFrame(ctx, i * FRAME_W, char, pose);
  });

  return canvas.toBuffer("image/png");
}

// Also generate a preview image (single idle frame, larger)
function generatePreview(char: CharacterDef): Buffer {
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, size, size);

  // Scale up the idle frame
  const tempCanvas = createCanvas(FRAME_W, FRAME_H);
  const tempCtx = tempCanvas.getContext("2d");
  drawCharacterFrame(tempCtx, 0, char, "idle");

  // Draw scaled
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, FRAME_W, FRAME_H, 32, 16, size - 64, size - 32);

  // Character name
  ctx.fillStyle = char.glow;
  ctx.font = "bold 18px monospace";
  ctx.textAlign = "center";
  ctx.fillText(char.name.toUpperCase(), size / 2, size - 8);

  return canvas.toBuffer("image/png");
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const char of CHARACTERS) {
    // Sprite sheet
    const sheet = generateSpriteSheet(char);
    const sheetPath = join(OUTPUT_DIR, `${char.id}-sheet.png`);
    writeFileSync(sheetPath, sheet);
    console.log(`  ${char.id}-sheet.png (${SHEET_W}x${SHEET_H}, ${POSES.length} frames)`);

    // Preview
    const preview = generatePreview(char);
    const prevPath = join(OUTPUT_DIR, `${char.id}-preview.png`);
    writeFileSync(prevPath, preview);
    console.log(`  ${char.id}-preview.png (256x256)`);
  }

  // Generate a manifest
  const manifest = {
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    poses: POSES,
    characters: CHARACTERS.map(c => ({
      id: c.id,
      name: c.name,
      sheet: `/sprites/${c.id}-sheet.png`,
      preview: `/sprites/${c.id}-preview.png`,
      glow: c.glow,
      primary: c.primary,
      secondary: c.secondary,
    })),
  };
  writeFileSync(join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`  manifest.json`);

  console.log(`\nDone! ${CHARACTERS.length} characters generated.`);
}

main();

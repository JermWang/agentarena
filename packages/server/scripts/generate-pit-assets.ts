// packages/server/scripts/generate-pit-assets.ts
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, "../../web/public/sprites");
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
  console.error("Set GOOGLE_API_KEY env var");
  process.exit(1);
}

interface GenerationTask {
  name: string;
  filename: string;
  prompt: string;
}

const TASKS: GenerationTask[] = [
  {
    name: "Pit Background",
    filename: "pit-bg.png",
    prompt: `16-bit pixel art of a futuristic underground lobby for a fighting game. SNES retro pixel art style.
A spacious high-tech gathering hall where fighters hang out before matches. NOT scary or gothic — cool and techy.
Wide open space with a high ceiling. Stone walls covered in bright neon green glowing circuit-board patterns and digital runes.
A large neon green crystal chandelier hangs from the center ceiling, casting green light.
Holographic screens and neon signs on the walls showing fight stats and leaderboards.
The vibe is like a high-tech underground fight club lounge — cool, stylish, futuristic.
Dark navy blue and slate gray stone walls. Bright neon green (#39ff14) is the main accent color for all glowing elements.
Arched doorways leading to different areas. The space feels grand and inviting, not threatening.
Style: 16-bit pixel art with visible square pixels, limited color palette, retro SNES game aesthetic.
Wide landscape format. No characters. Similar aesthetic to pixel art cyberpunk or sci-fi game backgrounds.`,
  },
  {
    name: "Pit Floor Texture",
    filename: "pit-floor.png",
    prompt: `16-bit pixel art seamless tileable floor texture. Top-down view.
Dark hexagonal tech-tiles with neon green (#39ff14) glowing edges between tiles.
Clean geometric hexagons. Some tiles have small green circuit patterns etched in them.
Dark gray and dark navy blue tones with bright neon green highlights in the gaps.
Looks like high-tech arena flooring, not dirty dungeon stone.
Style: 16-bit pixel art, visible individual pixels, clean geometric shapes, retro game aesthetic.
Must be seamless and tileable. 512x512 pixels.`,
  },
  {
    name: "Pit Crowd",
    filename: "pit-crowd.png",
    prompt: `16-bit pixel art crowd of tiny spectators watching fights. Retro SNES game style.
Multiple rows of small pixel-art people sitting in tiered seating. Each figure is only 8-12 pixels tall.
Variety of colorful outfits. Some spectators hold glowing green lightsticks or neon signs.
Excited crowd energy — some have arms raised. Dark background behind them.
The crowd faces forward. Lively and fun atmosphere, like a sporting event crowd.
Style: 16-bit pixel art with visible individual pixels. Dark background with colorful tiny characters.
Wide panoramic banner format. Similar to classic fighting game audience sprites.`,
  },
];

async function generateImage(task: GenerationTask): Promise<Buffer> {
  console.log(`Generating: ${task.name}...`);

  // Use gemini-2.0-flash-exp-image-generation (dedicated image gen model)
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Generate an image: ${task.prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();

  // Extract image from response
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.mimeType?.startsWith("image/")) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }
  }

  throw new Error("No image in Gemini response");
}

async function generateImageImagen(task: GenerationTask): Promise<Buffer> {
  console.log(`  Retrying with Imagen 4.0...`);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: task.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: task.filename.includes("crowd") ? "16:3" : task.filename.includes("floor") ? "1:1" : "16:9",
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Imagen API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("No image in Imagen response");
  return Buffer.from(b64, "base64");
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const task of TASKS) {
    try {
      let imageBuffer: Buffer;
      try {
        imageBuffer = await generateImage(task);
      } catch (err) {
        console.log(`  Flash failed: ${err}`);
        imageBuffer = await generateImageImagen(task);
      }
      const outPath = join(OUTPUT_DIR, task.filename);
      writeFileSync(outPath, imageBuffer);
      console.log(`  Saved: ${outPath} (${(imageBuffer.length / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error(`  FAILED: ${task.name}:`, err);
    }
  }

  console.log("\nDone! Assets saved to:", OUTPUT_DIR);
}

main();

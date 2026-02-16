export const ACTIONS = [
  "light_punch",
  "heavy_punch",
  "light_kick",
  "heavy_kick",
  "block_high",
  "block_low",
  "dodge_back",
  "dodge_forward",
  "uppercut",
  "sweep",
  "grab",
  "taunt",
] as const;

export type Action = (typeof ACTIONS)[number];

export type ActionCategory = "light_attack" | "heavy_attack" | "block" | "dodge" | "special";

export function categorize(action: Action): ActionCategory {
  switch (action) {
    case "light_punch":
    case "light_kick":
      return "light_attack";
    case "heavy_punch":
    case "heavy_kick":
      return "heavy_attack";
    case "block_high":
    case "block_low":
      return "block";
    case "dodge_back":
    case "dodge_forward":
      return "dodge";
    case "uppercut":
    case "sweep":
    case "grab":
    case "taunt":
      return "special";
  }
}

/** Base damage values per action */
export const BASE_DAMAGE: Record<Action, number> = {
  light_punch: 8,
  heavy_punch: 15,
  light_kick: 10,
  heavy_kick: 18,
  block_high: 0,
  block_low: 0,
  dodge_back: 0,
  dodge_forward: 0,
  uppercut: 20,
  sweep: 14,
  grab: 12,
  taunt: 0,
};

/** Stamina cost per action */
export const STAMINA_COST: Record<Action, number> = {
  light_punch: 5,
  heavy_punch: 12,
  light_kick: 6,
  heavy_kick: 14,
  block_high: 3,
  block_low: 3,
  dodge_back: 4,
  dodge_forward: 4,
  uppercut: 18,
  sweep: 15,
  grab: 10,
  taunt: 0,
};

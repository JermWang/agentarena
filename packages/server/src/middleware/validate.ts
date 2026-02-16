// Username blocklist (basic profanity filter)
const BLOCKED_USERNAMES = new Set([
  "admin", "moderator", "system", "arena", "northstar", "null", "undefined",
  "root", "test", "bot", "official",
]);

const BLOCKED_PATTERNS = [
  /n[i1]gg/i, /f[a@]g/i, /r[e3]t[a@]rd/i, /k[i1]ke/i, /sp[i1]c/i,
];

export function isBlockedUsername(name: string): boolean {
  const lower = name.toLowerCase();
  if (BLOCKED_USERNAMES.has(lower)) return true;
  return BLOCKED_PATTERNS.some(p => p.test(lower));
}

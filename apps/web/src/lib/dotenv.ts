/**
 * Client-side .env parsing + secret heuristics — mirrors the server logic in
 * apps/server/src/routes/env.ts so the UI can live-detect variables as the
 * user types, before anything is saved.
 */

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2] ?? '';
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
}

export function isSecretKey(key: string): boolean {
  return /token|secret|password|passwd|\bpass\b|api[_-]?key|auth|credential|private[_-]?key|dsn|uri|url|webhook/i.test(key);
}

export function discordTokenShape(value: string): boolean {
  const parts = value.trim().split('.');
  return (
    parts.length === 3 &&
    /^[A-Za-z0-9_-]{16,}$/.test(parts[0]!) &&
    /^[A-Za-z0-9_-]{6,}$/.test(parts[1]!) &&
    /^[A-Za-z0-9_-]{26,}$/.test(parts[2]!)
  );
}

export interface DetectedEnv {
  keys: string[];
  secrets: string[];
  discordToken?: { present: boolean; valid?: boolean };
  invalidKeys: string[];
}

/** Analyze pasted .env text — powers the live detection preview. */
export function detectEnv(text: string): DetectedEnv {
  const parsed = parseDotenv(text);
  const keys = Object.keys(parsed);
  const secrets = keys.filter(isSecretKey);
  const invalidKeys = Array.from(text.matchAll(/^(?:export\s+)?([^\s=][^\s=]*)\s*=/gm))
    .map((m) => m[1]!)
    .filter((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
  const tokenKey = keys.find((k) => /^DISCORD_TOKEN$/i.test(k) || (/discord/i.test(k) && /token/i.test(k)));
  return {
    keys,
    secrets,
    invalidKeys,
    discordToken: tokenKey
      ? { present: true, valid: discordTokenShape(parsed[tokenKey]!) }
      : keys.length
        ? { present: false }
        : undefined
  };
}

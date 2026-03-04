import type { Theme } from "./ui/theme";
import type { LocalePreference } from "./ui/i18n";
import type { StrategySettings } from "./webrtc/settings";
import { DEFAULT_ICE_SERVERS } from "./webrtc/settings";
import type { StrategyName } from "./webrtc/strategies";
import type { ConnectionMode, IceServerConfig } from "./webrtc/types";

export interface AppConfig {
  app: { theme: Theme; language: LocalePreference };
  webrtc: StrategySettings;
}

const VALID_THEMES: ReadonlySet<string> = new Set(["auto", "light", "dark"]);
const VALID_LANGUAGES: ReadonlySet<string> = new Set(["auto", "en", "fr", "ar"]);
const VALID_MODES: ReadonlySet<string> = new Set(["parallel", "sequential"]);
const VALID_STRATEGIES: ReadonlySet<string> = new Set(["nostr", "torrent", "mqtt"]);

// ── Serializer ──

export function configToToml(config: AppConfig): string {
  const lines: string[] = ["# QRShare Configuration", ""];

  lines.push("[app]");
  lines.push(`theme = ${quote(config.app.theme)}`);
  lines.push(`language = ${quote(config.app.language)}`);
  lines.push("");

  lines.push("[webrtc]");
  lines.push(`mode = ${quote(config.webrtc.connectionMode)}`);
  lines.push(`strategies = [${config.webrtc.enabledStrategies.map(quote).join(", ")}]`);

  for (const strategy of config.webrtc.enabledStrategies) {
    const urls = config.webrtc.relayUrls[strategy] ?? [];
    if (urls.length > 0) {
      lines.push("");
      lines.push(`[webrtc.relays.${strategy}]`);
      lines.push("urls = [");
      for (const url of urls) {
        lines.push(`  ${quote(url)},`);
      }
      lines.push("]");
    }
  }

  if (config.webrtc.iceServers.length > 0) {
    lines.push("");
    lines.push("[webrtc.ice]");
    for (const server of config.webrtc.iceServers) {
      const url = Array.isArray(server.urls) ? server.urls[0] : server.urls;
      if (url.startsWith("stun:")) {
        lines.push(`stun = [${config.webrtc.iceServers
          .filter((s) => {
            const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
            return u.startsWith("stun:");
          })
          .map((s) => quote(Array.isArray(s.urls) ? s.urls[0] : s.urls))
          .join(", ")}]`);
        break;
      }
    }
    const turnServers = config.webrtc.iceServers.filter((s) => {
      const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
      return u.startsWith("turn:") || u.startsWith("turns:");
    });
    for (const turn of turnServers) {
      const url = Array.isArray(turn.urls) ? turn.urls[0] : turn.urls;
      lines.push("");
      lines.push("[[webrtc.ice.turn]]");
      lines.push(`urls = ${quote(url)}`);
      if (turn.username) lines.push(`username = ${quote(turn.username)}`);
      if (turn.credential) lines.push(`credential = ${quote(turn.credential)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ── Parser ──

export function tomlToConfig(toml: string): AppConfig {
  const data = parseToml(toml);

  const app = (data.app ?? {}) as Record<string, unknown>;
  const webrtc = (data.webrtc ?? {}) as Record<string, unknown>;

  const theme = validateEnum(app.theme, VALID_THEMES, "auto") as Theme;
  const language = validateEnum(app.language, VALID_LANGUAGES, "auto") as LocalePreference;

  const mode = validateEnum(webrtc.mode, VALID_MODES, "parallel") as ConnectionMode;
  const rawStrategies = Array.isArray(webrtc.strategies) ? webrtc.strategies : [];
  const strategies = rawStrategies.filter(
    (s): s is StrategyName => typeof s === "string" && VALID_STRATEGIES.has(s),
  );

  const relays = (webrtc.relays ?? {}) as Record<string, Record<string, unknown>>;
  const relayUrls: Record<StrategyName, string[]> = {
    nostr: extractUrls(relays.nostr),
    torrent: extractUrls(relays.torrent),
    mqtt: extractUrls(relays.mqtt),
  };

  const ice = (webrtc.ice ?? {}) as Record<string, unknown>;
  const iceServers = parseIceServers(ice);

  return {
    app: { theme, language },
    webrtc: {
      enabledStrategies: strategies.length > 0 ? strategies : ["nostr", "torrent", "mqtt"],
      relayUrls,
      connectionMode: mode,
      iceServers,
    },
  };
}

function parseIceServers(ice: Record<string, unknown>): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  // STUN servers: stun = ["stun:...", ...]
  const stunList = Array.isArray(ice.stun) ? ice.stun : [];
  for (const url of stunList) {
    if (typeof url === "string") servers.push({ urls: url });
  }

  // TURN servers: [[webrtc.ice.turn]] array of tables
  const turnList = Array.isArray(ice.turn) ? ice.turn : [];
  for (const turn of turnList) {
    if (typeof turn === "object" && turn !== null) {
      const t = turn as Record<string, unknown>;
      const urls = typeof t.urls === "string" ? t.urls : "";
      if (urls) {
        servers.push({
          urls,
          ...(typeof t.username === "string" ? { username: t.username } : {}),
          ...(typeof t.credential === "string" ? { credential: t.credential } : {}),
        });
      }
    }
  }

  return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
}

function extractUrls(obj: Record<string, unknown> | undefined): string[] {
  if (!obj || !Array.isArray(obj.urls)) return [];
  return obj.urls.filter((u): u is string => typeof u === "string");
}

function validateEnum(value: unknown, valid: ReadonlySet<string>, fallback: string): string {
  return typeof value === "string" && valid.has(value) ? value : fallback;
}

// ── Minimal TOML parser (fixed-schema) ──

interface TomlObject {
  [key: string]: unknown;
}

function parseToml(input: string): TomlObject {
  const root: TomlObject = {};
  let currentSection = root;
  const lines = input.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;

    // Table header: [section] or [section.sub]
    const tableMatch = line.match(/^\[([a-zA-Z0-9_.]+)\]$/);
    if (tableMatch) {
      const path = tableMatch[1].split(".");
      currentSection = ensurePath(root, path);
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();
      currentSection[key] = parseValue(rawValue, lines, i);
      continue;
    }
  }

  return root;
}

function ensurePath(root: TomlObject, path: string[]): TomlObject {
  let current = root;
  for (const key of path) {
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as TomlObject;
  }
  return current;
}

function parseValue(raw: string, lines: string[], lineIndex: number): unknown {
  // String
  if (raw.startsWith('"')) {
    return parseString(raw);
  }

  // Inline array on single line: ["a", "b"]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return parseInlineArray(raw);
  }

  // Multi-line array starting with [
  if (raw === "[") {
    return parseMultilineArray(lines, lineIndex);
  }

  // Boolean
  if (raw === "true") return true;
  if (raw === "false") return false;

  // Number
  const num = Number(raw);
  if (!Number.isNaN(num)) return num;

  return raw;
}

function parseString(raw: string): string {
  // Extract content between first and last quote
  const match = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) throw new Error(`Invalid TOML string: ${raw}`);
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseInlineArray(raw: string): unknown[] {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      if (s.startsWith('"')) return parseString(s);
      if (s === "true") return true;
      if (s === "false") return false;
      const n = Number(s);
      return Number.isNaN(n) ? s : n;
    });
}

function parseMultilineArray(lines: string[], startLine: number): unknown[] {
  const result: unknown[] = [];
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, "").trim();
    if (!line) continue;
    if (line === "]") break;
    // Remove trailing comma
    const entry = line.endsWith(",") ? line.slice(0, -1).trim() : line;
    if (entry.startsWith('"')) {
      result.push(parseString(entry));
    } else if (entry === "]") {
      break;
    }
  }
  return result;
}

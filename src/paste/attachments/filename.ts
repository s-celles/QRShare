/**
 * Attachment file names come from anonymous peers: they are sanitised before
 * signing and checked again on reception (REQ-PASTE-035), and executable or script
 * extensions are flagged (REQ-PASTE-044).
 */

export const MAX_NAME_BYTES = 100;
const FALLBACK = "attachment";

/** C0, DEL, C1, soft hyphen, bidi marks/overrides/isolates and invisible formatting. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻]/gu;
const RESERVED = /[<>:"/\\|?*]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

const enc = new TextEncoder();
const byteLength = (s: string) => enc.encode(s).length;

function truncateBytes(s: string, max: number): string {
  let out = "";
  let n = 0;
  for (const ch of s) {
    const size = byteLength(ch);
    if (n + size > max) break;
    out += ch;
    n += size;
  }
  return out;
}

const trimEnds = (s: string) => s.replace(/^[\s.]+/u, "").replace(/[\s.]+$/u, "");

export function sanitizeFilename(input: string): string {
  const last = input.split(/[\\/]/).pop() ?? "";
  let name = trimEnds(last.replace(INVISIBLE, "").replace(RESERVED, ""));
  if (!name) return FALLBACK;
  if (WINDOWS_RESERVED.test(name.split(".")[0])) name = `_${name}`;
  if (byteLength(name) > MAX_NAME_BYTES) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    if (ext && byteLength(ext) <= 20) {
      const base = trimEnds(truncateBytes(name.slice(0, dot), MAX_NAME_BYTES - byteLength(ext)));
      name = base ? base + ext : trimEnds(truncateBytes(name, MAX_NAME_BYTES));
    } else {
      name = trimEnds(truncateBytes(name, MAX_NAME_BYTES));
    }
  }
  return name || FALLBACK;
}

export const RISKY_EXTENSIONS: ReadonlySet<string> = new Set(
  (
    "exe msi bat cmd com scr pif cpl ps1 psm1 vbs vbe js jse mjs wsf wsh hta jar apk appx msix app dmg pkg deb rpm " +
    "sh bash zsh command run bin elf lnk url reg inf scf iso img vhd html htm xhtml mht svg xml docm xlsm pptm dotm xlam"
  ).split(" "),
);

/** Whether the last extension of `name` can run code when opened. */
export function isRiskyExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return RISKY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase().trim());
}

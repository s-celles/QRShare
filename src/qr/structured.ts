export type StructuredQR =
  | {
      kind: "wifi";
      ssid: string;
      security: "WPA" | "WEP" | "nopass";
      password?: string;
      hidden?: boolean;
      raw: string;
    }
  | {
      kind: "contact";
      format: "mecard" | "vcard";
      firstName?: string;
      lastName?: string;
      fullName: string;
      phone?: string;
      email?: string;
      org?: string;
      url?: string;
      note?: string;
      raw: string;
    }
  | {
      kind: "url";
      url: string;
      raw: string;
    }
  | {
      kind: "text";
      raw: string;
    };

/**
 * Escapes special characters for Wi-Fi and MECARD strings (\, ;, :, ,, ").
 */
function escapeSpecialChars(str: string): string {
  return str.replace(/([\\;:,""])/g, "\\$1");
}

/**
 * Unescapes characters escaped with backslash (\).
 */
function unescapeSpecialChars(str: string): string {
  return str.replace(/\\(.)/g, "$1");
}

/**
 * Builds a standard Wi-Fi QR string: WIFI:S:<ssid>;T:<type>;P:<password>;H:<hidden>;;
 */
export function buildWifiString(params: {
  ssid: string;
  security: "WPA" | "WEP" | "nopass";
  password?: string;
  hidden?: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`S:${escapeSpecialChars(params.ssid)}`);
  parts.push(`T:${params.security}`);
  if (params.security !== "nopass" && params.password) {
    parts.push(`P:${escapeSpecialChars(params.password)}`);
  }
  if (params.hidden) {
    parts.push("H:true");
  }
  return "WIFI:" + parts.join(";") + ";;";
}

/**
 * Parses a Wi-Fi QR string (WIFI:S:...;;).
 */
export function parseWifiString(raw: string): StructuredQR | null {
  const trimmed = raw.trim();
  if (!/^WIFI:/i.test(trimmed)) return null;

  const content = trimmed.substring(5).replace(/;;$/, "");
  // Parse semicolon-separated key:value pairs taking escaped semicolons into account
  const tokens: string[] = [];
  let current = "";
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      current += char;
      escaped = true;
    } else if (char === ";") {
      tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  let ssid = "";
  let security: "WPA" | "WEP" | "nopass" = "WPA";
  let password: string | undefined = undefined;
  let hidden = false;

  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx === -1) continue;
    const key = token.substring(0, colonIdx).toUpperCase();
    const value = unescapeSpecialChars(token.substring(colonIdx + 1));

    if (key === "S") {
      ssid = value;
    } else if (key === "T") {
      const secUpper = value.toUpperCase();
      if (secUpper === "WEP") security = "WEP";
      else if (secUpper === "NOPASS" || secUpper === "NONE") security = "nopass";
      else security = "WPA";
    } else if (key === "P") {
      password = value;
    } else if (key === "H") {
      hidden = value.toLowerCase() === "true" || value === "1";
    }
  }

  if (!ssid) return null;

  return {
    kind: "wifi",
    ssid,
    security,
    password,
    hidden,
    raw,
  };
}

/**
 * Builds a MECARD contact string: MECARD:N:LastName,FirstName;TEL:...;;
 */
export function buildMecardString(params: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  org?: string;
  url?: string;
  note?: string;
}): string {
  const parts: string[] = [];

  const nameParts: string[] = [];
  if (params.lastName) nameParts.push(escapeSpecialChars(params.lastName));
  if (params.firstName) {
    if (nameParts.length === 0) nameParts.push("");
    nameParts.push(escapeSpecialChars(params.firstName));
  }
  if (nameParts.length > 0) {
    parts.push(`N:${nameParts.join(",")}`);
  }

  if (params.phone) parts.push(`TEL:${escapeSpecialChars(params.phone)}`);
  if (params.email) parts.push(`EMAIL:${escapeSpecialChars(params.email)}`);
  if (params.org) parts.push(`ORG:${escapeSpecialChars(params.org)}`);
  if (params.url) parts.push(`URL:${escapeSpecialChars(params.url)}`);
  if (params.note) parts.push(`NOTE:${escapeSpecialChars(params.note)}`);

  return "MECARD:" + parts.join(";") + ";;";
}

/**
 * Builds a vCard 3.0 contact string: BEGIN:VCARD...END:VCARD
 */
export function buildVCardString(params: {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  org?: string;
  url?: string;
  note?: string;
}): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  const last = params.lastName || "";
  const first = params.firstName || "";
  lines.push(`N:${last};${first};;;`);

  const fn = [first, last].filter(Boolean).join(" ");
  lines.push(`FN:${fn || "Contact"}`);

  if (params.phone) lines.push(`TEL:${params.phone}`);
  if (params.email) lines.push(`EMAIL:${params.email}`);
  if (params.org) lines.push(`ORG:${params.org}`);
  if (params.url) lines.push(`URL:${params.url}`);
  if (params.note) lines.push(`NOTE:${params.note}`);

  lines.push("END:VCARD");
  return lines.join("\n");
}

/**
 * Parses a MECARD or vCard string into a StructuredQR contact payload.
 */
export function parseContactString(raw: string): StructuredQR | null {
  const trimmed = raw.trim();

  if (/^MECARD:/i.test(trimmed)) {
    const content = trimmed.substring(7).replace(/;;$/, "");
    const tokens: string[] = [];
    let current = "";
    let escaped = false;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (escaped) {
        current += char;
        escaped = false;
      } else if (char === "\\") {
        current += char;
        escaped = true;
      } else if (char === ";") {
        tokens.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    if (current) tokens.push(current);

    let firstName: string | undefined;
    let lastName: string | undefined;
    let phone: string | undefined;
    let email: string | undefined;
    let org: string | undefined;
    let url: string | undefined;
    let note: string | undefined;

    for (const token of tokens) {
      const colonIdx = token.indexOf(":");
      if (colonIdx === -1) continue;
      const key = token.substring(0, colonIdx).toUpperCase();
      const val = unescapeSpecialChars(token.substring(colonIdx + 1));

      if (key === "N") {
        const nameParts = val.split(",");
        if (nameParts.length >= 2) {
          lastName = nameParts[0].trim() || undefined;
          firstName = nameParts[1].trim() || undefined;
        } else if (nameParts.length === 1) {
          lastName = nameParts[0].trim() || undefined;
        }
      } else if (key === "TEL") {
        phone = val;
      } else if (key === "EMAIL") {
        email = val;
      } else if (key === "ORG") {
        org = val;
      } else if (key === "URL") {
        url = val;
      } else if (key === "NOTE") {
        note = val;
      }
    }

    const fullName = [firstName, lastName].filter(Boolean).join(" ") || lastName || firstName || "Contact";

    return {
      kind: "contact",
      format: "mecard",
      firstName,
      lastName,
      fullName,
      phone,
      email,
      org,
      url,
      note,
      raw,
    };
  }

  if (/^BEGIN:VCARD/i.test(trimmed)) {
    const lines = trimmed.split(/\r?\n/);
    let firstName: string | undefined;
    let lastName: string | undefined;
    let fullName: string | undefined;
    let phone: string | undefined;
    let email: string | undefined;
    let org: string | undefined;
    let url: string | undefined;
    let note: string | undefined;

    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const keyPart = line.substring(0, colonIdx).toUpperCase();
      const key = keyPart.split(";")[0]; // ignore parameters like TEL;TYPE=CELL
      const val = line.substring(colonIdx + 1).trim();

      if (key === "N") {
        const parts = val.split(";");
        lastName = parts[0] ? parts[0].trim() : undefined;
        firstName = parts[1] ? parts[1].trim() : undefined;
      } else if (key === "FN") {
        fullName = val;
      } else if (key === "TEL") {
        phone = val;
      } else if (key === "EMAIL") {
        email = val;
      } else if (key === "ORG") {
        org = val;
      } else if (key === "URL") {
        url = val;
      } else if (key === "NOTE") {
        note = val;
      }
    }

    const derivedFullName = fullName || [firstName, lastName].filter(Boolean).join(" ") || "Contact";

    return {
      kind: "contact",
      format: "vcard",
      firstName,
      lastName,
      fullName: derivedFullName,
      phone,
      email,
      org,
      url,
      note,
      raw,
    };
  }

  return null;
}

/**
 * Main parser entry point for analyzing scanned/input text strings.
 */
export function parseStructuredQR(raw: string): StructuredQR {
  const trimmed = raw.trim();

  if (/^WIFI:/i.test(trimmed)) {
    const wifi = parseWifiString(trimmed);
    if (wifi) return wifi;
  }

  if (/^(MECARD:|BEGIN:VCARD)/i.test(trimmed)) {
    const contact = parseContactString(trimmed);
    if (contact) return contact;
  }

  try {
    const parsedUrl = new URL(trimmed);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return { kind: "url", url: trimmed, raw };
    }
  } catch {
    // Not a valid URL
  }

  return { kind: "text", raw };
}

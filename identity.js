import { generateName } from "@scelles/unique-names-generator";
import { ADJECTIVES, ANIMALS, COLORS } from "@scelles/unique-names-generator/dictionaries";
/**
 * Display colours for the colour words of the name dictionary, deep enough to
 * be readable as text and caret colour on a light background.
 */
const COLOR_HEX = {
    Crimson: "#b8173a", Azure: "#1f6fd1", Emerald: "#14895a", Golden: "#a87400", Silver: "#6b7480",
    Coral: "#d4553f", Violet: "#7a3fc4", Jade: "#00876a", Amber: "#b86e00", Sapphire: "#1c4fa8",
    Ruby: "#b3123f", Onyx: "#353a40", Pearl: "#7b7f8a", Cobalt: "#1d4fb8", Scarlet: "#c9281c",
    Ivory: "#8a7d5e", Magenta: "#b5178f", Indigo: "#4a3aa7", Bronze: "#8c5a1f", Turquoise: "#0f8a8f",
    Copper: "#a8521f", Lavender: "#7c5cc4", Chartreuse: "#5f8a00", Vermillion: "#d0401f", Teal: "#0b7a7a",
    Ochre: "#a46a10", Plum: "#7e2f74", Slate: "#4f5d6e", Aqua: "#0a8aa8", Maroon: "#7f1d2d",
    Olive: "#6b6b12", Burgundy: "#7d1838", Tangerine: "#d06400", Mint: "#1a8f68", Navy: "#1f2f73",
    Champagne: "#8f7442", Salmon: "#c95a48", Forest: "#2a6b2f", Citrine: "#9a7f00", Pewter: "#5f6670",
    Flamingo: "#d04f7f", Cerulean: "#1a78b5", Saffron: "#bf7a00", Amethyst: "#8046b8", Topaz: "#b5781a",
    Garnet: "#8f1f2a", Platinum: "#6e747c", Orchid: "#a8459e", Peach: "#c96a3a", Rose: "#c53a6a",
};
const FALLBACK = "#2a78d6";
/** The colour matching the colour word of a compound name. */
export function colorOf(name) {
    for (const word of name.split(/\s+/)) {
        const hex = COLOR_HEX[word[0]?.toUpperCase() + word.slice(1).toLowerCase()];
        if (hex)
            return hex;
    }
    return FALLBACK;
}
/** A random (or seeded) identity: adjective + colour + animal. */
export function createIdentity(seed) {
    const name = generateName([ADJECTIVES, COLORS, ANIMALS], {
        style: "capital",
        ...(seed !== undefined ? { seed } : {}),
    });
    return { name, color: colorOf(name) };
}
/**
 * The identity remembered on this device under `key` (created on first use).
 * Falls back to a fresh identity when storage is unavailable.
 */
export function loadIdentity(key = "collab.identity") {
    try {
        const raw = globalThis.localStorage?.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (typeof parsed.name === "string" && parsed.name.trim()) {
                const name = parsed.name.trim().slice(0, 60);
                return { name, color: typeof parsed.color === "string" && /^#[0-9a-f]{6}$/i.test(parsed.color) ? parsed.color : colorOf(name) };
            }
        }
    }
    catch {
        /* corrupted or blocked storage */
    }
    const identity = createIdentity();
    saveIdentity(identity, key);
    return identity;
}
export function saveIdentity(identity, key = "collab.identity") {
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(identity));
    }
    catch {
        /* storage unavailable: the identity lives for this session only */
    }
}

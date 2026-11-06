import { readFileSync } from "fs";
import { join } from "path";

const dir = join(import.meta.dir, "fixtures");
export const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
export const FX = JSON.parse(readFileSync(join(dir, "fixtures.json"), "utf8")) as Record<string, string>;
export const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

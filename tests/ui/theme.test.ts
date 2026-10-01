import { describe, expect, it } from "bun:test";
import { nextTheme, resolveTheme } from "@/ui/theme";

describe("theme preference: system / light / dark", () => {
  it("cycles auto (system) → light → dark → auto", () => {
    expect(nextTheme("auto")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("auto");
  });

  it("follows the system only in auto mode", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

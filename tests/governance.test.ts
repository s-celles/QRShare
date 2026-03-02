import { describe, expect, it } from "bun:test";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");

describe("repository governance files", () => {
  it("has LICENSE file with GPL-3.0 text", async () => {
    const license = await Bun.file(resolve(root, "LICENSE")).text();
    expect(license).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3");
  });

  it("has SECURITY.md with vulnerability reporting instructions", async () => {
    const security = await Bun.file(resolve(root, "SECURITY.md")).text();
    expect(security).toContain("Security Policy");
    expect(security).toContain("Reporting a Vulnerability");
    expect(security).toContain("Security Advisories");
  });
});

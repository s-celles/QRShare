import { describe, expect, it } from "bun:test";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");

describe("repository governance files", () => {
  it("has LICENSE file with BSD-3-Clause text", async () => {
    const license = await Bun.file(resolve(root, "LICENSE")).text();
    expect(license).toContain("BSD 3-Clause License");
    expect(license).toContain("Neither the name of the copyright holder");
  });

  it("has SECURITY.md with vulnerability reporting instructions", async () => {
    const security = await Bun.file(resolve(root, "SECURITY.md")).text();
    expect(security).toContain("Security Policy");
    expect(security).toContain("Reporting a Vulnerability");
    expect(security).toContain("Security Advisories");
  });
});

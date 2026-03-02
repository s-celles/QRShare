import { describe, test, expect, beforeEach } from "bun:test";
import { ShareService, type ShareResult } from "@/share/service";

describe("ShareService", () => {
  let service: ShareService;

  beforeEach(() => {
    service = new ShareService();
  });

  test("isShareSupported returns boolean", () => {
    const result = service.isShareSupported();
    expect(typeof result).toBe("boolean");
  });

  test("canShareFiles returns boolean", () => {
    const result = service.canShareFiles();
    expect(typeof result).toBe("boolean");
  });

  test("shareFile returns unsupported when navigator.share is unavailable", async () => {
    // In Bun test environment, navigator.share is not available
    const file = new File(["hello"], "test.txt", { type: "text/plain" });
    const result = await service.shareFile(file);
    expect(result.kind).toBe("unsupported");
  });

  test("ShareResult kind types are correctly discriminated", () => {
    const shared: ShareResult = { kind: "shared" };
    const cancelled: ShareResult = { kind: "cancelled" };
    const unsupported: ShareResult = { kind: "unsupported" };
    const fallback: ShareResult = { kind: "fallback_url", url: "blob:http://example.com/123" };

    expect(shared.kind).toBe("shared");
    expect(cancelled.kind).toBe("cancelled");
    expect(unsupported.kind).toBe("unsupported");
    expect(fallback.kind).toBe("fallback_url");
    if (fallback.kind === "fallback_url") {
      expect(fallback.url).toContain("blob:");
    }
  });
});

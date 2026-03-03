import { describe, expect, it } from "bun:test";
import {
  renderQRCustom,
  renderQRCustomToDataURL,
  getByteCapacity,
  getByteCapacityTable,
  getPresetConfig,
  getMaxPayloadBytes,
  renderQR,
} from "@/qr/renderer";

describe("Custom QR Renderer", () => {
  describe("getByteCapacity", () => {
    it("returns correct capacity for version 1 ECC L", () => {
      expect(getByteCapacity(1, "L")).toBe(17);
    });

    it("returns correct capacity for version 1 ECC H", () => {
      expect(getByteCapacity(1, "H")).toBe(7);
    });

    it("returns correct capacity for version 40 ECC L", () => {
      expect(getByteCapacity(40, "L")).toBe(2953);
    });

    it("returns correct capacity for version 20 ECC M", () => {
      expect(getByteCapacity(20, "M")).toBe(666);
    });

    it("higher versions have higher capacity for same ECC", () => {
      expect(getByteCapacity(10, "M")).toBeGreaterThan(getByteCapacity(5, "M"));
    });

    it("lower ECC has higher capacity for same version", () => {
      const v10L = getByteCapacity(10, "L");
      const v10M = getByteCapacity(10, "M");
      const v10Q = getByteCapacity(10, "Q");
      const v10H = getByteCapacity(10, "H");
      expect(v10L).toBeGreaterThan(v10M);
      expect(v10M).toBeGreaterThan(v10Q);
      expect(v10Q).toBeGreaterThan(v10H);
    });
  });

  describe("getByteCapacityTable", () => {
    it("returns a table with all four ECC levels", () => {
      const table = getByteCapacityTable();
      expect(table.L).toBeDefined();
      expect(table.M).toBeDefined();
      expect(table.Q).toBeDefined();
      expect(table.H).toBeDefined();
    });

    it("each level has 41 entries (index 0-40)", () => {
      const table = getByteCapacityTable();
      expect(table.L.length).toBe(41);
      expect(table.M.length).toBe(41);
      expect(table.Q.length).toBe(41);
      expect(table.H.length).toBe(41);
    });

    it("index 0 is always 0 (no version 0)", () => {
      const table = getByteCapacityTable();
      expect(table.L[0]).toBe(0);
      expect(table.H[0]).toBe(0);
    });
  });

  describe("renderQRCustom", () => {
    it("generates QR with auto version", () => {
      const data = new TextEncoder().encode("Hello");
      const bitmap = renderQRCustom(data, { eccLevel: "M", autoVersion: true });
      expect(bitmap.size).toBeGreaterThan(0);
    });

    it("generates QR with manual version", () => {
      const data = new TextEncoder().encode("Hi");
      const bitmap = renderQRCustom(data, {
        eccLevel: "L",
        autoVersion: false,
        manualVersion: 10,
      });
      expect(bitmap.size).toBeGreaterThan(0);
    });

    it("generates QR with ECC H", () => {
      const data = new TextEncoder().encode("Test");
      const bitmap = renderQRCustom(data, { eccLevel: "H", autoVersion: true });
      expect(bitmap.size).toBeGreaterThan(0);
    });

    it("throws when data exceeds capacity for manual version", () => {
      const data = new Uint8Array(100); // 100 bytes, version 1 ECC H max is 7
      expect(() =>
        renderQRCustom(data, {
          eccLevel: "H",
          autoVersion: false,
          manualVersion: 1,
        }),
      ).toThrow();
    });
  });

  describe("renderQRCustomToDataURL", () => {
    // toDataURL requires a DOM canvas (document), skipped in headless test env
    it.skip("returns a PNG data URL (requires DOM)", () => {
      const data = new TextEncoder().encode("Hello World");
      const url = renderQRCustomToDataURL(data, {
        eccLevel: "M",
        autoVersion: true,
      });
      expect(url).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe("backward compatibility", () => {
    it("existing preset functions still work", () => {
      const config = getPresetConfig("balanced");
      expect(config.maxVersion).toBe(20);
      expect(config.correctionLabel).toBe("M");

      const maxBytes = getMaxPayloadBytes("balanced");
      expect(maxBytes).toBe(666);

      const bitmap = renderQR(new Uint8Array([1, 2, 3]), "balanced");
      expect(bitmap.size).toBeGreaterThan(0);
    });
  });
});

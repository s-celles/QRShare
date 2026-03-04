import { describe, expect, it } from "bun:test";
import {
  getPresetConfig,
  getMaxPayloadBytes,
  renderQR,
  type EncodingPreset,
} from "@/qr/renderer";

describe("QR Renderer Service", () => {
  describe("preset configurations", () => {
    it("high_speed: version 25, ECC L, 2 FPS", () => {
      const config = getPresetConfig("high_speed");
      expect(config.maxVersion).toBe(25);
      expect(config.correctionLabel).toBe("L");
      expect(config.targetFps).toBe(2);
    });

    it("balanced: version 20, ECC M, 2 FPS", () => {
      const config = getPresetConfig("balanced");
      expect(config.maxVersion).toBe(20);
      expect(config.correctionLabel).toBe("M");
      expect(config.targetFps).toBe(2);
    });

    it("high_reliability: version 15, ECC Q, 2 FPS", () => {
      const config = getPresetConfig("high_reliability");
      expect(config.maxVersion).toBe(15);
      expect(config.correctionLabel).toBe("Q");
      expect(config.targetFps).toBe(2);
    });
  });

  describe("max payload calculation", () => {
    it("high_speed allows the most bytes", () => {
      const hs = getMaxPayloadBytes("high_speed");
      const bal = getMaxPayloadBytes("balanced");
      const hr = getMaxPayloadBytes("high_reliability");
      expect(hs).toBeGreaterThan(bal);
      expect(bal).toBeGreaterThan(hr);
    });

    it("returns positive values for all presets", () => {
      const presets: EncodingPreset[] = [
        "high_speed",
        "balanced",
        "high_reliability",
      ];
      for (const preset of presets) {
        expect(getMaxPayloadBytes(preset)).toBeGreaterThan(0);
      }
    });
  });

  describe("QR rendering", () => {
    it("renders binary data with balanced preset", () => {
      const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const bitmap = renderQR(data, "balanced");
      expect(bitmap.size).toBeGreaterThan(0);
    });

    it("renders larger payloads with high_speed preset", () => {
      const data = new Uint8Array(500);
      for (let i = 0; i < 500; i++) data[i] = i % 256;
      const bitmap = renderQR(data, "high_speed");
      expect(bitmap.size).toBeGreaterThan(0);
    });

    it("QR dimensions increase with version", () => {
      const small = renderQR(new Uint8Array([1]), "high_reliability");
      const large = renderQR(new Uint8Array(200), "high_speed");
      // A larger payload should produce a larger QR
      expect(large.size).toBeGreaterThanOrEqual(small.size);
    });
  });
});

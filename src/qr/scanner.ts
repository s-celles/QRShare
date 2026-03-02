export interface QRScanResult {
  data: Uint8Array;
  points: ReadonlyArray<{ x: number; y: number }>;
}

export interface QRScannerService {
  init(): Promise<void>;
  scan(imageData: ImageData): Promise<QRScanResult | null>;
  destroy(): void;
}

/**
 * QR Scanner using @undecaf/zbar-wasm.
 * Designed to run in a Web Worker environment.
 */
export class ZBarQRScanner implements QRScannerService {
  private zbarModule: typeof import("@undecaf/zbar-wasm") | null = null;

  async init(): Promise<void> {
    this.zbarModule = await import("@undecaf/zbar-wasm");
  }

  async scan(imageData: ImageData): Promise<QRScanResult | null> {
    if (!this.zbarModule) throw new Error("Scanner not initialized");

    const symbols = await this.zbarModule.scanImageData(imageData);

    if (symbols.length === 0) return null;

    const first = symbols[0];
    // ZBarSymbol.data is Int8Array containing raw binary data
    const data = new Uint8Array(first.data.buffer, first.data.byteOffset, first.data.byteLength);

    const points = first.points.map((p) => ({
      x: p.x,
      y: p.y,
    }));

    return { data, points };
  }

  destroy(): void {
    this.zbarModule = null;
  }
}

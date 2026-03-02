export type ShareResult =
  | { kind: "shared" }
  | { kind: "cancelled" }
  | { kind: "unsupported" }
  | { kind: "fallback_url"; url: string };

export class ShareService {
  isShareSupported(): boolean {
    return typeof navigator !== "undefined" && "share" in navigator;
  }

  canShareFiles(): boolean {
    if (!this.isShareSupported()) return false;
    try {
      const testFile = new File([""], "test", { type: "application/octet-stream" });
      return navigator.canShare?.({ files: [testFile] }) ?? false;
    } catch {
      return false;
    }
  }

  async shareFile(file: File): Promise<ShareResult> {
    if (!this.isShareSupported()) {
      return { kind: "unsupported" };
    }

    // Try file sharing first
    if (this.canShareFiles()) {
      try {
        await navigator.share({ files: [file] });
        return { kind: "shared" };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return { kind: "cancelled" };
        }
        // Fall through to URL fallback
      }
    }

    // Fallback: share blob URL as text
    try {
      const blob = new Blob([file], { type: file.type || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      await navigator.share({
        title: file.name,
        text: `File: ${file.name}`,
        url,
      });
      return { kind: "shared" };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { kind: "cancelled" };
      }
      return { kind: "unsupported" };
    }
  }
}

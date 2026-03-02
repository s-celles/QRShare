import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import { navigate } from "../router";
import { renderQRToDataURL } from "@/qr/renderer";

const siteQR = signal<string | null>(null);

export function About() {
  useEffect(() => {
    // Generate QR code pointing to the deployed site
    const siteUrl = window.location.origin + window.location.pathname;
    const urlBytes = new TextEncoder().encode(siteUrl);
    siteQR.value = renderQRToDataURL(urlBytes, "balanced");
  }, []);

  return (
    <section aria-label="About QRShare">
      <div class="view-header">
        <button onClick={() => navigate("/")} aria-label="Back to home">
          &larr; Back
        </button>
        <h2>About</h2>
      </div>

      <div class="about-content">
        {siteQR.value && (
          <div class="qr-display">
            <img
              src={siteQR.value}
              alt="QR code linking to QRShare"
              class="qr-image"
            />
          </div>
        )}

        <p class="about-description">
          Scan this QR code to open QRShare on another device.
        </p>

        <div class="about-info">
          <p><strong>QRShare</strong> v0.1.0</p>
          <p>Air-gapped file transfer via animated QR codes with fountain codes, plus WebRTC P2P mode.</p>
          <p>License: GPL-3.0-or-later</p>
          <p>
            <a
              href="https://github.com/s-celles/QRShare"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source code on GitHub
            </a>
          </p>
        </div>

        <div class="about-disclaimer">
          <p>
            <strong>Disclaimer:</strong> QRShare is intended for lawful file sharing only.
            Do not use this tool to transfer illegal, harmful, or copyrighted content
            without proper authorization. Users are solely responsible for the content
            they share. The authors assume no liability for misuse.
          </p>
        </div>
      </div>
    </section>
  );
}

import { navigate } from "../router";

export function Landing() {
  return (
    <section class="landing" aria-label="Transfer mode selection">
      <h2>Choose Transfer Mode</h2>
      <div class="mode-grid" role="group" aria-label="Transfer modes">
        <button
          class="mode-btn"
          onClick={() => navigate("/send/qr")}
          aria-label="Send file via QR code"
        >
          <span class="mode-icon" aria-hidden="true">
            &#x25A3;
          </span>
          <span class="mode-label">Send (QR)</span>
          <span class="mode-desc">Air-gapped optical transfer</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/receive/qr")}
          aria-label="Receive file via QR code"
        >
          <span class="mode-icon" aria-hidden="true">
            &#x25A2;
          </span>
          <span class="mode-label">Receive (QR)</span>
          <span class="mode-desc">Scan animated QR codes</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/send/webrtc")}
          aria-label="Send file via WebRTC"
        >
          <span class="mode-icon" aria-hidden="true">
            &#x21C6;
          </span>
          <span class="mode-label">Send (WebRTC)</span>
          <span class="mode-desc">P2P network transfer</span>
        </button>

        <button
          class="mode-btn"
          onClick={() => navigate("/receive/webrtc")}
          aria-label="Receive file via WebRTC"
        >
          <span class="mode-icon" aria-hidden="true">
            &#x21C4;
          </span>
          <span class="mode-label">Receive (WebRTC)</span>
          <span class="mode-desc">P2P network receive</span>
        </button>
      </div>
    </section>
  );
}

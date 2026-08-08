import { useEffect, useState } from "preact/hooks";
import { localDiscovery, type DiscoveredPeer } from "@/webrtc/discovery";
import { navigate } from "../router";
import { pendingFile } from "../shared-file";
import { t } from "../i18n";

export function NearbyDevices() {
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);

  useEffect(() => {
    localDiscovery.start();
    const update = () => setPeers([...localDiscovery.peers.value]);
    update();

    const timer = setInterval(update, 2000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (!localDiscovery.enabled.value) return null;

  const handleSendToPeer = (peer: DiscoveredPeer) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const buffer = await file.arrayBuffer();
      pendingFile.value = {
        buffer,
        filename: file.name,
      };
      // Initiate WebRTC direct transfer room with target peer
      navigate(`/send/webrtc?peer=${peer.id}`);
    };
    input.click();
  };

  return (
    <div class="nearby-devices-card structured-card">
      <div class="card-header">
        <h3 class="nearby-title">🌐 {t("discovery.title")}</h3>
      </div>

      {peers.length === 0 ? (
        <p class="settings-hint">{t("discovery.scanning")}</p>
      ) : (
        <div class="peers-list">
          {peers.map((peer) => (
            <div class="peer-item" key={peer.id}>
              <div class="peer-info">
                <span class="peer-icon">
                  {peer.deviceType === "mobile" ? "📱" : peer.deviceType === "tablet" ? "📱" : "💻"}
                </span>
                <div class="peer-details">
                  <strong class="peer-name">{peer.name}</strong>
                  <span class="peer-status-badge">🟢 Online</span>
                </div>
              </div>
              <button
                class="start-btn share-action peer-send-btn"
                onClick={() => handleSendToPeer(peer)}
              >
                {t("discovery.sendDirect")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

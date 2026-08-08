import { useEffect, useState } from "preact/hooks";
import { localDiscovery, type DiscoveredPeer, type LocalDiscoveryMode } from "@/webrtc/discovery";
import { navigate } from "../router";
import { pendingFile } from "../shared-file";
import { t } from "../i18n";

export function NearbyDevices() {
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  const [currentMode, setCurrentMode] = useState<LocalDiscoveryMode>(localDiscovery.mode.value);

  useEffect(() => {
    if (currentMode !== "off") {
      localDiscovery.start();
    } else {
      localDiscovery.stop();
    }
    const update = () => {
      setCurrentMode(localDiscovery.mode.value);
      setPeers([...localDiscovery.peers.value]);
    };
    update();

    const timer = setInterval(update, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [currentMode]);

  // Mode OFF: completely hidden from home screen (default)
  if (currentMode === "off") {
    return null;
  }

  const handleSetMode = (mode: LocalDiscoveryMode) => {
    localDiscovery.setMode(mode);
    setCurrentMode(mode);
  };

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
      const transferRoomId = Math.random().toString(36).substring(2, 10);
      void localDiscovery.sendOffer(peer.id, {
        transferId: transferRoomId,
        filename: file.name,
        size: file.size,
        isText: false,
      });
      navigate(`/send/webrtc?room=${transferRoomId}`);
    };
    input.click();
  };

  return (
    <div class="nearby-devices-card structured-card">
      <div class="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 class="nearby-title">🌐 {t("discovery.title")}</h3>
        <div class="mode-toggle-group" style={{ display: "flex", gap: "0.25rem" }}>
          <button
            class={`icon-btn-text ${currentMode === "passive" ? "active-mode-btn" : ""}`}
            onClick={() => handleSetMode("passive")}
            title={t("discovery.modePassive")}
          >
            🔒 {t("discovery.modePassiveShort")}
          </button>
          <button
            class={`icon-btn-text ${currentMode === "active" ? "active-mode-btn" : ""}`}
            onClick={() => handleSetMode("active")}
            title={t("discovery.modeActive")}
          >
            👁️ {t("discovery.modeActiveShort")}
          </button>
          <button
            class="icon-btn-text"
            onClick={() => handleSetMode("off")}
            title={t("discovery.modeOff")}
          >
            ✖️
          </button>
        </div>
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

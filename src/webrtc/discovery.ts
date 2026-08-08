import { signal, computed } from "@preact/signals";
import type { Room } from "trystero";
import { buildRoomConfig, ensureMqttDefaults } from "./settings";
import { getAdapter, type StrategyAdapter } from "./strategies";
import { buildJoinConfig } from "./service";

export type DeviceType = "desktop" | "mobile" | "tablet";
export type LocalDiscoveryMode = "off" | "passive" | "active";

export interface DiscoveredPeer {
  [key: string]: any;
  id: string;
  name: string;
  deviceType: DeviceType;
  lastSeen: number;
}

export interface TransferOffer {
  [key: string]: any;
  transferId: string;
  senderId: string;
  senderName: string;
  filename: string;
  size: number;
  isText: boolean;
  sha256?: string;
  isEncrypted?: boolean;
}

export type DiscoveryAction =
  | { [key: string]: any; type: "announce"; name: string; deviceType: DeviceType }
  | { [key: string]: any; type: "heartbeat"; name: string; deviceType: DeviceType }
  | { [key: string]: any; type: "transfer-offer"; offer: TransferOffer }
  | { [key: string]: any; type: "transfer-response"; transferId: string; accepted: boolean };

export function detectDeviceType(): DeviceType {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

export function getDefaultDeviceName(): string {
  if (typeof navigator === "undefined") return "QRShare Peer";
  const ua = navigator.userAgent;
  let browser = "Browser";
  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/")) browser = "Safari";

  let os = "Device";
  if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

  return `${browser} on ${os}`;
}

const DISCOVERY_ROOM_ID = "qrshare-local-discovery-v1";
const HEARTBEAT_INTERVAL_MS = 10000;
const PEER_TIMEOUT_MS = 25000;

export class LocalDiscoveryService {
  public peers = signal<DiscoveredPeer[]>([]);
  public activeOffers = signal<TransferOffer[]>([]);
  public mode = signal<LocalDiscoveryMode>("off");
  public enabled = computed(() => this.mode.value !== "off");
  public deviceName = signal<string>(getDefaultDeviceName());
  public myPeerId = signal<string>("");

  private rooms: Room[] = [];
  private sendActions: ((data: DiscoveryAction, targetPeerId?: string) => void)[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private pendingResolvers = new Map<string, (accepted: boolean) => void>();

  constructor() {
    this.loadSettings();
  }

  private loadSettings() {
    try {
      const savedName = localStorage.getItem("qrshare_device_name");
      if (savedName) this.deviceName.value = savedName;

      const savedMode = localStorage.getItem("qrshare_discovery_mode") as LocalDiscoveryMode | null;
      if (savedMode === "off" || savedMode === "passive" || savedMode === "active") {
        this.mode.value = savedMode;
      } else {
        // Default mode is OFF (privacy-first, does not show on home screen)
        this.mode.value = "off";
      }
    } catch {
      // localStorage unavailable
    }
  }

  public setDeviceName(name: string) {
    this.deviceName.value = name.trim() || getDefaultDeviceName();
    try {
      localStorage.setItem("qrshare_device_name", this.deviceName.value);
    } catch {
      /* ignore */
    }
    if (this.mode.value === "active") {
      this.announce();
    }
  }

  public setMode(newMode: LocalDiscoveryMode) {
    this.mode.value = newMode;
    try {
      localStorage.setItem("qrshare_discovery_mode", newMode);
    } catch {
      /* ignore */
    }
    if (newMode === "off") {
      this.stop();
    } else {
      void this.start();
    }
  }

  public setEnabled(val: boolean) {
    this.setMode(val ? "active" : "off");
  }

  public async start() {
    if (this.mode.value === "off") return;

    if (this.rooms.length === 0) {
      try {
        await ensureMqttDefaults();
        const roomConfig = buildRoomConfig();
        const adapters: StrategyAdapter[] = [];

        const strategies = roomConfig.strategies || ["nostr", "torrent", "mqtt"];
        for (const name of strategies) {
          try {
            const adapter = await getAdapter(name);
            adapters.push(adapter);
          } catch {
            /* ignore unsupported strategy */
          }
        }

        const newRooms: Room[] = [];
        const newSenders: ((data: DiscoveryAction, targetPeerId?: string) => void)[] = [];

        for (const adapter of adapters) {
          try {
            const joinConfig = buildJoinConfig(roomConfig, adapter, DISCOVERY_ROOM_ID);
            const room = adapter.joinRoom(joinConfig, DISCOVERY_ROOM_ID);
            const [send, get] = room.makeAction<DiscoveryAction>("disc");

            room.onPeerJoin((peerId) => {
              if (this.mode.value === "active") {
                send({
                  type: "announce",
                  name: this.deviceName.value,
                  deviceType: detectDeviceType(),
                }, peerId);
              }
            });

            room.onPeerLeave((peerId) => {
              this.peers.value = this.peers.value.filter((p) => p.id !== peerId);
            });

            get((data: DiscoveryAction, peerId: string) => {
              this.handleMessage(data, peerId);
            });

            newRooms.push(room);
            newSenders.push(send);
          } catch (err) {
            console.warn(`[discovery] Strategy ${adapter.name} failed to join:`, err);
          }
        }

        this.rooms = newRooms;
        this.sendActions = newSenders;
      } catch (err) {
        console.warn("[discovery] Failed to initialize discovery rooms:", err);
        return;
      }
    }

    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => {
        this.pruneStalePeers();
      }, 5000);
    }

    if (this.mode.value === "active") {
      this.announce();
      if (!this.heartbeatTimer) {
        this.heartbeatTimer = setInterval(() => {
          this.sendHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);
      }
    } else if (this.mode.value === "passive") {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }
  }

  public stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    for (const room of this.rooms) {
      try {
        room.leave();
      } catch {
        /* ignore */
      }
    }
    this.rooms = [];
    this.sendActions = [];
    this.peers.value = [];
    this.activeOffers.value = [];
  }

  private broadcastAction(data: DiscoveryAction, targetPeerId?: string) {
    for (const send of this.sendActions) {
      try {
        send(data, targetPeerId);
      } catch {
        /* ignore individual send failures */
      }
    }
  }

  public announce() {
    if (this.mode.value !== "active") return;
    this.broadcastAction({
      type: "announce",
      name: this.deviceName.value,
      deviceType: detectDeviceType(),
    });
  }

  public sendHeartbeat() {
    if (this.mode.value !== "active") return;
    this.broadcastAction({
      type: "heartbeat",
      name: this.deviceName.value,
      deviceType: detectDeviceType(),
    });
  }

  public pruneStalePeers() {
    const now = Date.now();
    this.peers.value = this.peers.value.filter(
      (p) => now - p.lastSeen < PEER_TIMEOUT_MS,
    );
  }

  private handleMessage(msg: DiscoveryAction, peerId: string) {
    if (msg.type === "announce" || msg.type === "heartbeat") {
      const existing = this.peers.value.find((p) => p.id === peerId);
      const updated: DiscoveredPeer = {
        id: peerId,
        name: msg.name,
        deviceType: msg.deviceType,
        lastSeen: Date.now(),
      };

      if (existing) {
        this.peers.value = this.peers.value.map((p) =>
          p.id === peerId ? updated : p,
        );
      } else {
        this.peers.value = [...this.peers.value, updated];
      }
    } else if (msg.type === "transfer-offer") {
      this.activeOffers.value = [...this.activeOffers.value, msg.offer];
    } else if (msg.type === "transfer-response") {
      const resolver = this.pendingResolvers.get(msg.transferId);
      if (resolver) {
        resolver(msg.accepted);
        this.pendingResolvers.delete(msg.transferId);
      }
    }
  }

  public sendOffer(
    targetPeerId: string,
    payload: { transferId?: string; filename: string; size: number; isText: boolean; sha256?: string; isEncrypted?: boolean },
  ): Promise<boolean> {
    if (this.sendActions.length === 0) return Promise.resolve(false);

    const transferId = payload.transferId || Math.random().toString(36).substring(2, 10);
    const offer: TransferOffer = {
      transferId,
      senderId: this.myPeerId.value || "local",
      senderName: this.deviceName.value,
      filename: payload.filename,
      size: payload.size,
      isText: payload.isText,
      sha256: payload.sha256,
      isEncrypted: payload.isEncrypted,
    };

    return new Promise((resolve) => {
      this.pendingResolvers.set(transferId, resolve);
      this.broadcastAction({ type: "transfer-offer", offer }, targetPeerId);

      // 30s timeout for offer response
      setTimeout(() => {
        if (this.pendingResolvers.has(transferId)) {
          this.pendingResolvers.delete(transferId);
          resolve(false);
        }
      }, 30000);
    });
  }

  public respondToOffer(offer: TransferOffer, accepted: boolean) {
    this.broadcastAction({
      type: "transfer-response",
      transferId: offer.transferId,
      accepted,
    }, offer.senderId);

    this.activeOffers.value = this.activeOffers.value.filter(
      (o) => o.transferId !== offer.transferId,
    );
  }
}

export const localDiscovery = new LocalDiscoveryService();

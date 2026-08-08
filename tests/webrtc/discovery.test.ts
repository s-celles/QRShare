import { describe, expect, test } from "bun:test";
import {
  detectDeviceType,
  getDefaultDeviceName,
  LocalDiscoveryService,
} from "@/webrtc/discovery";

describe("Local Network Discovery Service", () => {
  test("detectDeviceType returns valid device type", () => {
    const type = detectDeviceType();
    expect(["desktop", "mobile", "tablet"]).toContain(type);
  });

  test("getDefaultDeviceName returns non-empty string", () => {
    const name = getDefaultDeviceName();
    expect(name.length).toBeGreaterThan(0);
  });

  test("LocalDiscoveryService updates device name and settings", () => {
    const discovery = new LocalDiscoveryService();
    discovery.setDeviceName("MyCustomLaptop");
    expect(discovery.deviceName.value).toBe("MyCustomLaptop");
  });

  test("prunes stale peers older than timeout threshold", () => {
    const discovery = new LocalDiscoveryService();
    const now = Date.now();

    discovery.peers.value = [
      { id: "peer1", name: "Fresh Peer", deviceType: "mobile", lastSeen: now },
      { id: "peer2", name: "Stale Peer", deviceType: "desktop", lastSeen: now - 30000 },
    ];

    discovery.pruneStalePeers();

    expect(discovery.peers.value.length).toBe(1);
    expect(discovery.peers.value[0].id).toBe("peer1");
  });

  test("handles transfer offer response cleanup", () => {
    const discovery = new LocalDiscoveryService();
    const offer = {
      transferId: "t123",
      senderId: "p1",
      senderName: "Alice",
      filename: "test.txt",
      size: 100,
      isText: true,
    };

    discovery.activeOffers.value = [offer];
    expect(discovery.activeOffers.value.length).toBe(1);

    discovery.respondToOffer(offer, false);
    expect(discovery.activeOffers.value.length).toBe(0);
  });
});

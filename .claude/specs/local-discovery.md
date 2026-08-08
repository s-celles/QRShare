# Local Network Peer Discovery

> **Status:** draft · approved  
> **Feature id:** `local-discovery`  

---

## Requirements

### Introduction

Currently, initiating a WebRTC peer-to-peer transfer in QRShare requires the sender to generate an invitation QR code and the receiver to scan it using their camera. This feature introduces **Local Network Peer Discovery**, allowing devices on the same local network (Wi-Fi or LAN) to automatically discover each other and transfer files or text with **zero QR code scanning**.

It uses serverless WebRTC peer discovery via Trystero signaling, filtering local STUN/ICE host candidates, maintaining a heartbeat-based peer registry, and presenting a **"Nearby Devices"** UI section with one-click direct transfer requests.

### Requirements

#### Requirement 1: Local Peer Presence & Heartbeat Engine (`src/webrtc/discovery.ts`)
**Objective:** Provide a background service that announces presence, tracks active nearby peers, and handles direct transfer requests without manual QR exchange.

##### Acceptance Criteria
1. QRShare shall implement a `LocalDiscoveryService` that joins a shared WebRTC discovery room (`qrshare-discovery-v1`). `[REQ-DISC-001]`
2. Each peer shall generate a unique peer ID, a human-readable device name (e.g. "Chrome on Linux", configurable in Settings), and a device type icon (`desktop` | `mobile` | `tablet`). `[REQ-DISC-002]`
3. `LocalDiscoveryService` shall broadcast periodic presence heartbeats (`ping`) every 10 seconds. `[REQ-DISC-003]`
4. If no heartbeat is received from a discovered peer for 25 seconds, `LocalDiscoveryService` shall remove the peer from the active nearby devices list. `[REQ-DISC-004]`
5. Senders shall be able to send a `transfer-offer` message directly to a target peer ID containing transfer metadata (content type, filename, size, hash, optional encryption flag). `[REQ-DISC-005]`
6. Receivers shall emit an event when a `transfer-offer` is received, allowing the user to **Accept** or **Decline** the transfer. `[REQ-DISC-006]`
7. Upon acceptance, a dedicated WebRTC DataChannel shall handle the direct payload transfer. `[REQ-DISC-007]`

#### Requirement 2: Nearby Devices UI (`NearbyDevices.tsx` & Landing Page)
**Objective:** As a user, I want to see a list of nearby devices on my local network and click to send files directly.

##### Acceptance Criteria
1. QRShare shall display a **"Nearby Devices on Local Network"** card on the landing page when local discovery is active. `[REQ-DISC-010]`
2. The UI shall display discovered devices with their device icon, custom device name, status badge ("Online"), and a **"Send"** button. `[REQ-DISC-011]`
3. Clicking **"Send"** on a nearby device shall open the file/text selector and immediately transmit a transfer offer to that device. `[REQ-DISC-012]`
4. When a transfer offer is received, a prominent notification modal shall prompt the user: **"📱 [Device Name] wants to send you [Filename] ([Size]). Accept / Decline?"**. `[REQ-DISC-013]`

#### Requirement 3: Privacy & Settings Controls
**Objective:** As a user, I want to control whether my device is visible to others on the local network.

##### Acceptance Criteria
1. QRShare Settings (`Settings.tsx`) shall include a toggle **"Enable Local Discovery"** (enabled by default). `[REQ-DISC-020]`
2. Settings shall provide an editable **"Device Name"** input field. `[REQ-DISC-021]`
3. When discovery is disabled, QRShare shall disconnect from the discovery room and hide the device from other peers. `[REQ-DISC-022]`

#### Requirement 4: Internationalization (i18n)
**Objective:** All new UI strings shall be translated into English, French, and Arabic.

##### Acceptance Criteria
1. All new translation keys shall be added to `en.ts`, `fr.ts`, and `ar.ts`. `[REQ-DISC-030]`

---

## Design

### Architecture & Protocol Messages

New module: `src/webrtc/discovery.ts`

```typescript
export interface DiscoveredPeer {
  id: string;
  name: string;
  deviceType: "desktop" | "mobile" | "tablet";
  lastSeen: number;
}

export interface TransferOffer {
  transferId: string;
  senderId: string;
  senderName: string;
  filename: string;
  size: number;
  isText: boolean;
  sha256?: string;
  isEncrypted?: boolean;
}

export type DiscoveryMessage =
  | { type: "announce"; name: string; deviceType: "desktop" | "mobile" | "tablet" }
  | { type: "heartbeat"; name: string; deviceType: "desktop" | "mobile" | "tablet" }
  | { type: "transfer-offer"; offer: TransferOffer }
  | { type: "transfer-response"; transferId: string; accepted: boolean };
```

---

## Tasks

- [ ] **Task 1: Implement `src/webrtc/discovery.ts` & Unit Tests**
  - Build `LocalDiscoveryService` for peer presence, heartbeats, and transfer offer signaling.
  - Write unit tests in `tests/webrtc/discovery.test.ts`.

- [ ] **Task 2: Add i18n Translations**
  - Add translation keys for local discovery in `en.ts`, `fr.ts`, `ar.ts`.

- [ ] **Task 3: Build `NearbyDevices.tsx` and `TransferOfferModal.tsx`**
  - Build UI component for rendering active nearby devices list.
  - Build modal for receiving and accepting/declining direct transfer offers.

- [ ] **Task 4: Integrate into Landing Page & Settings**
  - Add nearby devices section to `Landing.tsx`.
  - Add local discovery toggle and custom device name input to `Settings.tsx`.

- [ ] **Task 5: Verification & Tests**
  - Run `bun test` and `bun run typecheck`.

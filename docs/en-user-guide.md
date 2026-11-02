# QRShare — User Guide

## What is QRShare?

QRShare is a web application that lets you:

1. **Scan a QR code** using your device's camera
2. **Create a QR code** from any text or web address
3. **Share a file or text** to any app via the native share dialog
4. **Send a file or text** to another device via animated QR codes (no internet required)
5. **Send a file or text** peer-to-peer via WebRTC (internet required)
6. **Send a short text or small file** as sound, from speaker to microphone (Audio — Experimental, no internet or camera required)

The application runs directly in your browser with nothing to install. It is available at:
**https://s-celles.github.io/QRShare/**

```mermaid
flowchart TD
    Home[Home Page]
    Home --> Scan[Scan QR Code]
    Home --> Create[Create QR Code]
    Home --> SendShare[Send via Share]
    Home --> SendQR[Send via QR]
    Home --> RecvQR[Receive via QR]
    Home --> SendWR[Send via WebRTC]
    Home --> RecvWR[Receive via WebRTC]

    Scan --> |URL detected| Link[Open Link]
    Scan --> |Text detected| Copy[Copy / Share / Send]
    Create --> Download[Download PNG]
    Create --> Share[Share / Send via QR / WebRTC]
    SendShare --> |Native dialog| Apps[Other apps]
    SendQR --> |Animated QR codes| RecvQR
    SendWR --> |Peer-to-peer| RecvWR
```

---

## Home Page

When you open the application, you see two sections:

### QR Utilities (top)

Two buttons for everyday QR tools:

- **Scan QR Code** — Read a QR code with your camera
- **Create QR Code** — Generate your own QR code

### File Transfer (bottom)

Five buttons for transferring files between devices:

- **Send (Share)** — Share files via the native share dialog (messaging, email, cloud storage, etc.)
- **Send (QR)** — Send a file via animated QR codes
- **Receive (QR)** — Receive a file by scanning animated QR codes
- **Send (WebRTC)** — Send a file peer-to-peer over the network
- **Receive (WebRTC)** — Receive a file peer-to-peer over the network

Two experimental groups follow the QR Code group: **CIMBAR (Experimental)**, a
high-speed color barcode, and **Audio (Experimental)**, which transfers small
payloads as sound (see *Experimental Audio Transfer* below).

---

## Scanning a QR Code

1. Tap **Scan QR Code**
2. Tap **Start Scanning** — your browser will ask for camera permission
3. Point the camera at a QR code
4. The content is displayed automatically:
   - If it is a web address, it appears as a clickable link
   - Otherwise, the text is shown and you can copy it with the **Copy to Clipboard** button
5. As soon as content is received, scanning stops and the camera area disappears

**Information displayed while scanning**: active camera name and resolution. If you have multiple cameras, a dropdown lets you choose which one to use.

### Passkey Sign-in Codes (FIDO)

When you sign in to a website on a computer with a passkey kept on your phone, the
computer shows a QR code starting with `FIDO:/`. QRShare recognises it and shows a
**Passkey sign-in code** card: whether the computer asks to sign in or to create a
passkey, and when the code was made (a warning appears if it is more than five
minutes old and has most likely expired).

QRShare cannot sign you in itself: a web page cannot use your phone's passkeys.
Scan the code with the camera or QR reader of the phone that holds the passkey,
next to the computer — the phone checks over Bluetooth that it is close. Where the
system handles these codes (for example on Android), **Open with this device**
hands it over.

For your safety, QRShare offers no copy, share or send button for these codes:
**never forward a passkey code** to another person or device.

---

## Creating a QR Code

1. Tap **Create QR Code**
2. Type your text or paste a web address into the text area
3. The QR code is generated instantly and updates with every change
4. Adjust the parameters if needed:
   - **Template** — Choose between **Plain Text**, **Wi-Fi Network** (`WIFI:S:...`), or **Contact Card** (**MECARD** compact or **vCard 3.0** standard).
   - **Error Correction** — Error correction level (L, M, Q or H). A higher level makes the QR code more resistant to damage, but reduces the amount of data it can hold.
   - **Version** — In Auto mode, the application picks the smallest size that fits. In Manual mode, you choose a version from 1 (small) to 40 (very large).
5. The **Payload** counter shows how many bytes your text uses compared to the maximum capacity.
6. For a Wi-Fi QR code, tap **Print Wi-Fi Sign** to display and print a clean Wi-Fi access card.
7. Tap **Download PNG** to save the QR code as an image.

If the text is too long for the selected version and error correction level, an error message is displayed.

### Local Network Peer Discovery (Zero-QR Transfer)

On the home screen, QRShare automatically displays the **"Nearby Devices on Local Network"** card whenever other devices on the same Wi-Fi/LAN network have QRShare open:
- **Zero-scan detection**: Devices automatically announce their presence via WebRTC signaling without requiring any QR code scan.
- **Direct transfer**: Click **Send** next to a discovered device to send a file or text message directly.
- **Receiver prompt**: The receiver receives an invitation prompt (*Accept / Decline*). Once accepted, the transfer starts immediately over a direct WebRTC DataChannel.
- **Privacy settings**: Local discovery can be enabled/disabled and custom device names can be configured in **Settings**.

---

## Preparing a Transfer and Inviting the Receiver

This workflow lets the sender prepare the content and open QRShare on the correct receiver screen before transmitting any payload data.

1. On the home screen, tap **Prepare a transfer**.
2. Choose **File** or **Text**, then select one or more files or enter the text.
3. Choose the transfer policy:
   - **Air-gapped only** — only air-gapped modes (static QR, animated QR, experimental CIMBAR, or experimental audio) are offered. WebRTC and system sharing are excluded regardless of payload size.
   - **Prefer air-gapped** — an optical mode is recommended, while network modes remain available.
   - **Any mode** — QRShare may recommend WebRTC when the content does not fit in a static QR code.
4. Keep the recommended mode or choose another mode allowed by the policy. Size is only one criterion; the selected policy is always respected.
5. First show the invitation QR code to the receiver. It contains only a link to QRShare and opens the matching receive screen; it does not contain the file.
6. When the receiver is ready, tap **The receiver is ready — start sending**.

When several files are selected, QRShare automatically bundles them into a transfer ZIP archive and extracts them on the receiver. The selection is limited to 50 MB total; CIMBAR is offered up to approximately 33 MB and audio up to 8 KB; for several files, these limits apply to the size of the ZIP archive. If the content grows beyond the selected mode's limit, the mode switches back to the recommended one. Audio is recommended only when the device has no camera and the content is at most 1 KB.

### Passing Text Through a URL

An application can open the send chooser directly with a URL such as:

```text
https://s-celles.github.io/QRShare/#/send?data=Hello&policy=prefer-airgap
```

`data` contains URL-encoded text. `policy` accepts `airgap`, `prefer-airgap`, or `any`. If the policy is absent or invalid, QRShare defaults to preferring air-gapped transfer. This mechanism is intended for text; files are handed over as described below.

### Exchanging Files with Other Web Apps

Web applications such as [Progressive Web Office](https://github.com/s-celles/progressive-web-office) can hand files to QRShare, and get received files back, directly in the browser (app handoff protocol, version 1):

- **App → QRShare**: the app opens `#/send?handoff=1&policy=...`. QRShare shows *Waiting for the file from the application…*, receives the file, and opens the transfer chooser with *Received from <app>*. Nothing is sent until you pick a transfer mode.
- **QRShare → App**: the app opens the receive screen with a `return` parameter, for example `#/receive/qr?policy=airgap&return=https%3A%2F%2Fexample.org%2Fapp%2F`. Once a file is received, an **Open in <host>** button delivers it to that application only.

Files shared to QRShare through the system share sheet also open in the transfer chooser.

For developers: the two windows exchange `{ type: "qrshare-handoff", version: 1, action }` messages with `postMessage` — `ready` (receiving window → its opener), `file` (`name`, `mimeType`, `data` as an `ArrayBuffer`, posted to the exact origin) and `received`. Files are limited to 200 MB. Applications can check support beforehand: QRShare's `manifest.webmanifest` lists the protocol versions it speaks in `qrshare_handoff.versions`.

**Version 2** adds two optional parameters, announced in the manifest as `"versions": [1, 2]` and `"features": ["mode", "reply-opener"]`:

- `mode=animated-qr` (or `cimbar`, `webrtc`, `share`) on `#/send?handoff=1`: once the file is received, QRShare goes straight to that transfer mode, when the policy allows it, instead of showing the chooser.
- `reply=opener` on `#/receive/...?return=<app>`: after the user clicks *Open in …*, QRShare posts the `file` message back to the window that opened it, to the origin of `return` only, then closes. If that window is gone, it falls back to opening a new one, as in version 1.

---

## Sharing Files via Native Share

This method uses your browser's built-in share dialog to send files to any compatible app (messaging, email, cloud storage, etc.).

1. Tap **Send (Share)**
2. Drop files or click to browse and select one or more files
3. The native share dialog opens — choose the target app
4. The file is handed off to the selected app

**Note:** This feature requires a browser that supports the Web Share API (most mobile browsers and some desktop browsers). If unsupported, an error message is displayed.

---

## Sending a File via QR Code (no internet)

This method requires **no internet connection**. The file is transmitted optically, from screen to camera.

```mermaid
sequenceDiagram
    participant S as Sender
    participant R as Receiver

    S->>S: Select file
    S->>S: Compress & encode (fountain codes)
    loop Animated QR codes
        S->>R: Display QR frame on screen
        R->>R: Scan frame with camera
    end
    R->>R: Decode & decompress
    R->>R: Download file
```

**On the sending device:**
1. Tap **Send (QR)**
2. Drop a file or click to choose one (50 MB maximum)
3. Choose an encoding mode:
   - **High Speed** — Larger QR codes, suited for good scanning conditions
   - **Balanced** — Trade-off between capacity and reliability
   - **High Reliability** — Smaller QR codes, very reliable
4. An animated QR code appears on screen — do not close the page
5. Adjust transfer parameters if needed:
   - **Frame Rate** slider (1–30 FPS, default: 10) — Lower values give the camera more time to scan each frame
   - **Block Size** slider (50–1000 bytes, default: 250) — Smaller blocks produce simpler QR codes that are easier to scan

**On the receiving device:**
1. Tap **Receive (QR)**
2. Tap **Start Scanning**
3. Point the camera at the animated QR code on the sending device
4. The progress bar shows transfer progress, along with transfer speed and elapsed time
5. Once complete, the file downloads automatically

---

## Sending a File via WebRTC (with internet)

This method uses a network connection but the file goes directly from device to device, without passing through a server.

Peer discovery uses multiple signaling strategies in parallel (Nostr relays, BitTorrent trackers, MQTT brokers) for improved reliability. The first strategy to discover the peer wins, and the others are cancelled.

```mermaid
sequenceDiagram
    participant S as Sender
    participant Sig as Signaling (Nostr/Torrent/MQTT)
    participant R as Receiver

    R->>Sig: Create room (display QR + Room ID)
    S->>Sig: Join room (scan QR or enter ID)
    Sig->>S: Peer discovery (parallel race)
    Sig->>R: Peer discovery (parallel race)
    S-->>R: WebRTC connection established
    S->>R: Verify confirmation code
    S->>S: Select file(s)
    S->>R: Transfer file (peer-to-peer)
    R->>R: Download file
```

**On the receiving device:**
1. Tap **Receive (WebRTC)**
2. A QR code is displayed with a Room ID

**On the sending device:**
1. Tap **Send (WebRTC)**
2. Scan the receiver's QR code or enter the Room ID manually
3. Verify that the **4-digit confirmation code** matches on both devices
4. Select the file(s) to send
5. The transfer starts automatically

---

## Navigation Bar

At the top of every page:

- **QRShare** (left) — Return to the home page
- Version and build hash (next to the title) — Open the About window
- Theme button — Cycle between ◐ Auto (follows the system setting), ☀ Light and ☾ Dark
- **?** — This user guide
- Book icon — The full documentation (this guide, how QRShare works, connectivity, collaborative editing, architecture, development)
- **i** — About window: version, links, QR code of the app
- Gear icon — Settings (theme, language, WebRTC settings)
- **← Back** — Return to the home page (present on every sub-page)

---

## WebRTC Settings

Access via **Settings → WebRTC Settings** (or directly at `/#/settings/webrtc`).

### Connection Mode

- **Parallel** (default) — All enabled strategies are tried simultaneously. The first to establish a connection wins. This is the fastest approach.
- **Sequential** — Strategies are tried one by one in the configured order. If one fails (10-second timeout), the next is tried. This is useful if you want to prefer a specific strategy.

### Signaling Strategies

QRShare uses multiple signaling strategies to help two devices find each other for WebRTC file transfer:

| Strategy | Protocol | Description |
|----------|----------|-------------|
| **nostr** | Nostr relays | Decentralized relay network |
| **torrent** | BitTorrent trackers | WebTorrent tracker protocol |
| **mqtt** | MQTT brokers | Lightweight messaging protocol |

For each strategy you can:

- **Enable/disable** it using the checkbox
- **Reorder** it using the up/down arrows (order matters in sequential mode)
- **Edit relay URLs** (one per line) to use custom servers

At least one strategy must remain enabled. Leave relay URLs empty to use library defaults.

### Reset

Click **Reset to Defaults** to restore all WebRTC settings to their original values.

---

## Settings Export / Import

You can back up and restore all QRShare settings (theme, language, and WebRTC configuration) using TOML files.

### Export

1. Go to **Settings**
2. Click **Export Settings (TOML)**
3. A `qrshare-config.toml` file is downloaded

### Import

1. Go to **Settings**
2. Click **Import Settings (TOML)**
3. Select a previously exported `.toml` file
4. All settings are applied immediately

This is useful for sharing your configuration across devices or restoring settings after clearing browser data.

---

## Experimental CIMBAR Transfer

CIMBAR is a high-speed, air-gapped optical mode using matrices of colored
symbols. Select **Send (CIMBAR — Experimental)** on the sender and **Receive
(CIMBAR — Experimental)** on the receiver. The **Prepare a transfer** workflow
can also create the matching invitation and preload the sender's file.

The libcimbar browser decoder is still beta. Use good lighting, maximize the
matrix on the display, and keep standard animated QR as a fallback. The CIMBAR
protocol limit is approximately 33 MB after compression. Once reconstruction
finishes, the camera area disappears. A file can then be downloaded or shared
through the system dialog. Text prepared in QRShare is displayed directly with
the same actions as other receivers: copy, download as `.txt`, and share.

---

## Experimental Audio Transfer

Audio sends a short text or a small file **as sound**: the sender plays tones
through its loudspeaker and the receiver decodes them from its microphone. No
network, camera or line of sight is needed, only two devices within hearing
range. It is useful when cameras are unusable (no camera, a broken lens, a
screen that cannot be shown) for things like Wi-Fi passwords, keys, short notes
or small configuration files.

### Usage

1. On the receiver, tap **Receive (Audio — Experimental)**, then **Start
   listening**, and allow the microphone. The receiver detects the sender's
   profile automatically.
2. On the sender, tap **Send (Audio — Experimental)**, choose **File** or
   **Text**, and press **Play**. Audio can also be picked in the transfer chooser
   and in **Prepare a transfer**, whose invitation QR code opens the audio
   receive screen on the receiver. A link with `autostart=1` starts listening
   right away; if the browser needs a tap first, a large **Tap to start
   listening** button appears.
3. The sender plays packets continuously. Each packet carries a different piece
   of a fountain code, so missed or damaged packets do not matter: the receiver
   finishes as soon as it has heard enough of them. Press **Stop** once the
   receiver shows the result. If you change the profile or codec on the sender
   while the receiver is listening, the receiver follows the new transmission of
   the same content automatically.

The receiver shows the input level, a **Signal detected** badge, the packets
decoded and rejected, the unique symbols received against those needed, and the
effective rate. When the transfer completes, the microphone is released and the
result appears as for the other receivers: the SHA-256 check, text displayed
directly, or a file with preview, **Download**, **Share** and **Open in …**;
content received from an older QRShare version encrypted with a password shows the unlock card.

### Profiles and speeds

| Profile | Band | Approx. net rate | When to use |
|---|---|---|---|
| **Robust** (default) | 1.5–6.3 kHz, audible | about 22 bytes/s | Normal use, phones and laptops |
| **Fast** | 1.5–6.3 kHz, audible | about 53 bytes/s | Quiet room, devices close together |
| **Ultrasonic** (Advanced, less reliable) | 17–19.5 kHz, barely audible | about 10 bytes/s | When audible tones are a problem; many speakers and microphones attenuate it |

For example, a 1 KB text compressed to about 600 bytes takes about half a
minute with Robust and about 13 seconds with Fast. The sender shows the
estimated minimum duration before you press Play. Under **Advanced**, the
sender can also choose the fountain codec: **Auto (Wirehair)**, the default
and most efficient, or **LT (compatibility)** if the receiver reports that
Wirehair cannot be loaded.

### Size limits

Audio is suitable for content up to **1 KB**. Up to the hard maximum of **8 KB**
it remains available but is slow (several minutes); above 8 KB the sender
refuses and suggests animated QR codes or CIMBAR.

### Tips

- Set the sender's media volume to 70–100%.
- Keep the devices 10–50 cm apart in a quiet room.
- Do not use a Bluetooth speaker or headset (their codecs distort the tones).
- On iPhone, QRShare asks the system to play audio even with the silent switch
  on, where Safari supports it.
- If the receiver shows **Too quiet**, move closer or raise the volume; if it
  shows **Clipping**, lower the volume.

### Limitations and privacy

- It is a one-way broadcast: the sender cannot know when the receiver is done.
- Some browsers (notably on iOS) may still apply voice processing to the
  microphone, which lowers reliability.
- Sound is a broadcast: anyone within hearing range, or any recording device,
  can capture the transfer. For sensitive content, see *Encrypted (sealed)
  transfers* below. The microphone is used only while the receive screen is
  listening, and no audio is stored.

### Encrypted (sealed) transfers

Tick **Encrypt with password** on the audio sender and give the password to the
receiver by another means (spoken, written, never through the same sound
channel). The transfer is then **sealed**: nothing readable goes on the air.

- The content, the file name, its exact size and whether it is a text or a file
  are all encrypted (AES-256-GCM, key derived from the password with
  PBKDF2-SHA256).
- The size sent is rounded up to the next multiple of 256 bytes, so a listener
  only learns a size range; small transfers take a few seconds longer.
- Each transfer uses a random identifier, which cannot be linked to its content.

On the receiver, type the password in the **Password** field before pressing
**Start listening**, or later: when a sealed transfer is detected, the receiver
asks for the password and **keeps listening** meanwhile, so nothing is lost. A
wrong password is reported as soon as the first metadata packet is heard;
correct it and press **Unlock**. When the transfer completes, the content is
shown already decrypted.

What stays visible: how long the sender plays, and therefore the size range.

---

## Sharing Text Messages

All three transfer methods (Share, QR, WebRTC) support sending text messages in addition to files. When entering a sender view, a **File / Text** toggle at the top lets you choose what to send.

### Sending Text

1. Select any sender mode (Share, QR, or WebRTC)
2. Switch the toggle from **File** to **Text**
3. Type or paste your message into the text area (up to 100,000 characters)
4. The character count is displayed below the input
5. Tap the send/share button

For QR mode, short text is encoded as a standard QR code. Longer text uses the same fountain code pipeline as files.

### Receiving Text

When another device sends a text message, the receiver automatically detects it and displays the text inline instead of triggering a file download. Three action buttons are available:

- **Copy to Clipboard** — Copies the text to your clipboard
- **Download as File** — Saves the text as a `.txt` file
- **Share** — Opens the native share dialog (if supported)

### Sharing Text from Other Apps

If QRShare is installed as a PWA, you can share text from other apps directly to QRShare via the system share sheet. QRShare will open in sender mode with the text pre-filled.

---

## Frequently Asked Questions

**Does the application need internet?**
No for QR code, CIMBAR (optical transfer) and audio (sound) modes. Yes for WebRTC mode. The Scanner and Creator tools work offline after the first load.

**Which browsers are supported?**
Any modern browser (Chrome, Firefox, Safari, Edge) on desktop or mobile.

**Do my files go through a server?**
No. In QR mode, the transfer is purely optical. In WebRTC mode, the file goes directly from one device to the other.

**Can I install the application?**
Yes. QRShare is a Progressive Web App (PWA): your browser can offer to install it on your home screen for offline access.

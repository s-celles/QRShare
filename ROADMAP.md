# QRShare Roadmap

This document outlines potential future features and ideas for QRShare. None of these are guaranteed to be implemented, but they represent interesting directions for the project.

## User Experience & Interface
- **Transfer History (IndexedDB):** Keep a local log of recently sent and received files, texts, and contacts, allowing users to easily re-download or re-share them.
- **Global Drag & Drop:** Allow dropping a file anywhere on the main application interface to instantly trigger the WebRTC/QR Code sender view.
- **Clipboard Support (Paste to Share):** Support pasting (`Ctrl+V`) images or text directly into the Sender view to bypass file saving.
- **Export Animated QR to GIF/MP4:** Allow exporting the animated QR sequence as a `.gif` or video file to be sent over traditional instant messaging apps, allowing the recipient to scan it directly from their screen.

## Performance & Transfer Reliability
- **Active Payload Compression (Deflate/Pako):** Compress raw text and source code payloads *before* chunking and encoding them into QR codes to drastically improve transfer speeds for highly compressible data.
- **Fountain Codes (RaptorQ / LDPC):** Replace the simple looping frame mechanism for animated QR codes with Fountain codes. This would allow the receiver to reconstruct the file from *any* N unique frames without worrying about dropped frames or syncing perfectly with a loop.
- **WebRTC File Streaming (MediaSource API):** Instead of downloading an entire media file before previewing it, stream video or audio directly via the WebRTC data channel for instant playback.

## Security & Privacy
- **Application-Layer E2EE for WebRTC:** While WebRTC is encrypted at the transport layer, implementing the same ECDH identity-based encryption we use for QR Codes would add a Zero-Trust layer on top of WebRTC, protecting against compromised signaling servers.
- **Custom Signaling Servers (STUN/TURN/Nostr):** Expose UI settings to allow privacy-conscious users to configure their own signaling infrastructure rather than relying on default trackers.
- **"Burn After Reading" Mode:** An option where WebRTC transferred files are only kept in RAM and automatically securely wiped when the tab is closed.

## Connectivity & Ecosystem
- **One-to-Many WebRTC Broadcasting:** Allow a "Room" mode where a sender can broadcast a file to multiple receivers simultaneously using a BitTorrent-style mesh network within WebRTC.
- **QRShare CLI:** Develop a companion command-line tool (Node.js/Go) to send and receive files via animated QR codes directly from a terminal using a webcam.
- **Progressive Web App (PWA) Enhancements:** Improve offline capabilities, add background sync, and refine the Web Share Target API integration so the app feels fully native on mobile devices.

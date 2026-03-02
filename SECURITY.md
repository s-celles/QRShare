# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Security Model

QRShare is designed as a **client-only** application with no server-side processing:

- **QR Mode**: Fully air-gapped — data travels exclusively via optical screen-to-camera channel. No network requests are made.
- **WebRTC Mode**: Peer-to-peer DataChannel with DTLS encryption. Signaling is handled via decentralized Nostr relays (Trystero) for peer discovery, not for data relay. Session descriptions are encrypted using the Room ID as a password.
- **No persistent storage**: QRShare does not store files, credentials, or personal data on any server or in browser storage.
- **Integrity verification**: All transfers are verified via SHA-256 checksums.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **GitHub Security Advisories** (preferred):
   Navigate to the [Security Advisories](https://github.com/s-celles/QRShare/security/advisories) page and create a new draft advisory.

2. **Email**:
   Contact the maintainer directly via the email listed on their [GitHub profile](https://github.com/s-celles).

### What to expect

- Acknowledgement within **48 hours**
- Status update within **7 days**
- Fix timeline depends on severity:
  - **Critical**: Patch within 72 hours
  - **High**: Patch within 1 week
  - **Medium/Low**: Addressed in next release

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Please do not open public issues for security vulnerabilities.**

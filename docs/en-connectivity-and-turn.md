# Connectivity and TURN

QRShare's WebRTC modes connect your two devices **directly**, peer to peer. Most of
the time that works. Sometimes the network in between makes a direct path
impossible — and then the transfer fails no matter how long you wait.

This page explains why, and what you can do about it.

## STUN and TURN, briefly

To connect two devices that both sit behind home or mobile routers, WebRTC needs
help discovering how each one is reachable. Two kinds of server do that:

| | What it does | Does your data pass through it? |
|---|---|---|
| **STUN** | Tells your device what its public address looks like from the outside. That's all. | **No.** Once the two devices know each other's addresses, they talk directly. |
| **TURN** | Relays the traffic when a direct path cannot be established. | **Yes.** Every byte is forwarded through it. |

STUN is cheap and enough for most networks. TURN is the fallback of last resort:
it always works, because it stops trying to be clever and just forwards packets.

## Why direct connections sometimes fail

A direct path can be impossible, not just slow:

- **Symmetric NAT.** Some routers assign a *different* external port for every
  destination. The address STUN discovers is then useless for anyone else — by the
  time your peer tries it, it no longer maps to you.
- **Carrier-grade NAT (CGNAT).** Common on mobile data (4G/5G) and some fibre ISPs.
  Thousands of subscribers share one public address and you have no control over the
  mapping.
- **Firewalls that block UDP.** Frequent on corporate and campus networks. WebRTC
  needs UDP for its media/data path; if it's blocked, only a relay over TCP/TLS gets
  through.

This is not an exotic corner case. A commonly cited figure is that **10–20% of
consumer WebRTC sessions end up needing a relay**, and the share is much higher
inside corporate networks. If QRShare connects fine at home but never on your phone's
mobile data, this is almost certainly why.

## QRShare ships no TURN server — on purpose

**This is a deliberate choice, not an oversight.**

A TURN relay terminates both legs of the connection. It necessarily learns:

- which two peers are talking to each other,
- when, and for how long,
- how many bytes moved.

It cannot read your files — DTLS keeps the payload encrypted end-to-end, and that
holds even through a relay. But the **metadata** is exposed to whoever runs it.

QRShare's whole premise is a transfer whose metadata stays between your two devices;
the air-gapped QR mode is the extreme expression of that. Bundling a default relay
would silently route a fraction of users' connection metadata through a third party
they never chose, in exchange for convenience. That trade doesn't fit the product.

So instead of hiding the failure, QRShare names it — and lets **you** decide whether
to add a relay, and whose.

## Adding your own TURN server

Go to **Settings → WebRTC → ICE servers**, press **+ Add TURN**, and fill in:

- **URL** — e.g. `turn:turn.example.com:3478`, or `turns:turn.example.com:5349` for
  TLS (use this one if you also need to get through a firewall that blocks UDP).
- **Username** and **Password** — as issued by your TURN server.

Credentials are stored only in your browser's local storage, and are only ever sent
to the TURN server you configured, by the browser's own ICE stack.

You have two honest options, and the trade-off is yours to make:

### Self-hosted (coturn)

[coturn](https://github.com/coturn/coturn) is the standard open-source TURN server.
You run it on a VPS with a domain and a TLS certificate.

- **For:** nobody but you sees the metadata. Full control.
- **Against:** you need a server, a domain, TLS, and ongoing maintenance. Relayed
  traffic uses your bandwidth.

### A third-party provider

Several providers offer TURN, some with a free tier — for example
[Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) or the
[Open Relay Project](https://www.metered.ca/tools/openrelay/).

- **For:** works in minutes, no maintenance.
- **Against:** that provider sees the metadata described above. You are choosing to
  trust them.

QRShare deliberately **does not endorse a default provider**. Both options are listed
so you can pick with the trade-off in view.

## Testing your setup: "Test ICE servers"

In **Settings → WebRTC**, the **Test ICE servers** button runs a real ICE gathering
round against exactly the servers you have configured — the same ones a real transfer
would use. It reports two things:

**STUN**

- *STUN reachable* — a public address was discovered. Direct connections have a
  chance.
- *STUN unreachable* — no public address came back. Direct connections will likely
  fail on this network, and you need a relay.

**TURN**

- *No TURN server configured* — networks that need a relay will not connect. This is
  the default state, by design.
- *TURN works* — a relay address was obtained. Your TURN server is correctly
  configured and reachable.
- *TURN configured but no relay address* — the server is set up but did not answer.
  Check the URL, the port, the credentials, and whether `turns:` (TLS) is needed on
  this network.

Run this **before** you need it. A TURN server that is configured but broken looks
exactly like no TURN server at all when a transfer fails.

## Reading a failed connection

When a connection fails, QRShare tells you which thing failed rather than a generic
timeout. Expand **Connection details** on the error to see the candidates gathered
and the STUN/TURN result behind the verdict.

One caveat stated plainly: QRShare can measure **your** side with confidence, but it
cannot see the other device. So "your network needs a relay" and "your TURN is
broken" are high-confidence diagnoses, while "the other device could not be reached"
is labelled as a best guess — the failure could be their network, or the signaling
relays, and QRShare has no way to tell from here.

## Note on the air-gapped QR mode

None of this applies to the animated-QR transfer mode. It uses no network at all —
that's the point. If WebRTC will not connect and you cannot add a relay, the QR mode
still works, camera to screen.

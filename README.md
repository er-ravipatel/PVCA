# PVCA — Private Video Chat Application

> **Proof of Concept (POC)**  
> Repository: [er-ravipatel/PVCA](https://github.com/er-ravipatel/PVCA)  
> Active branch: `POC`

A minimal self-hosted 1:1 video chat app. No external services, no database, no auth.  
Works peer-to-peer over the same WiFi network between a PC and a mobile phone.

---

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Stable base |
| `POC`  | Active proof-of-concept development — all current work happens here |

To switch to the POC branch after cloning:

```
git checkout POC
```

---

## Stack

| Layer      | Technology |
|------------|------------|
| Backend    | Python + FastAPI |
| Signaling  | FastAPI WebSocket |
| Frontend   | Plain HTML / CSS / JS |
| P2P Video  | WebRTC (browser built-in) |

---

## Setup & Running

### 1. Clone the repository

```
git clone https://github.com/er-ravipatel/PVCA.git
cd PVCA
git checkout POC
```

### 2. Install Python 3.10+

Download from https://python.org and make sure it is on your PATH.

```
python --version
```

### 3. Create a virtual environment

```
python -m venv .venv
.venv\Scripts\activate
```

### 4. Install dependencies

```
pip install -r requirements.txt
```

### 5. Run the server

```
uvicorn app:app --host 0.0.0.0 --port 8000
```

You should see output like:

```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### 6. Find your PC's local IP address

```
ipconfig
```

Look for the `IPv4 Address` under your active network adapter (usually Wi-Fi).  
Example: `192.168.1.10`

### 7. Open on PC

```
http://localhost:8000
```

### 8. Open on mobile (same WiFi)

```
http://<PC_LOCAL_IP>:8000
```

Example:

```
http://192.168.1.10:8000
```

### 9. Expose publicly via ngrok (current POC setup)

Mobile browsers require HTTPS to access the camera/mic. In this POC we use **ngrok** to get a public HTTPS URL without configuring certificates manually.

#### Install ngrok (one-time)

```
winget install ngrok.ngrok
```

After install, open a **new terminal** (so PATH is refreshed).

#### Authenticate ngrok (one-time)

Sign up free at https://dashboard.ngrok.com, copy your authtoken, then run:

```
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE
```

#### Start the tunnel (every session)

Make sure the FastAPI server is already running (step 5), then in a **second terminal**:

```
ngrok http 8000
```

You will see output like:

```
Forwarding   https://abc123.ngrok-free.app -> http://localhost:8000
```

#### Open on mobile

Use the `https://` ngrok URL on **both** PC and mobile — camera and mic will work because it is real HTTPS.

> **Note:** The ngrok URL changes every time you restart ngrok (free tier). Keep the ngrok window open for the whole session.

### 10. Start a call

1. On **both** devices: open the ngrok `https://` URL.
2. Click **Start Camera** and allow camera/mic permissions.
3. Type the **same Room ID** on both devices (e.g. `room1`).
4. Click **Join Room** on both devices.
5. The first device to join waits; the second device triggers the offer/answer exchange automatically.
6. Video and audio should appear within a few seconds.

---

## Windows Firewall

Windows may block inbound connections on port 8000.  
When prompted by Windows Defender Firewall, click **Allow Access**.

To open the port manually:

1. Open **Windows Defender Firewall with Advanced Security**.
2. Click **Inbound Rules** → **New Rule**.
3. Choose **Port** → **TCP** → **8000**.
4. Allow the connection and finish the wizard.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Mobile cannot open the page | Not on same WiFi, or wrong IP | Run `ipconfig`, use the correct IPv4 address |
| Both devices on WiFi but still can't connect | Router AP/client isolation | Disable client isolation in router settings |
| WebSocket connection fails | Firewall or wrong port | Allow port 8000; check uvicorn is running |
| Camera permission denied | Browser blocked it | Click the camera icon in the address bar and allow |
| Mobile browser blocks camera on HTTP | Chrome/Safari require HTTPS for camera on non-localhost origins | See HTTPS section below |
| Video never appears | ICE negotiation failed | Both peers must be on same LAN; check browser console for errors |
| Antivirus blocking port 8000 | Security software firewall | Add an exception for port 8000 or for the Python/uvicorn process |

---

## HTTPS (Required for Mobile Camera Access)

Chrome and Safari on mobile **block camera/mic access on HTTP** for non-`localhost` origins.  
For full mobile testing you need HTTPS.

### Option A: mkcert (easiest for local dev)

```
# Install mkcert (https://github.com/FiloSottile/mkcert)
mkcert -install
mkcert localhost 127.0.0.1 192.168.1.10   # use your actual IP

# This creates localhost+2.pem and localhost+2-key.pem
uvicorn app:app --host 0.0.0.0 --port 8000 \
    --ssl-keyfile localhost+2-key.pem \
    --ssl-certfile localhost+2.pem
```

Then open `https://<PC_LOCAL_IP>:8000` on mobile.  
Install the mkcert root CA on your phone (mkcert prints instructions).

### Option B: nginx reverse proxy + self-signed cert

Put nginx in front of uvicorn and terminate TLS there.

---

## Adding STUN / TURN (for connections across different networks)

In [web/app.js](web/app.js), find the commented `iceServers` block and replace the empty array:

```js
const config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
            urls: "turn:YOUR_TURN_SERVER:3478",
            username: "user",
            credential: "password"
        }
    ]
};
```

For a self-hosted TURN server, [coturn](https://github.com/coturn/coturn) is the standard open-source option.

---

## Project Structure

```
video-chat-python/
├── app.py              # FastAPI server: static files + WebSocket signaling
├── requirements.txt    # Python dependencies
├── web/
│   ├── index.html      # UI: room input, video elements, control buttons
│   ├── style.css       # Responsive styles
│   └── app.js          # WebRTC + WebSocket client logic
└── README.md
```

---

## Signaling Message Flow

```
Device A (initiator)          Server              Device B
      |                         |                     |
      |── WS connect ──────────>|                     |
      |<─ joined {isInitiator:true} ─────────────────|
      |                         |<── WS connect ──────|
      |                         |──> joined {isInitiator:false} ─>|
      |<─ peer-joined ──────────|                     |
      |── offer ───────────────>|──> offer ──────────>|
      |                         |<── answer ──────────|
      |<─ answer ───────────────|                     |
      |<──── ICE candidates (both directions) ───────>|
      |══════════════ P2P video/audio ════════════════|
```

---

## Limitations

- Max 2 users per room (by design).
- No persistence — rooms and state live only while the server is running.
- No authentication or access control.
- Peer-to-peer only; media does not pass through the server.
- Same-WiFi / LAN only without a TURN server.

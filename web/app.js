// ─── State ────────────────────────────────────────────────────────────────────
let localStream = null;       // MediaStream from getUserMedia
let peerConnection = null;    // RTCPeerConnection to the remote peer
let socket = null;            // WebSocket to the signaling server
let myPeerId = null;          // UUID assigned by the server
let isInitiator = false;      // true → we create the offer
let isMuted = false;
let isCameraOff = false;

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const localVideo  = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const statusEl    = document.getElementById("status");

function setStatus(msg, type = "") {
    statusEl.textContent = msg;
    statusEl.parentElement.className = "status " + type;
    console.log("[STATUS]", msg);
}

function setBtn(id, enabled) {
    document.getElementById(id).disabled = !enabled;
}

// ─── Camera / Mic ─────────────────────────────────────────────────────────────
async function startCamera() {
    setStatus("Requesting camera and microphone…");
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        setStatus("Camera ready. Enter a Room ID and click Join Room.");
        setBtn("startCameraBtn", false);
        setBtn("joinBtn", true);
        setBtn("muteBtn", true);
        setBtn("cameraBtn", true);
    } catch (err) {
        setStatus("Camera error: " + err.message, "error");
        console.error("[CAMERA]", err);
    }
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
    document.getElementById("muteBtn").textContent = isMuted ? "🔇 Unmute" : "🔊 Mute";
}

function toggleCamera() {
    if (!localStream) return;
    isCameraOff = !isCameraOff;
    localStream.getVideoTracks().forEach(t => (t.enabled = !isCameraOff));
    document.getElementById("cameraBtn").textContent = isCameraOff ? "📷 Camera On" : "📹 Camera Off";
}

// ─── WebSocket / Signaling ─────────────────────────────────────────────────────
function joinRoom() {
    const roomId = document.getElementById("roomId").value.trim();
    if (!roomId) { setStatus("Please enter a Room ID.", "error"); return; }
    if (!localStream) { setStatus("Start your camera first.", "error"); return; }

    // Build WebSocket URL from the current page origin so it works on any host/port
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${location.host}/ws/${roomId}`;

    setStatus("Connecting to signaling server…");
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("[WS] connected to", wsUrl);
        setStatus("Connected to server. Waiting for peer…");
        setBtn("joinBtn", false);
        setBtn("hangupBtn", true);
    };

    socket.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        console.log("[WS] received:", msg.type, msg);

        switch (msg.type) {
            case "joined":
                // Server tells us our identity and role
                myPeerId  = msg.peerId;
                isInitiator = msg.isInitiator;
                setStatus(isInitiator
                    ? "You joined (waiting for second person)…"
                    : "You joined. Connecting…");
                break;

            case "peer-joined":
                // The second person just joined; initiator now creates the offer
                setStatus("Peer joined! Establishing connection…");
                if (isInitiator) {
                    await createPeerConnection();
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    sendSignal({ type: "offer", sdp: offer });
                }
                break;

            case "offer":
                // Non-initiator receives the offer and sends back an answer
                setStatus("Received offer. Sending answer…");
                await createPeerConnection();
                await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                sendSignal({ type: "answer", sdp: answer });
                break;

            case "answer":
                // Initiator receives the answer
                setStatus("Received answer. Finalizing connection…");
                await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                break;

            case "ice":
                // Both sides receive ICE candidates from each other
                if (msg.candidate && peerConnection) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
                    } catch (e) {
                        console.warn("[ICE] addIceCandidate error:", e);
                    }
                }
                break;

            case "peer-left":
                setStatus("Peer disconnected.", "error");
                cleanupPeerConnection();
                break;

            case "error":
                setStatus("Server error: " + msg.message, "error");
                break;

            default:
                console.warn("[WS] unknown message type:", msg.type);
        }
    };

    socket.onclose = () => {
        console.log("[WS] connection closed");
        // Only update status if we didn't already hang up intentionally
        if (statusEl.textContent !== "Call ended.") {
            setStatus("Disconnected from server.", "error");
        }
    };

    socket.onerror = (err) => {
        console.error("[WS] error:", err);
        setStatus("WebSocket error. Is the server running?", "error");
    };
}

function sendSignal(msg) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log("[WS] sending:", msg.type);
        socket.send(JSON.stringify(msg));
    }
}

// ─── RTCPeerConnection ─────────────────────────────────────────────────────────
async function createPeerConnection() {
    // For same-WiFi LAN testing no ICE servers are needed.
    // Uncomment the iceServers block below when adding STUN/TURN support.
    const config = {
        iceServers: []

        // ── Future STUN/TURN config ──────────────────────────────────────────
        // iceServers: [
        //     { urls: "stun:stun.l.google.com:19302" },
        //     {
        //         urls: "turn:YOUR_TURN_SERVER:3478",
        //         username: "user",
        //         credential: "password"
        //     }
        // ]
        // ────────────────────────────────────────────────────────────────────
    };

    peerConnection = new RTCPeerConnection(config);
    console.log("[RTC] PeerConnection created");

    // Add all local tracks (audio + video) to the connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // When we get a remote track, show it in the remote video element
    peerConnection.ontrack = (event) => {
        console.log("[RTC] remote track received:", event.track.kind);
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Forward ICE candidates to the other peer via the signaling server
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: "ice", candidate: event.candidate });
        }
    };

    // Log connection state changes so the user can see what's happening
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        console.log("[RTC] connection state:", state);
        if (state === "connected") {
            setStatus("Connected! 🎉", "connected");
        } else if (state === "disconnected" || state === "failed") {
            setStatus("Connection " + state + ".", "error");
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("[RTC] ICE state:", peerConnection.iceConnectionState);
    };
}

function cleanupPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
}

// ─── Hang Up ──────────────────────────────────────────────────────────────────
function hangup() {
    sendSignal({ type: "leave" });

    cleanupPeerConnection();

    if (socket) {
        socket.close();
        socket = null;
    }

    // Stop all local tracks (releases the camera/mic indicator light)
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
        localVideo.srcObject = null;
    }

    // Reset button states
    setBtn("startCameraBtn", true);
    setBtn("joinBtn", false);
    setBtn("hangupBtn", false);
    setBtn("muteBtn", false);
    setBtn("cameraBtn", false);

    isMuted = false;
    isCameraOff = false;
    document.getElementById("muteBtn").textContent  = "🔊 Mute";
    document.getElementById("cameraBtn").textContent = "📹 Camera Off";

    setStatus("Call ended.");
}

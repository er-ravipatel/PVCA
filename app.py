import uuid
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

# In-memory room registry: { room_id: { peer_id: websocket } }
rooms: dict[str, dict[str, WebSocket]] = {}


@app.get("/")
async def index():
    return FileResponse("web/index.html")


app.mount("/static", StaticFiles(directory="web"), name="static")


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept()

    # Reject if room already has 2 peers
    room = rooms.setdefault(room_id, {})
    if len(room) >= 2:
        await websocket.send_json({"type": "error", "message": "Room is full"})
        await websocket.close()
        return

    peer_id = str(uuid.uuid4())
    is_initiator = len(room) == 0  # First peer is the initiator
    room[peer_id] = websocket

    print(f"[JOIN]  room={room_id}  peer={peer_id}  initiator={is_initiator}")

    # Tell the joining peer who they are
    await websocket.send_json({
        "type": "joined",
        "peerId": peer_id,
        "isInitiator": is_initiator,
    })

    # If a second peer just joined, notify the first peer
    if not is_initiator:
        other_peer_id = next(pid for pid in room if pid != peer_id)
        other_ws = room[other_peer_id]
        await other_ws.send_json({
            "type": "peer-joined",
            "peerId": peer_id,
        })
        print(f"[READY] room={room_id}  notified existing peer={other_peer_id}")

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type")

            print(f"[MSG]   room={room_id}  from={peer_id}  type={msg_type}")

            # Relay signaling messages to the other peer in the room
            if msg_type in ("offer", "answer", "ice", "ready"):
                for other_id, other_ws in room.items():
                    if other_id != peer_id:
                        msg["fromPeerId"] = peer_id
                        await other_ws.send_json(msg)

            elif msg_type == "leave":
                print(f"[LEAVE] room={room_id}  peer={peer_id}")
                break

    except WebSocketDisconnect:
        print(f"[DISC]  room={room_id}  peer={peer_id}")

    finally:
        # Remove the peer and notify the remaining peer
        room.pop(peer_id, None)
        for other_ws in room.values():
            try:
                await other_ws.send_json({"type": "peer-left", "peerId": peer_id})
            except Exception:
                pass

        # Clean up empty rooms
        if not room:
            rooms.pop(room_id, None)
            print(f"[CLEAN] room={room_id} removed (empty)")

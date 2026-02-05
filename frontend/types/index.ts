export type Peer = {
  id: string;
  userId: string;
  name: string;
  isLocal: boolean;
  role?: string;
};

export type TrackInfo = {
  id: string;
  kind: "audio" | "video";
  mediaType: "user" | "screen"; // 'user' for webcam/mic, 'screen' for screenshare
  label: string;
  enabled: boolean;
  muted: boolean;
  trackId: string; // The RSTream ID or UUID
  stream?: MediaStream; // The actual MediaStream object
};

export type ConnectionQuality = {
  level: "excellent" | "good" | "poor" | "critical";
  packetLoss: number;
};

export type SignalingMessage =
  | { type: "join"; data: { roomId: string; userId: string; name: string } }
  | { type: "offer"; data: { sdp: string; type: "offer"; peerId?: string } }
  | { type: "answer"; data: { sdp: string; type: "answer"; peerId?: string } }
  | { type: "ice-candidate"; data: { candidate: string; sdpMid: string; sdpMLineIndex: number; peerId?: string } }
  | { type: "peer-joined"; data: { peerId: string; userId: string; name: string } }
  | { type: "peer-left"; data: { peerId: string } }
  | { type: "room-state"; data: { peers: Array<{ peerId: string; userId: string; name: string }> } }
  | { type: "dominant-speaker"; data: { oldPeerId: string; newPeerId: string } }
  | { type: "quality-stats"; data: { peerId: string; level: string; packetLoss: number } }
  | { type: "renegotiate"; data: { reason?: string } }
  | { type: "layer-switch"; data: { trackId: string; targetRid: string } }
  | { type: "layer-available"; data: { trackId: string; layers: string[] } }
  // Renegotiation coordination (inLive SFU pattern)
  | { type: "is-allow-renegotiation"; data: {} }
  | { type: "allow-renegotiation"; data: { allowed: boolean } }
  // Network and bandwidth management
  | { type: "network-condition"; data: { condition: "good" | "degraded" | "poor" } }
  | { type: "set-bandwidth-limit"; data: { bandwidth: number } };

export type RoomStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error" | "disconnected";

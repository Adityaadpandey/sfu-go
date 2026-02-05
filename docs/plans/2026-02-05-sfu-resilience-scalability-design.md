# SFU Resilience & Scalability Design

**Date:** 2026-02-05
**Status:** Approved
**Approach:** Incremental Enhancement (Approach A)

## Goals

1. **Production Resilience** - Network blips, ICE restart, server-side recovery
2. **Scalability** - 100-500 concurrent rooms, 5,000 total peers with Redis state
3. **Feature Parity** - Perfect negotiation pattern + track subscription model

---

## 1. Connection Resilience Architecture

### Session Layer

A **Session** abstraction sits above the Peer. A Session represents a user's logical presence in a room, while a Peer represents a single WebRTC connection.

```
Session (persistent identity, 30s TTL after disconnect)
   └── Peer (ephemeral connection, can be replaced)
```

### Session Manager (`internals/session/manager.go`)

- Maps `sessionId` → `Session` with TTL (30 seconds after disconnect)
- Stores: userId, roomId, track subscriptions, media state (muted/unmuted)
- Redis-backed for persistence across server restarts

### Session Recovery Flow

1. Client disconnects → Session enters "suspended" state (not removed)
2. Client reconnects within TTL → Resume existing session, create new Peer
3. Server sends current room state, client doesn't need to re-add tracks
4. Other participants see brief "reconnecting" status, not "left/joined"

### ICE Restart Support

- New signaling messages: `ice-restart-request` / `ice-restart-offer`
- Backend creates new ICE credentials without tearing down peer
- Handles WiFi→cellular transitions seamlessly
- Frontend triggers after 3s in "disconnected" ICE state

---

## 2. Perfect Negotiation Pattern

### Problem

Simultaneous offers from client and server cause "glare" - conflicting negotiations that fail or corrupt state.

### Solution

WebRTC "Perfect Negotiation" pattern:
- **Server = Impolite** (higher priority, never rolls back)
- **Client = Polite** (rolls back its offer if server sends one during negotiation)

### Backend Implementation (`internals/peer/peer.go`)

```go
type NegotiationState struct {
    makingOffer     bool
    ignoreOffer     bool
    isSettingRemote bool
}
```

- Before creating offer: set `makingOffer = true`
- On incoming offer: if `makingOffer || isSettingRemote` → ignore (we're impolite)
- After `setRemoteDescription` completes: clear flags

### Frontend Implementation (`useWebRTC.ts`)

```typescript
const offerCollision = makingOffer || pc.signalingState !== "stable";
if (offerCollision) {
  await pc.setLocalDescription({ type: "rollback" });
  await pc.setRemoteDescription(offer);
}
```

### New Signaling Flow

- Add `negotiation-needed` message from server (hint to client)
- Client checks if it can accept, or waits and retries
- Eliminates race conditions entirely

---

## 3. Track Subscription Model

### Current Behavior

Peers automatically receive all tracks from all participants (wasteful).

### Subscription-Based Approach

Clients explicitly subscribe to tracks they want.

### Data Structures (`internals/subscription/manager.go`)

```go
type Subscription struct {
    PeerID      string
    TrackID     string
    Kind        string  // "audio" | "video"
    Layer       string  // simulcast: "high" | "medium" | "low"
    Active      bool
}

type SubscriptionManager struct {
    subscriptions map[string]map[string]*Subscription  // peerId -> trackId -> sub
}
```

### New Signaling Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `track-published` | Server→Client | Notify that a new track is available |
| `subscribe` | Client→Server | Request to receive a specific track |
| `unsubscribe` | Client→Server | Stop receiving a track |
| `subscription-ack` | Server→Client | Confirm subscription started |

### Backwards Compatibility

- Config flag: `auto_subscribe: true` (default) - behaves like current system
- When `false` - clients must explicitly subscribe

---

## 4. Redis State & Scalability

### Redis Key Patterns

| Key Pattern | Data | TTL |
|-------------|------|-----|
| `session:{sessionId}` | userId, roomId, mediaState, subscriptions | 30s after disconnect |
| `room:{roomId}:meta` | roomName, createdAt, settings | Until empty + 5min |
| `room:{roomId}:peers` | Set of active sessionIds | Sync with session TTL |
| `peer:{peerId}:tracks` | Published track metadata | Session lifetime |

### State Manager (`internals/state/manager.go`)

```go
type StateManager struct {
    local  *sync.Map          // Hot path: in-memory
    redis  *redis.Client      // Persistence layer
}

// Write-through: update both, Redis async
func (s *StateManager) SetSession(sess *Session) error {
    s.local.Store(sess.ID, sess)
    go s.persistToRedis(sess)  // Non-blocking
    return nil
}

// Read: memory first, Redis fallback (recovery)
func (s *StateManager) GetSession(id string) (*Session, error) {
    if sess, ok := s.local.Load(id); ok {
        return sess.(*Session), nil
    }
    return s.loadFromRedis(id)  // Recovery path
}
```

### Server Restart Recovery

1. On startup, scan `session:*` keys with remaining TTL
2. Rebuild in-memory state from Redis
3. Clients reconnecting get their session back
4. Expired sessions cleaned up automatically

### Optimization for 5K Peers

- Connection pooling (10 Redis connections)
- Pipeline batch writes for metrics
- Lua scripts for atomic room operations

---

## 5. Enhanced Monitoring & Metrics

### New Prometheus Metrics

```go
// Connection health
sfu_ice_connection_state{state="connected|disconnected|failed"} gauge
sfu_ice_restarts_total counter
sfu_session_recoveries_total counter
sfu_session_recovery_failures_total counter

// Media quality
sfu_track_bitrate_bytes{peer,track,direction="in|out"} gauge
sfu_packet_loss_ratio{peer} gauge
sfu_jitter_ms{peer} histogram
sfu_rtt_ms{peer} histogram
sfu_pli_requests_total counter
sfu_nack_requests_total counter

// Subscription model
sfu_subscriptions_active gauge
sfu_subscription_changes_total{action="subscribe|unsubscribe"} counter

// Redis health
sfu_redis_latency_ms histogram
sfu_redis_errors_total counter
sfu_state_recovery_duration_ms histogram

// Scalability
sfu_goroutines_per_room gauge
sfu_memory_per_peer_bytes gauge
```

### Grafana Dashboard Additions

- Connection state distribution pie chart
- Session recovery success rate over time
- Per-room bandwidth heatmap
- Redis latency percentiles (p50, p95, p99)
- Alert: session recovery rate < 90%

### Structured Logging

- Add `sessionId` and `roomId` to all log entries
- Log ICE state transitions with timing
- Log subscription changes for debugging

---

## 6. Frontend Changes

### Session-Aware Reconnection (`useWebRTC.ts`)

```typescript
const sessionId = useRef<string | null>(null);
const sessionToken = useRef<string | null>(null);

const joinMessage = {
  type: 'join',
  roomId,
  userId,
  sessionId: sessionId.current,
  sessionToken: sessionToken.current,
};
```

### Perfect Negotiation (Polite Client)

```typescript
const makingOffer = useRef(false);

pc.onnegotiationneeded = async () => {
  makingOffer.current = true;
  try {
    await pc.setLocalDescription();
    send({ type: 'offer', sdp: pc.localDescription });
  } finally {
    makingOffer.current = false;
  }
};

const handleOffer = async (offer) => {
  const collision = makingOffer.current || pc.signalingState !== 'stable';
  if (collision) {
    await pc.setLocalDescription({ type: 'rollback' });
  }
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription();
  send({ type: 'answer', sdp: pc.localDescription });
};
```

### ICE Restart Trigger

```typescript
const requestIceRestart = () => {
  send({ type: 'ice-restart-request' });
};

pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === 'disconnected') {
    setTimeout(() => {
      if (pc.iceConnectionState === 'disconnected') {
        requestIceRestart();
      }
    }, 3000);
  }
};
```

### Track Subscription API

```typescript
// Store actions
subscribeToTrack: (peerId: string, trackId: string, layer?: string) => void;
unsubscribeFromTrack: (peerId: string, trackId: string) => void;
availableTracks: Map<string, TrackInfo[]>;
```

---

## 7. Implementation Plan

### Phase Order

| Phase | Components | Dependency |
|-------|------------|------------|
| **1** | Redis state layer (`internals/state/`) | None - foundation |
| **2** | Session manager (`internals/session/`) | Needs Redis |
| **3** | Perfect negotiation (backend + frontend) | Independent |
| **4** | ICE restart support | Needs Session |
| **5** | Track subscription model | Needs Session |
| **6** | Enhanced metrics | Can parallelize |
| **7** | Frontend integration | After backend phases |

### New Files

```
backend/
├── internals/
│   ├── state/
│   │   ├── manager.go      # Redis + in-memory state
│   │   └── keys.go         # Redis key patterns
│   ├── session/
│   │   ├── session.go      # Session struct & methods
│   │   └── manager.go      # Session lifecycle
│   └── subscription/
│       └── manager.go      # Track subscription logic
```

### Files to Modify

```
backend/
├── internals/
│   ├── sfu/sfu.go          # Session integration
│   ├── room/room.go        # Subscription-aware forwarding
│   ├── peer/peer.go        # Perfect negotiation state
│   ├── signaling/websocket.go  # New message types
│   └── metrics/metrics.go  # Expanded metrics

frontend/
├── hooks/useWebRTC.ts      # Session, perfect neg, ICE restart
├── store/useRoomStore.ts   # Subscription state
└── components/room/video-grid.tsx  # Subscription-aware rendering
```

---

## References

- [inlivedev/sfu](https://github.com/inlivedev/sfu) - Reference implementation
- [WebRTC Perfect Negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
- [Pion WebRTC](https://github.com/pion/webrtc)

# SFU Resilience & Scalability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session-based resilience, Redis state persistence, perfect negotiation, and track subscription to the SFU.

**Architecture:** Layered approach - Redis state manager at the bottom, Session manager above it, then integrate with existing Room/Peer/Signaling. Frontend gets session-aware reconnection and perfect negotiation.

**Tech Stack:** Go 1.24+, Pion WebRTC, Redis (go-redis/v9), React/TypeScript, Zustand

---

## Task 1: Create Redis State Manager

**Files:**
- Create: `backend/internals/state/keys.go`
- Create: `backend/internals/state/manager.go`
- Modify: `backend/go.mod` (add go-redis dependency)

**Step 1: Add go-redis dependency**

Run: `cd backend && go get github.com/redis/go-redis/v9`
Expected: Dependency added to go.mod

**Step 2: Create keys.go with Redis key patterns**

```go
// backend/internals/state/keys.go
package state

import "fmt"

const (
	KeyPrefixSession = "session:"
	KeyPrefixRoom    = "room:"
	KeyPrefixPeer    = "peer:"

	SessionTTL = 30 // seconds after disconnect
	RoomTTL    = 300 // 5 minutes after empty
)

func SessionKey(sessionID string) string {
	return fmt.Sprintf("%s%s", KeyPrefixSession, sessionID)
}

func RoomMetaKey(roomID string) string {
	return fmt.Sprintf("%s%s:meta", KeyPrefixRoom, roomID)
}

func RoomPeersKey(roomID string) string {
	return fmt.Sprintf("%s%s:peers", KeyPrefixRoom, roomID)
}

func PeerTracksKey(peerID string) string {
	return fmt.Sprintf("%s%s:tracks", KeyPrefixPeer, peerID)
}
```

**Step 3: Create manager.go with state manager**

```go
// backend/internals/state/manager.go
package state

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type SessionData struct {
	ID            string            `json:"id"`
	UserID        string            `json:"userId"`
	RoomID        string            `json:"roomId"`
	Name          string            `json:"name"`
	MediaState    MediaState        `json:"mediaState"`
	Subscriptions []string          `json:"subscriptions"`
	CreatedAt     time.Time         `json:"createdAt"`
	LastSeen      time.Time         `json:"lastSeen"`
	Suspended     bool              `json:"suspended"`
}

type MediaState struct {
	MicEnabled    bool `json:"micEnabled"`
	CameraEnabled bool `json:"cameraEnabled"`
	ScreenEnabled bool `json:"screenEnabled"`
}

type Manager struct {
	local  *sync.Map
	redis  *redis.Client
	logger *zap.Logger
	ctx    context.Context
}

func NewManager(redisAddr, redisPassword string, redisDB int, logger *zap.Logger) (*Manager, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		Password:     redisPassword,
		DB:           redisDB,
		PoolSize:     10,
		MinIdleConns: 2,
	})

	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	logger.Info("Connected to Redis", zap.String("addr", redisAddr))

	return &Manager{
		local:  &sync.Map{},
		redis:  rdb,
		logger: logger,
		ctx:    ctx,
	}, nil
}

// SetSession stores session in memory and persists to Redis async
func (m *Manager) SetSession(sess *SessionData) error {
	m.local.Store(sess.ID, sess)

	go func() {
		data, err := json.Marshal(sess)
		if err != nil {
			m.logger.Error("Failed to marshal session", zap.Error(err))
			return
		}

		ttl := time.Duration(SessionTTL) * time.Second
		if !sess.Suspended {
			ttl = 0 // No expiry while active
		}

		if err := m.redis.Set(m.ctx, SessionKey(sess.ID), data, ttl).Err(); err != nil {
			m.logger.Error("Failed to persist session to Redis", zap.Error(err))
		}
	}()

	return nil
}

// GetSession retrieves session from memory, falls back to Redis
func (m *Manager) GetSession(sessionID string) (*SessionData, error) {
	if val, ok := m.local.Load(sessionID); ok {
		return val.(*SessionData), nil
	}

	return m.loadSessionFromRedis(sessionID)
}

func (m *Manager) loadSessionFromRedis(sessionID string) (*SessionData, error) {
	data, err := m.redis.Get(m.ctx, SessionKey(sessionID)).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var sess SessionData
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, err
	}

	m.local.Store(sessionID, &sess)
	return &sess, nil
}

// SuspendSession marks session as suspended with TTL
func (m *Manager) SuspendSession(sessionID string) error {
	val, ok := m.local.Load(sessionID)
	if !ok {
		return nil
	}

	sess := val.(*SessionData)
	sess.Suspended = true
	sess.LastSeen = time.Now()

	return m.SetSession(sess)
}

// DeleteSession removes session from memory and Redis
func (m *Manager) DeleteSession(sessionID string) error {
	m.local.Delete(sessionID)
	return m.redis.Del(m.ctx, SessionKey(sessionID)).Err()
}

// GetActiveSessions returns all non-suspended sessions for a room
func (m *Manager) GetRoomSessions(roomID string) ([]*SessionData, error) {
	var sessions []*SessionData

	m.local.Range(func(key, value interface{}) bool {
		sess := value.(*SessionData)
		if sess.RoomID == roomID && !sess.Suspended {
			sessions = append(sessions, sess)
		}
		return true
	})

	return sessions, nil
}

// RecoverSessions loads suspended sessions from Redis on startup
func (m *Manager) RecoverSessions() (int, error) {
	pattern := SessionKey("*")
	keys, err := m.redis.Keys(m.ctx, pattern).Result()
	if err != nil {
		return 0, err
	}

	recovered := 0
	for _, key := range keys {
		sessionID := key[len(KeyPrefixSession):]
		if _, err := m.loadSessionFromRedis(sessionID); err == nil {
			recovered++
		}
	}

	m.logger.Info("Recovered sessions from Redis", zap.Int("count", recovered))
	return recovered, nil
}

// Health check
func (m *Manager) Ping() error {
	return m.redis.Ping(m.ctx).Err()
}

// Close cleanup
func (m *Manager) Close() error {
	return m.redis.Close()
}
```

**Step 4: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add backend/internals/state/ backend/go.mod backend/go.sum
git commit -m "feat(state): add Redis-backed state manager for session persistence"
```

---

## Task 2: Create Session Manager

**Files:**
- Create: `backend/internals/session/session.go`
- Create: `backend/internals/session/manager.go`

**Step 1: Create session.go with Session struct**

```go
// backend/internals/session/session.go
package session

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/adityaadpandey/sfu-go/internals/state"
)

type Session struct {
	ID        string
	Token     string // For secure resume
	UserID    string
	RoomID    string
	Name      string
	PeerID    string // Current peer ID (changes on reconnect)

	MediaState state.MediaState
	Subscriptions []string

	CreatedAt time.Time
	LastSeen  time.Time
	Suspended bool
}

func NewSession(userID, roomID, name string) *Session {
	return &Session{
		ID:        generateID(),
		Token:     generateToken(),
		UserID:    userID,
		RoomID:    roomID,
		Name:      name,
		MediaState: state.MediaState{
			MicEnabled:    true,
			CameraEnabled: true,
			ScreenEnabled: false,
		},
		Subscriptions: []string{},
		CreatedAt:     time.Now(),
		LastSeen:      time.Now(),
		Suspended:     false,
	}
}

func (s *Session) ToStateData() *state.SessionData {
	return &state.SessionData{
		ID:            s.ID,
		UserID:        s.UserID,
		RoomID:        s.RoomID,
		Name:          s.Name,
		MediaState:    s.MediaState,
		Subscriptions: s.Subscriptions,
		CreatedAt:     s.CreatedAt,
		LastSeen:      s.LastSeen,
		Suspended:     s.Suspended,
	}
}

func FromStateData(data *state.SessionData) *Session {
	return &Session{
		ID:            data.ID,
		UserID:        data.UserID,
		RoomID:        data.RoomID,
		Name:          data.Name,
		MediaState:    data.MediaState,
		Subscriptions: data.Subscriptions,
		CreatedAt:     data.CreatedAt,
		LastSeen:      data.LastSeen,
		Suspended:     data.Suspended,
	}
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}
```

**Step 2: Create manager.go with SessionManager**

```go
// backend/internals/session/manager.go
package session

import (
	"fmt"
	"sync"
	"time"

	"github.com/adityaadpandey/sfu-go/internals/state"
	"go.uber.org/zap"
)

type Manager struct {
	sessions     map[string]*Session // sessionID -> Session
	userSessions map[string]string   // userID:roomID -> sessionID
	tokens       map[string]string   // token -> sessionID
	mu           sync.RWMutex

	stateManager *state.Manager
	logger       *zap.Logger
}

func NewManager(stateManager *state.Manager, logger *zap.Logger) *Manager {
	return &Manager{
		sessions:     make(map[string]*Session),
		userSessions: make(map[string]string),
		tokens:       make(map[string]string),
		stateManager: stateManager,
		logger:       logger,
	}
}

// CreateSession creates a new session for a user joining a room
func (m *Manager) CreateSession(userID, roomID, name string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if user already has a session in this room
	key := fmt.Sprintf("%s:%s", userID, roomID)
	if existingID, ok := m.userSessions[key]; ok {
		if existing, ok := m.sessions[existingID]; ok {
			// Reactivate suspended session
			if existing.Suspended {
				existing.Suspended = false
				existing.LastSeen = time.Now()
				existing.Token = generateToken() // New token for security
				m.tokens[existing.Token] = existing.ID
				m.stateManager.SetSession(existing.ToStateData())
				m.logger.Info("Reactivated suspended session",
					zap.String("sessionID", existing.ID),
					zap.String("userID", userID),
				)
				return existing, nil
			}
			return existing, nil
		}
	}

	sess := NewSession(userID, roomID, name)
	m.sessions[sess.ID] = sess
	m.userSessions[key] = sess.ID
	m.tokens[sess.Token] = sess.ID

	m.stateManager.SetSession(sess.ToStateData())

	m.logger.Info("Created new session",
		zap.String("sessionID", sess.ID),
		zap.String("userID", userID),
		zap.String("roomID", roomID),
	)

	return sess, nil
}

// GetSession retrieves a session by ID
func (m *Manager) GetSession(sessionID string) (*Session, bool) {
	m.mu.RLock()
	sess, ok := m.sessions[sessionID]
	m.mu.RUnlock()

	if ok {
		return sess, true
	}

	// Try to recover from state manager
	data, err := m.stateManager.GetSession(sessionID)
	if err != nil || data == nil {
		return nil, false
	}

	sess = FromStateData(data)
	m.mu.Lock()
	m.sessions[sess.ID] = sess
	m.userSessions[fmt.Sprintf("%s:%s", sess.UserID, sess.RoomID)] = sess.ID
	m.mu.Unlock()

	return sess, true
}

// ResumeSession attempts to resume a session with token verification
func (m *Manager) ResumeSession(sessionID, token string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Verify token
	storedSessionID, ok := m.tokens[token]
	if !ok || storedSessionID != sessionID {
		return nil, fmt.Errorf("invalid session token")
	}

	sess, ok := m.sessions[sessionID]
	if !ok {
		// Try to recover from Redis
		data, err := m.stateManager.GetSession(sessionID)
		if err != nil || data == nil {
			return nil, fmt.Errorf("session not found")
		}
		sess = FromStateData(data)
		m.sessions[sess.ID] = sess
	}

	if !sess.Suspended {
		return nil, fmt.Errorf("session is not suspended")
	}

	sess.Suspended = false
	sess.LastSeen = time.Now()
	sess.Token = generateToken()

	delete(m.tokens, token)
	m.tokens[sess.Token] = sess.ID

	m.stateManager.SetSession(sess.ToStateData())

	m.logger.Info("Resumed session",
		zap.String("sessionID", sess.ID),
		zap.String("userID", sess.UserID),
	)

	return sess, nil
}

// SuspendSession marks a session as suspended (disconnect grace period)
func (m *Manager) SuspendSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	sess, ok := m.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found")
	}

	sess.Suspended = true
	sess.LastSeen = time.Now()

	m.stateManager.SuspendSession(sessionID)

	m.logger.Info("Suspended session",
		zap.String("sessionID", sessionID),
		zap.String("userID", sess.UserID),
	)

	return nil
}

// DeleteSession permanently removes a session
func (m *Manager) DeleteSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	sess, ok := m.sessions[sessionID]
	if !ok {
		return nil
	}

	key := fmt.Sprintf("%s:%s", sess.UserID, sess.RoomID)
	delete(m.sessions, sessionID)
	delete(m.userSessions, key)
	delete(m.tokens, sess.Token)

	m.stateManager.DeleteSession(sessionID)

	return nil
}

// UpdatePeerID updates the peer ID for a session (after reconnect)
func (m *Manager) UpdatePeerID(sessionID, peerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if sess, ok := m.sessions[sessionID]; ok {
		sess.PeerID = peerID
		sess.LastSeen = time.Now()
		m.stateManager.SetSession(sess.ToStateData())
	}
}

// GetRoomSessions returns all active sessions in a room
func (m *Manager) GetRoomSessions(roomID string) []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var sessions []*Session
	for _, sess := range m.sessions {
		if sess.RoomID == roomID && !sess.Suspended {
			sessions = append(sessions, sess)
		}
	}
	return sessions
}

// CleanupExpiredSessions removes sessions that have been suspended past TTL
func (m *Manager) CleanupExpiredSessions(ttl time.Duration) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	removed := 0

	for id, sess := range m.sessions {
		if sess.Suspended && now.Sub(sess.LastSeen) > ttl {
			key := fmt.Sprintf("%s:%s", sess.UserID, sess.RoomID)
			delete(m.sessions, id)
			delete(m.userSessions, key)
			delete(m.tokens, sess.Token)
			m.stateManager.DeleteSession(id)
			removed++
		}
	}

	if removed > 0 {
		m.logger.Info("Cleaned up expired sessions", zap.Int("count", removed))
	}

	return removed
}
```

**Step 3: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add backend/internals/session/
git commit -m "feat(session): add session manager for connection resilience"
```

---

## Task 3: Add Perfect Negotiation to Peer

**Files:**
- Modify: `backend/internals/peer/peer.go`

**Step 1: Add negotiation state fields to Peer struct**

In `backend/internals/peer/peer.go`, add after line 55 (before `logger`):

```go
	// Perfect negotiation state (server is impolite)
	makingOffer     bool
	ignoreOffer     bool
	isSettingRemote bool
```

**Step 2: Add negotiation methods**

Add these methods after the `SetRemoteDescription` method (around line 371):

```go
// --- Perfect Negotiation (Server = Impolite) ---

// ShouldIgnoreOffer returns true if we should ignore incoming offer (we're mid-negotiation)
func (p *Peer) ShouldIgnoreOffer() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.makingOffer || p.isSettingRemote
}

// SetMakingOffer marks that we're in the process of creating an offer
func (p *Peer) SetMakingOffer(v bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.makingOffer = v
}

// SetSettingRemote marks that we're in the process of setting remote description
func (p *Peer) SetSettingRemote(v bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.isSettingRemote = v
}

// CreateOfferWithNegotiation creates offer with perfect negotiation state tracking
func (p *Peer) CreateOfferWithNegotiation() (*webrtc.SessionDescription, error) {
	p.SetMakingOffer(true)
	defer p.SetMakingOffer(false)

	p.mu.RLock()
	pc := p.Connection
	p.mu.RUnlock()

	if pc == nil {
		return nil, fmt.Errorf("peer connection not initialized")
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return nil, err
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		return nil, err
	}

	return &offer, nil
}

// SetRemoteDescriptionWithNegotiation sets remote description with perfect negotiation
func (p *Peer) SetRemoteDescriptionWithNegotiation(desc webrtc.SessionDescription) error {
	p.SetSettingRemote(true)
	defer p.SetSettingRemote(false)

	return p.SetRemoteDescription(desc)
}
```

**Step 3: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add backend/internals/peer/peer.go
git commit -m "feat(peer): add perfect negotiation state tracking"
```

---

## Task 4: Add ICE Restart Support

**Files:**
- Modify: `backend/internals/peer/peer.go`
- Modify: `backend/internals/signaling/websocket.go`

**Step 1: Add ICE restart method to Peer**

Add to `backend/internals/peer/peer.go` after the perfect negotiation methods:

```go
// RequestICERestart creates a new offer with ICE restart flag
func (p *Peer) RequestICERestart() (*webrtc.SessionDescription, error) {
	p.mu.RLock()
	pc := p.Connection
	p.mu.RUnlock()

	if pc == nil {
		return nil, fmt.Errorf("peer connection not initialized")
	}

	p.SetMakingOffer(true)
	defer p.SetMakingOffer(false)

	offer, err := pc.CreateOffer(&webrtc.OfferOptions{
		ICERestart: true,
	})
	if err != nil {
		return nil, err
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		return nil, err
	}

	p.logger.Info("ICE restart initiated", zap.String("peerID", p.ID))

	return &offer, nil
}
```

**Step 2: Add ICE restart message types to signaling**

In `backend/internals/signaling/websocket.go`, add after line 35:

```go
	MessageTypeICERestartRequest MessageType = "ice-restart-request"
	MessageTypeICERestartOffer   MessageType = "ice-restart-offer"
```

**Step 3: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add backend/internals/peer/peer.go backend/internals/signaling/websocket.go
git commit -m "feat: add ICE restart support for connection recovery"
```

---

## Task 5: Add Track Subscription Types

**Files:**
- Create: `backend/internals/subscription/manager.go`
- Modify: `backend/internals/signaling/websocket.go`

**Step 1: Create subscription manager**

```go
// backend/internals/subscription/manager.go
package subscription

import (
	"sync"
)

type Subscription struct {
	PeerID  string `json:"peerId"`
	TrackID string `json:"trackId"`
	Kind    string `json:"kind"`
	Layer   string `json:"layer"` // simulcast layer
	Active  bool   `json:"active"`
}

type Manager struct {
	// peerID -> trackID -> Subscription
	subscriptions map[string]map[string]*Subscription
	mu            sync.RWMutex

	// Auto-subscribe mode (backwards compatible)
	autoSubscribe bool
}

func NewManager(autoSubscribe bool) *Manager {
	return &Manager{
		subscriptions: make(map[string]map[string]*Subscription),
		autoSubscribe: autoSubscribe,
	}
}

func (m *Manager) IsAutoSubscribe() bool {
	return m.autoSubscribe
}

func (m *Manager) Subscribe(peerID, trackID, kind, layer string) *Subscription {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.subscriptions[peerID] == nil {
		m.subscriptions[peerID] = make(map[string]*Subscription)
	}

	sub := &Subscription{
		PeerID:  peerID,
		TrackID: trackID,
		Kind:    kind,
		Layer:   layer,
		Active:  true,
	}

	m.subscriptions[peerID][trackID] = sub
	return sub
}

func (m *Manager) Unsubscribe(peerID, trackID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if subs, ok := m.subscriptions[peerID]; ok {
		if _, exists := subs[trackID]; exists {
			delete(subs, trackID)
			return true
		}
	}
	return false
}

func (m *Manager) GetSubscription(peerID, trackID string) (*Subscription, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if subs, ok := m.subscriptions[peerID]; ok {
		if sub, exists := subs[trackID]; exists {
			return sub, true
		}
	}
	return nil, false
}

func (m *Manager) GetPeerSubscriptions(peerID string) []*Subscription {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*Subscription
	if subs, ok := m.subscriptions[peerID]; ok {
		for _, sub := range subs {
			result = append(result, sub)
		}
	}
	return result
}

func (m *Manager) IsSubscribed(peerID, trackID string) bool {
	_, ok := m.GetSubscription(peerID, trackID)
	return ok
}

func (m *Manager) SetLayer(peerID, trackID, layer string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if subs, ok := m.subscriptions[peerID]; ok {
		if sub, exists := subs[trackID]; exists {
			sub.Layer = layer
			return true
		}
	}
	return false
}

func (m *Manager) RemovePeer(peerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.subscriptions, peerID)
}

func (m *Manager) RemoveTrack(trackID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, subs := range m.subscriptions {
		delete(subs, trackID)
	}
}
```

**Step 2: Add subscription message types to signaling**

In `backend/internals/signaling/websocket.go`, add after the ICE restart types:

```go
	MessageTypeTrackPublished   MessageType = "track-published"
	MessageTypeSubscribe        MessageType = "subscribe"
	MessageTypeUnsubscribe      MessageType = "unsubscribe"
	MessageTypeSubscriptionAck  MessageType = "subscription-ack"
```

**Step 3: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add backend/internals/subscription/ backend/internals/signaling/websocket.go
git commit -m "feat(subscription): add track subscription manager and message types"
```

---

## Task 6: Add Enhanced Metrics

**Files:**
- Create: `backend/internals/metrics/metrics.go`
- Modify: `backend/internals/sfu/sfu.go`

**Step 1: Create metrics package**

```go
// backend/internals/metrics/metrics.go
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Connection health
	ICEConnectionState = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sfu_ice_connection_state",
		Help: "Current ICE connection state counts",
	}, []string{"state"})

	ICERestartsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sfu_ice_restarts_total",
		Help: "Total number of ICE restarts",
	})

	SessionRecoveriesTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sfu_session_recoveries_total",
		Help: "Total successful session recoveries",
	})

	SessionRecoveryFailuresTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sfu_session_recovery_failures_total",
		Help: "Total failed session recovery attempts",
	})

	// Media quality
	TrackBitrateBytes = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sfu_track_bitrate_bytes",
		Help: "Current track bitrate in bytes per second",
	}, []string{"peer", "track", "direction"})

	PacketLossRatio = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sfu_packet_loss_ratio",
		Help: "Current packet loss ratio per peer",
	}, []string{"peer"})

	JitterMs = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sfu_jitter_ms",
		Help:    "Jitter in milliseconds",
		Buckets: []float64{1, 5, 10, 20, 50, 100, 200},
	}, []string{"peer"})

	RttMs = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "sfu_rtt_ms",
		Help:    "Round-trip time in milliseconds",
		Buckets: []float64{10, 25, 50, 100, 200, 500, 1000},
	}, []string{"peer"})

	PLIRequestsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sfu_pli_requests_total",
		Help: "Total Picture Loss Indication requests",
	})

	NACKRequestsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sfu_nack_requests_total",
		Help: "Total Negative Acknowledgement requests",
	})

	// Subscription model
	SubscriptionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "sfu_subscriptions_active",
		Help: "Number of active track subscriptions",
	})

	SubscriptionChangesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sfu_subscription_changes_total",
		Help: "Total subscription changes",
	}, []string{"action"})

	// Redis health
	RedisLatencyMs = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "sfu_redis_latency_ms",
		Help:    "Redis operation latency in milliseconds",
		Buckets: []float64{0.5, 1, 2, 5, 10, 25, 50},
	})

	RedisErrorsTotal = promauto.NewCounter(prometheus.CounterOpts{
		Name: "sfu_redis_errors_total",
		Help: "Total Redis errors",
	})

	StateRecoveryDurationMs = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "sfu_state_recovery_duration_ms",
		Help:    "State recovery duration in milliseconds",
		Buckets: []float64{10, 50, 100, 250, 500, 1000, 2000},
	})

	// Scalability
	GoroutinesPerRoom = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sfu_goroutines_per_room",
		Help: "Number of goroutines per room",
	}, []string{"room"})

	MemoryPerPeerBytes = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "sfu_memory_per_peer_bytes",
		Help: "Estimated memory usage per peer",
	}, []string{"peer"})

	// Sessions
	ActiveSessions = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "sfu_active_sessions_total",
		Help: "Number of active sessions",
	})

	SuspendedSessions = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "sfu_suspended_sessions_total",
		Help: "Number of suspended sessions",
	})
)

// Helper functions

func RecordICEState(state string, delta float64) {
	ICEConnectionState.WithLabelValues(state).Add(delta)
}

func RecordICERestart() {
	ICERestartsTotal.Inc()
}

func RecordSessionRecovery(success bool) {
	if success {
		SessionRecoveriesTotal.Inc()
	} else {
		SessionRecoveryFailuresTotal.Inc()
	}
}

func RecordSubscription(action string) {
	SubscriptionChangesTotal.WithLabelValues(action).Inc()
}

func RecordPLI() {
	PLIRequestsTotal.Inc()
}

func RecordNACK() {
	NACKRequestsTotal.Inc()
}
```

**Step 2: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add backend/internals/metrics/
git commit -m "feat(metrics): add comprehensive Prometheus metrics for monitoring"
```

---

## Task 7: Integrate Session Manager into SFU

**Files:**
- Modify: `backend/internals/sfu/sfu.go`
- Modify: `backend/internals/config/config.go`

**Step 1: Add session config options**

In `backend/internals/config/config.go`, add to `MediaConfig` struct (around line 89):

```go
	// Session management
	SessionTTL       time.Duration `yaml:"session_ttl"`
	AutoSubscribe    bool          `yaml:"auto_subscribe"`
```

And in `LoadConfig()`, add to MediaConfig initialization (around line 143):

```go
			SessionTTL:               time.Duration(getEnvInt("SFU_SESSION_TTL_SEC", 30)) * time.Second,
			AutoSubscribe:            getEnvBool("SFU_AUTO_SUBSCRIBE", true),
```

**Step 2: Add session manager to SFU struct**

In `backend/internals/sfu/sfu.go`, add imports:

```go
	"github.com/adityaadpandey/sfu-go/internals/session"
	"github.com/adityaadpandey/sfu-go/internals/state"
	"github.com/adityaadpandey/sfu-go/internals/subscription"
	appmetrics "github.com/adityaadpandey/sfu-go/internals/metrics"
```

Add to SFU struct (after `metrics *Metrics`):

```go
	stateManager       *state.Manager
	sessionManager     *session.Manager
	subscriptionMgr    *subscription.Manager
```

**Step 3: Initialize managers in NewSFU**

Replace the `NewSFU` function:

```go
func NewSFU(cfg *config.Config) (*SFU, error) {
	logger := utils.GetLogger()
	ctx, cancel := context.WithCancel(context.Background())

	// Initialize state manager (Redis)
	stateManager, err := state.NewManager(
		cfg.Redis.Addr,
		cfg.Redis.Password,
		cfg.Redis.DB,
		logger,
	)
	if err != nil {
		logger.Warn("Redis connection failed, running without persistence", zap.Error(err))
		stateManager = nil
	}

	// Initialize session manager
	var sessionManager *session.Manager
	if stateManager != nil {
		sessionManager = session.NewManager(stateManager, logger)
		// Recover sessions from previous run
		recovered, _ := stateManager.RecoverSessions()
		if recovered > 0 {
			logger.Info("Recovered sessions from Redis", zap.Int("count", recovered))
		}
	}

	sfu := &SFU{
		config:          cfg,
		logger:          logger,
		rooms:           make(map[string]*room.Room),
		signalingHub:    signaling.NewHub(logger),
		rateLimiters:    make(map[string]*rate.Limiter),
		stateManager:    stateManager,
		sessionManager:  sessionManager,
		subscriptionMgr: subscription.NewManager(cfg.Media.AutoSubscribe),
		ctx:             ctx,
		cancel:          cancel,
	}

	sfu.setupWebRTCConfig()
	sfu.setupMetrics()

	// Start session cleanup loop
	if sessionManager != nil {
		go sfu.sessionCleanupLoop()
	}

	return sfu, nil
}
```

**Step 4: Add session cleanup loop**

Add after `roomCleanupLoop`:

```go
// sessionCleanupLoop periodically removes expired suspended sessions.
func (s *SFU) sessionCleanupLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			if s.sessionManager != nil {
				removed := s.sessionManager.CleanupExpiredSessions(s.config.Media.SessionTTL)
				if removed > 0 {
					appmetrics.SuspendedSessions.Sub(float64(removed))
				}
			}
		}
	}
}
```

**Step 5: Update handleJoinMessage for session support**

Replace the `handleJoinMessage` function to support session resume:

```go
func (s *SFU) handleJoinMessage(client *signaling.Client, message signaling.Message) {
	var joinMsg struct {
		signaling.JoinMessage
		SessionID    string `json:"sessionId,omitempty"`
		SessionToken string `json:"sessionToken,omitempty"`
	}
	if err := unmarshalMessageData(message.Data, &joinMsg); err != nil {
		client.SendError(400, "Invalid join message format")
		return
	}

	if err := s.validateID(joinMsg.RoomID, s.config.Media.MaxRoomIDLength, "roomId"); err != nil {
		client.SendError(400, err.Error())
		return
	}
	if err := s.validateID(joinMsg.UserID, s.config.Media.MaxUserIDLength, "userId"); err != nil {
		client.SendError(400, err.Error())
		return
	}

	// Try to resume existing session
	var sess *session.Session
	var resumed bool
	if s.sessionManager != nil && joinMsg.SessionID != "" && joinMsg.SessionToken != "" {
		var err error
		sess, err = s.sessionManager.ResumeSession(joinMsg.SessionID, joinMsg.SessionToken)
		if err != nil {
			s.logger.Debug("Session resume failed", zap.Error(err))
			appmetrics.RecordSessionRecovery(false)
		} else {
			resumed = true
			appmetrics.RecordSessionRecovery(true)
			s.logger.Info("Session resumed",
				zap.String("sessionID", sess.ID),
				zap.String("userID", sess.UserID),
			)
		}
	}

	// Create new session if not resumed
	if sess == nil && s.sessionManager != nil {
		var err error
		sess, err = s.sessionManager.CreateSession(joinMsg.UserID, joinMsg.RoomID, joinMsg.Name)
		if err != nil {
			s.logger.Error("Failed to create session", zap.Error(err))
		}
		appmetrics.ActiveSessions.Inc()
	}

	rm := s.getOrCreateRoom(joinMsg.RoomID)
	if rm == nil {
		client.SendError(500, "Failed to create room")
		return
	}

	// Evict old peer if same userId is already in the room (page refresh)
	if oldPeer, ok := rm.GetPeerByUserID(joinMsg.UserID); ok {
		s.logger.Info("Evicting stale peer for reconnecting user",
			zap.String("userID", joinMsg.UserID),
			zap.String("oldPeerID", oldPeer.ID),
		)
		rm.RemovePeer(oldPeer.ID)
	}

	// Evict old WS clients for this userId (stale connections from refresh)
	s.signalingHub.DisconnectClientsByUserID(joinMsg.UserID, client.ID)

	p := peer.NewPeer(joinMsg.RoomID, joinMsg.UserID, joinMsg.Name, s.logger)
	if err := p.CreatePeerConnection(s.webrtcAPI, s.webrtcConfig); err != nil {
		s.logger.Error("Failed to create peer connection", zap.Error(err))
		client.SendError(500, "Failed to create peer connection")
		return
	}

	p.OnICECandidateGenerated = s.handleServerICECandidate

	if err := rm.AddPeer(p); err != nil {
		s.logger.Error("Failed to add peer to room", zap.Error(err))
		client.SendError(400, err.Error())
		return
	}

	// Link session to peer
	if sess != nil {
		s.sessionManager.UpdatePeerID(sess.ID, p.ID)
	}

	client.RoomID = joinMsg.RoomID
	client.UserID = joinMsg.UserID
	client.Name = joinMsg.Name

	s.metrics.TotalConnections.Inc()
	s.updateMetrics()

	// Build response with session info
	responseData := map[string]interface{}{
		"success": true,
		"peerId":  p.ID,
		"roomId":  rm.ID,
		"resumed": resumed,
	}
	if sess != nil {
		responseData["sessionId"] = sess.ID
		responseData["sessionToken"] = sess.Token
	}

	data, err := json.Marshal(responseData)
	if err != nil {
		client.SendError(500, "Internal server error")
		return
	}
	client.SendMessage(signaling.Message{
		Type: signaling.MessageTypeJoin, Data: data, Timestamp: time.Now(),
	})

	s.logger.Info("Peer joined",
		zap.String("room", joinMsg.RoomID),
		zap.String("peer", p.ID),
		zap.String("name", joinMsg.Name),
		zap.Bool("resumed", resumed),
	)

	// Notify other peers
	s.broadcastPeerEvent(joinMsg.RoomID, p, signaling.MessageTypePeerJoined, client.ID)

	// Send room state to the new peer
	s.sendRoomState(client, rm, p.ID)
}
```

**Step 6: Add ICE restart handler**

Add to `handleSignalingMessage` switch statement:

```go
	case signaling.MessageTypeICERestartRequest:
		s.handleICERestartRequest(client)
```

Add the handler function:

```go
func (s *SFU) handleICERestartRequest(client *signaling.Client) {
	_, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if p == nil {
		client.SendError(404, "Peer not found")
		return
	}

	offer, err := p.RequestICERestart()
	if err != nil {
		s.logger.Error("ICE restart failed", zap.Error(err))
		client.SendError(500, "ICE restart failed")
		return
	}

	appmetrics.RecordICERestart()

	data, err := json.Marshal(map[string]interface{}{
		"sdp":    offer.SDP,
		"type":   "offer",
		"peerId": p.ID,
	})
	if err != nil {
		return
	}

	client.SendMessage(signaling.Message{
		Type: signaling.MessageTypeICERestartOffer, Data: data, Timestamp: time.Now(),
	})
}
```

**Step 7: Update handleClientDisconnect for session suspension**

Replace `handleClientDisconnect`:

```go
func (s *SFU) handleClientDisconnect(client *signaling.Client) {
	if client.RoomID == "" {
		s.removeClientRateLimiter(client.ID)
		return
	}

	// Suspend session instead of deleting
	if s.sessionManager != nil {
		sessions := s.sessionManager.GetRoomSessions(client.RoomID)
		for _, sess := range sessions {
			if sess.UserID == client.UserID {
				s.sessionManager.SuspendSession(sess.ID)
				appmetrics.ActiveSessions.Dec()
				appmetrics.SuspendedSessions.Inc()
				break
			}
		}
	}

	s.handleLeaveMessage(client)
	s.removeClientRateLimiter(client.ID)
}
```

**Step 8: Verify compilation**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 9: Commit**

```bash
git add backend/internals/sfu/sfu.go backend/internals/config/config.go
git commit -m "feat(sfu): integrate session manager with session recovery and ICE restart"
```

---

## Task 8: Update Frontend for Session-Aware Reconnection

**Files:**
- Modify: `frontend/hooks/useWebRTC.ts`
- Modify: `frontend/store/useRoomStore.ts`

**Step 1: Add session state to store**

In `frontend/store/useRoomStore.ts`, add to interface (around line 55):

```typescript
    // Session management
    sessionId: string | null;
    sessionToken: string | null;

    // Actions
    setSessionInfo: (sessionId: string, sessionToken: string) => void;
```

Add to initial state (around line 115):

```typescript
    sessionId: null,
    sessionToken: null,
```

Add action (around line 185):

```typescript
    setSessionInfo: (sessionId, sessionToken) => set({ sessionId, sessionToken }),
```

Add to reset (around line 235):

```typescript
        sessionId: null,
        sessionToken: null,
```

**Step 2: Update useWebRTC for session support**

In `frontend/hooks/useWebRTC.ts`, update the imports and add session refs:

After line 44, add:

```typescript
    const {
        // ... existing
        sessionId,
        sessionToken,
        setSessionInfo,
    } = useRoomStore();
```

After line 66, add:

```typescript
    // Session refs for reconnection
    const sessionIdRef = useRef<string | null>(null);
    const sessionTokenRef = useRef<string | null>(null);
```

**Step 3: Update connect function for session resume**

In the `ws.onopen` handler (around line 609), update the join message:

```typescript
        ws.onopen = () => {
            log("Connected to server", "success");
            sendSignalingMessage({
                type: "join",
                data: {
                    roomId: newRoomId,
                    userId: newUserId,
                    name: newName,
                    sessionId: sessionIdRef.current,
                    sessionToken: sessionTokenRef.current,
                },
            });
        };
```

**Step 4: Handle session info in join response**

In `handleSignalingMessage`, update the "join" case (around line 418):

```typescript
            case "join": // Ack from server
                if (!msg.data || typeof msg.data !== 'object' || !('success' in msg.data)) return;
                const joinData = msg.data as {
                    success: boolean;
                    peerId?: string;
                    sessionId?: string;
                    sessionToken?: string;
                    resumed?: boolean;
                };
                if (!joinData.success || !joinData.peerId) {
                    log("Join failed", "error");
                    return;
                }
                peerIdRef.current = joinData.peerId;

                // Store session info for reconnection
                if (joinData.sessionId && joinData.sessionToken) {
                    sessionIdRef.current = joinData.sessionId;
                    sessionTokenRef.current = joinData.sessionToken;
                    setSessionInfo(joinData.sessionId, joinData.sessionToken);
                }

                const resumeMsg = joinData.resumed ? " (session resumed)" : "";
                log(`Joined room - peer ${joinData.peerId.slice(0, 8)}${resumeMsg}`, "success");
                setStatus("connected");
                await createPeerConnection();
                break;
```

**Step 5: Add ICE restart handling**

Add to the `createPeerConnection` function, in `pc.onconnectionstatechange`:

```typescript
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            log("Connection: " + state, state === 'connected' ? "success" : "info");
            if (state === 'connected') {
                startStatsTracking();
                if (negPendRef.current) {
                    negPendRef.current = false;
                    negotiate();
                }
            } else if (state === 'disconnected') {
                // Request ICE restart after 3 seconds of disconnected state
                setTimeout(() => {
                    if (pcRef.current?.connectionState === 'disconnected') {
                        log("Requesting ICE restart", "warning");
                        sendSignalingMessage({ type: "ice-restart-request", data: {} });
                    }
                }, 3000);
            } else if (state === 'failed') {
                log("WebRTC failed, closing WebSocket to trigger reconnect", "error");
                try { wsRef.current?.close(); } catch { /* ignore */ }
            } else if (state === 'closed') {
                if (statsIntervalRef.current) {
                    clearInterval(statsIntervalRef.current);
                    statsIntervalRef.current = null;
                }
            }
        };
```

**Step 6: Handle ICE restart offer**

Add to `handleSignalingMessage` switch:

```typescript
            case "ice-restart-offer":
                if (!pcRef.current || !msg.data || typeof msg.data !== 'object') return;
                const iceRestartData = msg.data as { sdp: string };
                try {
                    await pcRef.current.setRemoteDescription(
                        new RTCSessionDescription({ type: "offer", sdp: iceRestartData.sdp })
                    );
                    const answer = await pcRef.current.createAnswer();
                    await pcRef.current.setLocalDescription(answer);
                    sendSignalingMessage({
                        type: "answer",
                        data: { sdp: answer.sdp, type: "answer", peerId: peerIdRef.current }
                    });
                    log("ICE restart completed", "success");
                } catch (e) {
                    log("ICE restart failed: " + e, "error");
                }
                break;
```

**Step 7: Update cleanup to preserve session on reconnect**

In the `cleanup` function, DON'T clear session refs (they're needed for reconnect):

```typescript
    const cleanup = useCallback(() => {
        if (statsIntervalRef.current) {
            clearInterval(statsIntervalRef.current);
            statsIntervalRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        // Don't stop local stream on reconnect - preserve media
        // if (localStreamRef.current) { ... }

        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        if (cameraTrackBeforeScreenRef.current) {
            cameraTrackBeforeScreenRef.current.stop();
            cameraTrackBeforeScreenRef.current = null;
        }

        negRef.current = false;
        negPendRef.current = false;
        negReadyRef.current = false;
        iceBufRef.current = [];
        peerIdRef.current = "";
        // Keep sessionIdRef and sessionTokenRef for reconnection

        if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
    }, []);
```

**Step 8: Clear session on explicit disconnect**

In the `disconnect` function:

```typescript
    const disconnect = useCallback(() => {
        disconnectRequestedRef.current = true;
        // Clear session on explicit disconnect
        sessionIdRef.current = null;
        sessionTokenRef.current = null;

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            sendSignalingMessage({
                type: "leave",
                data: {}
            });
            wsRef.current.close();
        }

        // Stop local stream on explicit disconnect
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }

        cleanup();
        reset();
        log("Left room", "info");
    }, [sendSignalingMessage, cleanup, reset, log]);
```

**Step 9: Commit**

```bash
git add frontend/hooks/useWebRTC.ts frontend/store/useRoomStore.ts
git commit -m "feat(frontend): add session-aware reconnection and ICE restart support"
```

---

## Task 9: Add Perfect Negotiation to Frontend

**Files:**
- Modify: `frontend/hooks/useWebRTC.ts`

**Step 1: Add perfect negotiation refs**

After the existing negotiation refs (around line 59), add:

```typescript
    // Perfect negotiation (client is polite)
    const makingOfferRef = useRef(false);
    const ignoreOfferRef = useRef(false);
```

**Step 2: Update negotiate function for perfect negotiation**

Replace the `negotiate` function:

```typescript
    const negotiate = useCallback(async () => {
        if (!pcRef.current) return;

        // Perfect negotiation: track that we're making an offer
        makingOfferRef.current = true;
        negRef.current = true;
        negPendRef.current = false;

        try {
            const offer = await pcRef.current.createOffer();

            // Check if signaling state changed during createOffer
            if (pcRef.current.signalingState !== "stable") {
                makingOfferRef.current = false;
                negRef.current = false;
                return;
            }

            await pcRef.current.setLocalDescription(offer);

            sendSignalingMessage({
                type: "offer",
                data: {
                    sdp: offer.sdp!,
                    type: "offer",
                    peerId: peerIdRef.current
                }
            });
        } catch (e) {
            log("Offer error: " + e, "error");
            if (negPendRef.current) {
                setTimeout(() => negotiate(), 50);
            }
        } finally {
            makingOfferRef.current = false;
            negRef.current = false;
        }
    }, [sendSignalingMessage, log]);
```

**Step 3: Add incoming offer handler with perfect negotiation**

Add new function before `handleSignalingMessage`:

```typescript
    const handleIncomingOffer = useCallback(async (sdp: string) => {
        if (!pcRef.current) return;

        // Perfect negotiation: client is polite, check for collision
        const offerCollision = makingOfferRef.current ||
            pcRef.current.signalingState !== "stable";

        if (offerCollision) {
            // We're polite, so we rollback our offer and accept theirs
            log("Offer collision detected, rolling back", "warning");
            await pcRef.current.setLocalDescription({ type: "rollback" });
        }

        await pcRef.current.setRemoteDescription(
            new RTCSessionDescription({ type: "offer", sdp })
        );

        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);

        sendSignalingMessage({
            type: "answer",
            data: {
                sdp: answer.sdp!,
                type: "answer",
                peerId: peerIdRef.current
            }
        });
    }, [sendSignalingMessage, log]);
```

**Step 4: Handle server-initiated offers**

Add to `handleSignalingMessage` switch (for when server sends offers during renegotiation):

```typescript
            case "offer":
                if (!msg.data || typeof msg.data !== 'object') return;
                const serverOfferData = msg.data as { sdp: string };
                try {
                    await handleIncomingOffer(serverOfferData.sdp);
                } catch (e) {
                    log("Failed to handle server offer: " + e, "error");
                }
                break;
```

**Step 5: Commit**

```bash
git add frontend/hooks/useWebRTC.ts
git commit -m "feat(frontend): implement perfect negotiation pattern (client as polite)"
```

---

## Task 10: Add Track Subscription Messages to Frontend

**Files:**
- Modify: `frontend/hooks/useWebRTC.ts`
- Modify: `frontend/store/useRoomStore.ts`

**Step 1: Add available tracks state to store**

In `frontend/store/useRoomStore.ts`, add to interface:

```typescript
    // Track subscription
    availableTracks: Record<string, { trackId: string; kind: string; peerId: string }[]>;

    // Actions
    addAvailableTrack: (peerId: string, track: { trackId: string; kind: string; peerId: string }) => void;
    removeAvailableTrack: (peerId: string, trackId: string) => void;
    clearAvailableTracks: (peerId: string) => void;
```

Add to initial state:

```typescript
    availableTracks: {},
```

Add actions:

```typescript
    addAvailableTrack: (peerId, track) => set((state) => ({
        availableTracks: {
            ...state.availableTracks,
            [peerId]: [...(state.availableTracks[peerId] || []), track]
        }
    })),

    removeAvailableTrack: (peerId, trackId) => set((state) => ({
        availableTracks: {
            ...state.availableTracks,
            [peerId]: (state.availableTracks[peerId] || []).filter(t => t.trackId !== trackId)
        }
    })),

    clearAvailableTracks: (peerId) => set((state) => {
        const { [peerId]: _, ...rest } = state.availableTracks;
        return { availableTracks: rest };
    }),
```

Add to reset:

```typescript
        availableTracks: {},
```

**Step 2: Add subscription functions to useWebRTC**

In `frontend/hooks/useWebRTC.ts`, add after `switchLayer`:

```typescript
    const subscribeToTrack = useCallback((trackId: string, peerId: string, layer?: string) => {
        sendSignalingMessage({
            type: "subscribe",
            data: { trackId, peerId, layer: layer || "h" }
        });
        log(`Subscribed to track ${trackId.slice(0, 8)}`, "info");
    }, [sendSignalingMessage, log]);

    const unsubscribeFromTrack = useCallback((trackId: string, peerId: string) => {
        sendSignalingMessage({
            type: "unsubscribe",
            data: { trackId, peerId }
        });
        log(`Unsubscribed from track ${trackId.slice(0, 8)}`, "info");
    }, [sendSignalingMessage, log]);
```

**Step 3: Handle track-published message**

Add to `handleSignalingMessage`:

```typescript
            case "track-published":
                if (msg.data && typeof msg.data === 'object') {
                    const trackData = msg.data as { trackId: string; kind: string; peerId: string };
                    addAvailableTrack(trackData.peerId, trackData);
                    log(`Track available: ${trackData.kind} from ${trackData.peerId.slice(0, 8)}`, "info");
                }
                break;

            case "subscription-ack":
                if (msg.data && typeof msg.data === 'object') {
                    const ackData = msg.data as { trackId: string; success: boolean };
                    if (ackData.success) {
                        log(`Subscription confirmed: ${ackData.trackId.slice(0, 8)}`, "success");
                    }
                }
                break;
```

**Step 4: Export new functions**

Update the return statement:

```typescript
    return {
        connect,
        disconnect,
        toggleMic,
        toggleCamera,
        toggleScreenShare,
        switchLayer,
        subscribeToTrack,
        unsubscribeFromTrack,
    };
```

**Step 5: Commit**

```bash
git add frontend/hooks/useWebRTC.ts frontend/store/useRoomStore.ts
git commit -m "feat(frontend): add track subscription support"
```

---

## Task 11: Final Integration Test

**Step 1: Build backend**

Run: `cd backend && go build -o sfu ./cmd/sfu`
Expected: Build succeeds

**Step 2: Build frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 3: Run integration test**

Run: `cd backend && go test ./... -v`
Expected: All tests pass

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete SFU resilience and scalability implementation"
```

---

## Summary

This plan implements:

1. **Redis State Layer** - Persistent session storage with write-through caching
2. **Session Manager** - 30-second TTL suspension for seamless reconnection
3. **Perfect Negotiation** - Server impolite, client polite pattern
4. **ICE Restart** - Connection path recovery without full reconnect
5. **Track Subscription** - Foundation for selective forwarding (auto-subscribe by default)
6. **Enhanced Metrics** - 20+ new Prometheus metrics for observability
7. **Frontend Integration** - Session-aware reconnection and ICE restart support

All changes are backwards compatible with existing clients.

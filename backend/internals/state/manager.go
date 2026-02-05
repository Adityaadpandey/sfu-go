package state

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// MediaState represents the current media state of a peer
type MediaState struct {
	MicEnabled    bool `json:"mic_enabled"`
	CameraEnabled bool `json:"camera_enabled"`
	ScreenEnabled bool `json:"screen_enabled"`
}

// SessionData represents a peer's session information
type SessionData struct {
	ID            string            `json:"id"`
	UserID        string            `json:"user_id"`
	RoomID        string            `json:"room_id"`
	Name          string            `json:"name"`
	MediaState    MediaState        `json:"media_state"`
	Subscriptions map[string]bool   `json:"subscriptions"` // trackID -> subscribed
	CreatedAt     time.Time         `json:"created_at"`
	LastSeen      time.Time         `json:"last_seen"`
	Suspended     bool              `json:"suspended"`
}

// Manager handles session state with local cache and Redis persistence
type Manager struct {
	local  *sync.Map
	redis  *redis.Client
	logger *zap.Logger
	ctx    context.Context
	cancel context.CancelFunc
}

// NewManager creates a new state manager with Redis connection
func NewManager(redisAddr, redisPassword string, redisDB int, logger *zap.Logger) (*Manager, error) {
	ctx, cancel := context.WithCancel(context.Background())

	client := redis.NewClient(&redis.Options{
		Addr:         redisAddr,
		Password:     redisPassword,
		DB:           redisDB,
		PoolSize:     10,
		MinIdleConns: 2,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	// Test connection
	if err := client.Ping(ctx).Err(); err != nil {
		cancel()
		return nil, err
	}

	logger.Info("Redis connection established",
		zap.String("addr", redisAddr),
		zap.Int("db", redisDB),
	)

	return &Manager{
		local:  &sync.Map{},
		redis:  client,
		logger: logger,
		ctx:    ctx,
		cancel: cancel,
	}, nil
}

// SetSession stores a session with write-through caching
// Writes to local map immediately, then persists to Redis asynchronously
func (m *Manager) SetSession(session *SessionData) error {
	session.LastSeen = time.Now()

	// Store in local cache immediately
	m.local.Store(session.ID, session)

	// Persist to Redis asynchronously
	go func() {
		data, err := json.Marshal(session)
		if err != nil {
			m.logger.Error("Failed to marshal session",
				zap.String("session_id", session.ID),
				zap.Error(err),
			)
			return
		}

		key := SessionKey(session.ID)
		if err := m.redis.Set(m.ctx, key, data, 0).Err(); err != nil {
			m.logger.Error("Failed to persist session to Redis",
				zap.String("session_id", session.ID),
				zap.Error(err),
			)
			return
		}

		// Also add to room's peer set
		roomPeersKey := RoomPeersKey(session.RoomID)
		if err := m.redis.SAdd(m.ctx, roomPeersKey, session.ID).Err(); err != nil {
			m.logger.Error("Failed to add session to room peers set",
				zap.String("session_id", session.ID),
				zap.String("room_id", session.RoomID),
				zap.Error(err),
			)
		}
	}()

	return nil
}

// GetSession retrieves a session from local cache, falling back to Redis
func (m *Manager) GetSession(sessionID string) (*SessionData, error) {
	// Try local cache first
	if val, ok := m.local.Load(sessionID); ok {
		return val.(*SessionData), nil
	}

	// Fallback to Redis
	key := SessionKey(sessionID)
	data, err := m.redis.Get(m.ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil // Session not found
		}
		return nil, err
	}

	var session SessionData
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, err
	}

	// Cache locally
	m.local.Store(sessionID, &session)

	return &session, nil
}

// SuspendSession marks a session as suspended with TTL for reconnection window
func (m *Manager) SuspendSession(sessionID string) error {
	session, err := m.GetSession(sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return nil
	}

	session.Suspended = true
	session.LastSeen = time.Now()

	// Update local cache
	m.local.Store(sessionID, session)

	// Update Redis with TTL
	data, err := json.Marshal(session)
	if err != nil {
		return err
	}

	key := SessionKey(sessionID)
	if err := m.redis.Set(m.ctx, key, data, time.Duration(SessionTTL)*time.Second).Err(); err != nil {
		m.logger.Error("Failed to suspend session in Redis",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		return err
	}

	m.logger.Info("Session suspended",
		zap.String("session_id", sessionID),
		zap.Int("ttl_seconds", SessionTTL),
	)

	return nil
}

// DeleteSession removes a session from both local cache and Redis
func (m *Manager) DeleteSession(sessionID string) error {
	// Get session to find room ID
	session, _ := m.GetSession(sessionID)

	// Remove from local cache
	m.local.Delete(sessionID)

	// Remove from Redis
	key := SessionKey(sessionID)
	if err := m.redis.Del(m.ctx, key).Err(); err != nil {
		m.logger.Error("Failed to delete session from Redis",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		return err
	}

	// Remove from room's peer set
	if session != nil && session.RoomID != "" {
		roomPeersKey := RoomPeersKey(session.RoomID)
		if err := m.redis.SRem(m.ctx, roomPeersKey, sessionID).Err(); err != nil {
			m.logger.Error("Failed to remove session from room peers set",
				zap.String("session_id", sessionID),
				zap.String("room_id", session.RoomID),
				zap.Error(err),
			)
		}
	}

	m.logger.Info("Session deleted", zap.String("session_id", sessionID))

	return nil
}

// GetRoomSessions returns all non-suspended sessions for a room
func (m *Manager) GetRoomSessions(roomID string) ([]*SessionData, error) {
	roomPeersKey := RoomPeersKey(roomID)

	// Get all session IDs in the room
	sessionIDs, err := m.redis.SMembers(m.ctx, roomPeersKey).Result()
	if err != nil {
		return nil, err
	}

	var sessions []*SessionData
	for _, sessionID := range sessionIDs {
		session, err := m.GetSession(sessionID)
		if err != nil {
			m.logger.Warn("Failed to get session",
				zap.String("session_id", sessionID),
				zap.Error(err),
			)
			continue
		}
		if session != nil && !session.Suspended {
			sessions = append(sessions, session)
		}
	}

	return sessions, nil
}

// RecoverSessions scans Redis keys on startup to recover sessions
// Returns sessions that can be resumed (within TTL)
func (m *Manager) RecoverSessions() ([]*SessionData, error) {
	var recovered []*SessionData
	var cursor uint64

	for {
		keys, nextCursor, err := m.redis.Scan(m.ctx, cursor, KeyPrefixSession+"*", 100).Result()
		if err != nil {
			return nil, err
		}

		for _, key := range keys {
			data, err := m.redis.Get(m.ctx, key).Bytes()
			if err != nil {
				if err == redis.Nil {
					continue
				}
				m.logger.Warn("Failed to get session during recovery",
					zap.String("key", key),
					zap.Error(err),
				)
				continue
			}

			var session SessionData
			if err := json.Unmarshal(data, &session); err != nil {
				m.logger.Warn("Failed to unmarshal session during recovery",
					zap.String("key", key),
					zap.Error(err),
				)
				continue
			}

			// Cache locally
			m.local.Store(session.ID, &session)
			recovered = append(recovered, &session)
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	m.logger.Info("Session recovery completed",
		zap.Int("recovered_count", len(recovered)),
	)

	return recovered, nil
}

// Ping checks Redis connection health
func (m *Manager) Ping() error {
	return m.redis.Ping(m.ctx).Err()
}

// GetRedisClient returns the underlying Redis client for pub/sub operations
func (m *Manager) GetRedisClient() *redis.Client {
	return m.redis
}

// Close cleans up resources
func (m *Manager) Close() error {
	m.cancel()

	if err := m.redis.Close(); err != nil {
		m.logger.Error("Failed to close Redis connection", zap.Error(err))
		return err
	}

	m.logger.Info("State manager closed")
	return nil
}

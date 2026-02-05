package session

import (
	"fmt"
	"sync"
	"time"

	"github.com/adityaadpandey/sfu-go/internals/state"
	"go.uber.org/zap"
)

// Manager handles session lifecycle with local caching and state persistence
type Manager struct {
	sessions     map[string]*Session // sessionID -> Session
	userSessions map[string]string   // userID:roomID -> sessionID
	tokens       map[string]string   // token -> sessionID
	mu           sync.RWMutex

	stateManager *state.Manager
	logger       *zap.Logger
}

// NewManager creates a new session manager
func NewManager(stateManager *state.Manager, logger *zap.Logger) *Manager {
	return &Manager{
		sessions:     make(map[string]*Session),
		userSessions: make(map[string]string),
		tokens:       make(map[string]string),
		stateManager: stateManager,
		logger:       logger,
	}
}

// userRoomKey generates a composite key for userSessions map
func userRoomKey(userID, roomID string) string {
	return fmt.Sprintf("%s:%s", userID, roomID)
}

// CreateSession creates a new session or reactivates a suspended one
func (m *Manager) CreateSession(userID, roomID, name string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := userRoomKey(userID, roomID)

	// Check for existing session
	if sessionID, exists := m.userSessions[key]; exists {
		if session, ok := m.sessions[sessionID]; ok {
			if session.Suspended {
				// Reactivate suspended session
				session.Suspended = false
				session.LastSeen = time.Now()
				session.Name = name // Update name in case it changed

				// Persist reactivated session
				if err := m.stateManager.SetSession(session.ToStateData()); err != nil {
					m.logger.Error("Failed to persist reactivated session",
						zap.String("session_id", session.ID),
						zap.Error(err),
					)
				}

				m.logger.Info("Session reactivated",
					zap.String("session_id", session.ID),
					zap.String("user_id", userID),
					zap.String("room_id", roomID),
				)

				return session, nil
			}

			// Active session already exists
			m.logger.Info("Returning existing active session",
				zap.String("session_id", session.ID),
				zap.String("user_id", userID),
				zap.String("room_id", roomID),
			)

			return session, nil
		}
	}

	// Create new session
	session := NewSession(userID, roomID, name)

	// Store in local maps
	m.sessions[session.ID] = session
	m.userSessions[key] = session.ID
	m.tokens[session.Token] = session.ID

	// Persist to state manager
	if err := m.stateManager.SetSession(session.ToStateData()); err != nil {
		m.logger.Error("Failed to persist new session",
			zap.String("session_id", session.ID),
			zap.Error(err),
		)
	}

	m.logger.Info("Session created",
		zap.String("session_id", session.ID),
		zap.String("user_id", userID),
		zap.String("room_id", roomID),
		zap.String("name", name),
	)

	return session, nil
}

// GetSession retrieves a session by ID, checking local cache first then state manager
func (m *Manager) GetSession(sessionID string) (*Session, error) {
	m.mu.RLock()
	if session, ok := m.sessions[sessionID]; ok {
		m.mu.RUnlock()
		return session, nil
	}
	m.mu.RUnlock()

	// Fallback to state manager
	data, err := m.stateManager.GetSession(sessionID)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, nil
	}

	// Reconstruct session from state data
	session := FromStateData(data)

	// Cache locally (need write lock)
	m.mu.Lock()
	m.sessions[session.ID] = session
	key := userRoomKey(session.UserID, session.RoomID)
	m.userSessions[key] = session.ID
	// Note: Token is not recovered from state, so we generate a new one
	if session.Token == "" {
		session.Token = generateToken()
	}
	m.tokens[session.Token] = session.ID
	m.mu.Unlock()

	return session, nil
}

// ResumeSession verifies token and reactivates a suspended session
func (m *Manager) ResumeSession(sessionID, token string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Verify token
	storedSessionID, exists := m.tokens[token]
	if !exists || storedSessionID != sessionID {
		return nil, fmt.Errorf("invalid session token")
	}

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("session not found")
	}

	if !session.Suspended {
		return session, nil // Already active
	}

	// Reactivate session
	session.Suspended = false
	session.LastSeen = time.Now()

	// Generate new token for security
	delete(m.tokens, session.Token)
	session.Token = generateToken()
	m.tokens[session.Token] = session.ID

	// Persist changes
	if err := m.stateManager.SetSession(session.ToStateData()); err != nil {
		m.logger.Error("Failed to persist resumed session",
			zap.String("session_id", session.ID),
			zap.Error(err),
		)
	}

	m.logger.Info("Session resumed",
		zap.String("session_id", session.ID),
		zap.String("user_id", session.UserID),
		zap.String("room_id", session.RoomID),
	)

	return session, nil
}

// SuspendSession marks a session as suspended for potential reconnection
func (m *Manager) SuspendSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		// Try to get from state manager
		data, err := m.stateManager.GetSession(sessionID)
		if err != nil {
			return err
		}
		if data == nil {
			return fmt.Errorf("session not found: %s", sessionID)
		}
		session = FromStateData(data)
		m.sessions[session.ID] = session
	}

	session.Suspended = true
	session.LastSeen = time.Now()

	// Persist suspended state with TTL
	if err := m.stateManager.SuspendSession(sessionID); err != nil {
		m.logger.Error("Failed to persist suspended session",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		return err
	}

	m.logger.Info("Session suspended",
		zap.String("session_id", sessionID),
		zap.String("user_id", session.UserID),
		zap.String("room_id", session.RoomID),
	)

	return nil
}

// DeleteSession permanently removes a session
func (m *Manager) DeleteSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if ok {
		// Clean up local maps
		key := userRoomKey(session.UserID, session.RoomID)
		delete(m.userSessions, key)
		delete(m.tokens, session.Token)
		delete(m.sessions, sessionID)
	}

	// Remove from state manager
	if err := m.stateManager.DeleteSession(sessionID); err != nil {
		m.logger.Error("Failed to delete session from state",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		return err
	}

	m.logger.Info("Session deleted",
		zap.String("session_id", sessionID),
	)

	return nil
}

// UpdatePeerID updates the peer ID after a reconnect
func (m *Manager) UpdatePeerID(sessionID, peerID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	session.PeerID = peerID
	session.LastSeen = time.Now()

	// Persist update
	if err := m.stateManager.SetSession(session.ToStateData()); err != nil {
		m.logger.Error("Failed to persist peer ID update",
			zap.String("session_id", sessionID),
			zap.String("peer_id", peerID),
			zap.Error(err),
		)
		return err
	}

	m.logger.Debug("Peer ID updated",
		zap.String("session_id", sessionID),
		zap.String("peer_id", peerID),
	)

	return nil
}

// GetRoomSessions returns all active sessions in a room
func (m *Manager) GetRoomSessions(roomID string) ([]*Session, error) {
	// Get from state manager (source of truth for room membership)
	stateData, err := m.stateManager.GetRoomSessions(roomID)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	var sessions []*Session
	for _, data := range stateData {
		// Check local cache first
		if session, ok := m.sessions[data.ID]; ok {
			if !session.Suspended {
				sessions = append(sessions, session)
			}
			continue
		}

		// Use state data
		if !data.Suspended {
			session := FromStateData(data)
			m.sessions[session.ID] = session
			sessions = append(sessions, session)
		}
	}

	return sessions, nil
}

// CleanupExpiredSessions removes sessions that have been suspended past the TTL
func (m *Manager) CleanupExpiredSessions(ttl time.Duration) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	var cleaned int

	for sessionID, session := range m.sessions {
		if session.Suspended && now.Sub(session.LastSeen) > ttl {
			// Clean up local maps
			key := userRoomKey(session.UserID, session.RoomID)
			delete(m.userSessions, key)
			delete(m.tokens, session.Token)
			delete(m.sessions, sessionID)

			// State manager will handle Redis cleanup via TTL
			m.logger.Info("Expired session cleaned up",
				zap.String("session_id", sessionID),
				zap.String("user_id", session.UserID),
				zap.String("room_id", session.RoomID),
				zap.Duration("age", now.Sub(session.LastSeen)),
			)

			cleaned++
		}
	}

	if cleaned > 0 {
		m.logger.Info("Session cleanup completed",
			zap.Int("cleaned_count", cleaned),
			zap.Duration("ttl", ttl),
		)
	}

	return cleaned
}

// UpdateMediaState updates the media state of a session
func (m *Manager) UpdateMediaState(sessionID string, mediaState state.MediaState) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	session.MediaState = mediaState
	session.LastSeen = time.Now()

	// Persist update
	if err := m.stateManager.SetSession(session.ToStateData()); err != nil {
		m.logger.Error("Failed to persist media state update",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		return err
	}

	return nil
}

// UpdateSubscriptions updates the subscriptions of a session
func (m *Manager) UpdateSubscriptions(sessionID string, subscriptions map[string]bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	session.Subscriptions = subscriptions
	session.LastSeen = time.Now()

	// Persist update
	if err := m.stateManager.SetSession(session.ToStateData()); err != nil {
		m.logger.Error("Failed to persist subscriptions update",
			zap.String("session_id", sessionID),
			zap.Error(err),
		)
		return err
	}

	return nil
}

// GetSessionByToken retrieves a session by its resume token
func (m *Manager) GetSessionByToken(token string) (*Session, error) {
	m.mu.RLock()
	sessionID, exists := m.tokens[token]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("invalid token")
	}

	return m.GetSession(sessionID)
}

// RecoverSessions loads sessions from state manager on startup
func (m *Manager) RecoverSessions() error {
	sessions, err := m.stateManager.RecoverSessions()
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, data := range sessions {
		session := FromStateData(data)
		session.Token = generateToken() // Generate new token for recovered sessions

		m.sessions[session.ID] = session
		key := userRoomKey(session.UserID, session.RoomID)
		m.userSessions[key] = session.ID
		m.tokens[session.Token] = session.ID
	}

	m.logger.Info("Sessions recovered from state manager",
		zap.Int("count", len(sessions)),
	)

	return nil
}

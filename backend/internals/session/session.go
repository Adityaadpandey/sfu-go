package session

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/adityaadpandey/sfu-go/internals/state"
)

// Session represents a user's session in the SFU
type Session struct {
	ID     string
	Token  string // For secure resume
	UserID string
	RoomID string
	Name   string
	PeerID string // Current peer ID (changes on reconnect)

	MediaState    state.MediaState
	Subscriptions map[string]bool // trackID -> subscribed

	CreatedAt time.Time
	LastSeen  time.Time
	Suspended bool
}

// NewSession creates a new session for a user joining a room
func NewSession(userID, roomID, name string) *Session {
	return &Session{
		ID:     generateID(),
		Token:  generateToken(),
		UserID: userID,
		RoomID: roomID,
		Name:   name,
		MediaState: state.MediaState{
			MicEnabled:    true,
			CameraEnabled: true,
			ScreenEnabled: false,
		},
		Subscriptions: make(map[string]bool),
		CreatedAt:     time.Now(),
		LastSeen:      time.Now(),
		Suspended:     false,
	}
}

// ToStateData converts Session to state.SessionData for persistence
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

// FromStateData creates a Session from state.SessionData
// Note: Token is not persisted in state, so it will be empty
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

// generateID creates a random 32-character hex session ID
func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// generateToken creates a random 64-character hex token for secure resume
func generateToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

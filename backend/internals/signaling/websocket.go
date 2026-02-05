package signaling

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type MessageType string

const (
	MessageTypeJoin         MessageType = "join"
	MessageTypeLeave        MessageType = "leave"
	MessageTypeOffer        MessageType = "offer"
	MessageTypeAnswer       MessageType = "answer"
	MessageTypeICECandidate MessageType = "ice-candidate"
	MessageTypeTrackAdded   MessageType = "track-added"
	MessageTypeTrackRemoved MessageType = "track-removed"
	MessageTypePeerJoined   MessageType = "peer-joined"
	MessageTypePeerLeft     MessageType = "peer-left"
	MessageTypeRoomState    MessageType = "room-state"
	MessageTypeRenegotiate  MessageType = "renegotiate"
	MessageTypeError            MessageType = "error"
	MessageTypePing             MessageType = "ping"
	MessageTypePong             MessageType = "pong"
	MessageTypeLayerSwitch      MessageType = "layer-switch"
	MessageTypeLayerAvailable   MessageType = "layer-available"
	MessageTypeDominantSpeaker  MessageType = "dominant-speaker"
	MessageTypeQualityStats     MessageType = "quality-stats"
	MessageTypeICERestartRequest MessageType = "ice-restart-request"
	MessageTypeICERestartOffer   MessageType = "ice-restart-offer"
	MessageTypeTrackPublished   MessageType = "track-published"
	MessageTypeSubscribe        MessageType = "subscribe"
	MessageTypeUnsubscribe      MessageType = "unsubscribe"
	MessageTypeSubscriptionAck  MessageType = "subscription-ack"
)

type Message struct {
	Type      MessageType     `json:"type"`
	Data      json.RawMessage `json:"data,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
	From      string          `json:"from,omitempty"`
	To        string          `json:"to,omitempty"`
}

type JoinMessage struct {
	RoomID   string                 `json:"roomId"`
	UserID   string                 `json:"userId"`
	Name     string                 `json:"name"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

type OfferMessage struct {
	SDP    string `json:"sdp"`
	Type   string `json:"type"`
	PeerID string `json:"peerId"`
}

type AnswerMessage struct {
	SDP    string `json:"sdp"`
	Type   string `json:"type"`
	PeerID string `json:"peerId"`
}

type ICECandidateMessage struct {
	Candidate     string `json:"candidate"`
	SDPMid        string `json:"sdpMid"`
	SDPMLineIndex int    `json:"sdpMLineIndex"`
	PeerID        string `json:"peerId"`
}

type ErrorMessage struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Client struct {
	ID     string          `json:"id"`
	UserID string          `json:"userId"`
	RoomID string          `json:"roomId"`
	Name   string          `json:"name"`
	Conn   *websocket.Conn `json:"-"`
	Send   chan Message     `json:"-"`

	// State
	Connected bool      `json:"connected"`
	LastPing  time.Time `json:"lastPing"`

	// Synchronization
	mu        sync.RWMutex
	closeOnce sync.Once
	closed    atomic.Bool
	logger    *zap.Logger

	// Callbacks
	OnMessage    func(*Client, Message)
	OnDisconnect func(*Client)
}

type Hub struct {
	clients    map[string]*Client
	register   chan *Client
	unregister chan *Client
	broadcast  chan Message
	mu         sync.RWMutex
	logger     *zap.Logger
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func NewHub(logger *zap.Logger) *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Message),
		logger:     logger,
	}
}

func (h *Hub) Run() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()

			h.logger.Info("Client registered",
				zap.String("clientID", client.ID),
				zap.String("userID", client.UserID),
			)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				client.closeSend()
			}
			h.mu.Unlock()

			h.logger.Info("Client unregistered",
				zap.String("clientID", client.ID),
				zap.String("userID", client.UserID),
			)

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				if message.To == "" || message.To == client.ID {
					select {
					case client.Send <- message:
					default:
						// Channel full — mark for unregister but don't close here
						// to avoid double-close with unregister path
						go func(c *Client) {
							h.unregister <- c
						}(client)
					}
				}
			}
			h.mu.RUnlock()

		case <-ticker.C:
			h.pingClients()
		}
	}
}

func (h *Hub) pingClients() {
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for _, client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()

	pingMessage := Message{
		Type:      MessageTypePing,
		Timestamp: time.Now(),
	}

	for _, client := range clients {
		select {
		case client.Send <- pingMessage:
			client.mu.Lock()
			client.LastPing = time.Now()
			client.mu.Unlock()
		default:
			h.unregister <- client
		}
	}
}

func (h *Hub) RegisterClient(client *Client) {
	h.register <- client
}

func (h *Hub) UnregisterClient(client *Client) {
	h.unregister <- client
}

func (h *Hub) BroadcastMessage(message Message) {
	h.broadcast <- message
}

func (h *Hub) SendToClient(clientID string, message Message) {
	message.To = clientID
	h.broadcast <- message
}

func (h *Hub) GetClient(clientID string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	client, exists := h.clients[clientID]
	return client, exists
}

func (h *Hub) GetClientsByRoom(roomID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := make([]*Client, 0)
	for _, client := range h.clients {
		if client.RoomID == roomID {
			clients = append(clients, client)
		}
	}
	return clients
}

// DisconnectClientsByUserID closes and unregisters all existing clients for a
// given userID, except the one with excludeClientID. This handles the page-refresh
// scenario where a new WS connection arrives before the old one is cleaned up.
func (h *Hub) DisconnectClientsByUserID(userID, excludeClientID string) {
	h.mu.RLock()
	var stale []*Client
	for _, c := range h.clients {
		if c.UserID == userID && c.ID != excludeClientID {
			stale = append(stale, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range stale {
		c.Conn.Close()
		h.unregister <- c
	}
}

func NewClient(id, userID, name string, conn *websocket.Conn, logger *zap.Logger) *Client {
	return &Client{
		ID:        id,
		UserID:    userID,
		Name:      name,
		Conn:      conn,
		Send:      make(chan Message, 256),
		Connected: true,
		LastPing:  time.Now(),
		logger:    logger,
	}
}

func (c *Client) closeSend() {
	c.closeOnce.Do(func() {
		c.closed.Store(true)
		close(c.Send)
	})
}

func (c *Client) ReadPump() {
	defer func() {
		if c.OnDisconnect != nil {
			c.OnDisconnect(c)
		}
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(524288) // 512KB — SDP with multiple transceivers can be large
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		var message Message
		err := c.Conn.ReadJSON(&message)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Error("WebSocket error",
					zap.String("clientID", c.ID),
					zap.Error(err),
				)
			}
			break
		}

		message.From = c.ID
		message.Timestamp = time.Now()

		if c.OnMessage != nil {
			c.OnMessage(c, message)
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteJSON(message); err != nil {
				c.logger.Error("Failed to write message",
					zap.String("clientID", c.ID),
					zap.Error(err),
				)
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) SendMessage(message Message) {
	if c.closed.Load() {
		return
	}
	select {
	case c.Send <- message:
	default:
		c.logger.Warn("Client send channel full, dropping message",
			zap.String("clientID", c.ID),
		)
	}
}

func (c *Client) SendError(code int, msg string) {
	errorMsg := ErrorMessage{
		Code:    code,
		Message: msg,
	}

	data, err := json.Marshal(errorMsg)
	if err != nil {
		c.logger.Error("Failed to marshal error message", zap.Error(err))
		return
	}

	message := Message{
		Type:      MessageTypeError,
		Data:      data,
		Timestamp: time.Now(),
	}

	c.SendMessage(message)
}

func HandleWebSocket(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Failed to upgrade connection", http.StatusBadRequest)
		return
	}

	userID := r.URL.Query().Get("userId")
	name := r.URL.Query().Get("name")

	if userID == "" {
		conn.WriteMessage(websocket.CloseMessage, []byte("Missing userId"))
		conn.Close()
		return
	}

	client := NewClient(
		generateClientID(),
		userID,
		name,
		conn,
		hub.logger,
	)

	hub.RegisterClient(client)

	go client.WritePump()
	go client.ReadPump()
}

func generateClientID() string {
	return fmt.Sprintf("client_%d", time.Now().UnixNano())
}

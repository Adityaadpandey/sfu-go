package signaling

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Channel prefixes for Redis pub/sub
const (
	RoomChannelPrefix = "sfu:room:"
)

// PubSubMessage wraps a signaling message with origin info
type PubSubMessage struct {
	InstanceID string  `json:"instance_id"`
	Message    Message `json:"message"`
}

// PubSubManager handles Redis pub/sub for cross-instance signaling
type PubSubManager struct {
	redis      *redis.Client
	hub        *Hub
	instanceID string
	logger     *zap.Logger

	mu   sync.RWMutex
	subs map[string]*redis.PubSub // roomID -> subscription

	ctx    context.Context
	cancel context.CancelFunc
}

// NewPubSubManager creates a new pub/sub manager for cross-instance communication
func NewPubSubManager(redisClient *redis.Client, hub *Hub, logger *zap.Logger) *PubSubManager {
	ctx, cancel := context.WithCancel(context.Background())

	// Generate instance ID from hostname or env
	instanceID := os.Getenv("INSTANCE_ID")
	if instanceID == "" {
		hostname, err := os.Hostname()
		if err != nil {
			instanceID = "unknown"
		} else {
			instanceID = hostname
		}
	}

	pm := &PubSubManager{
		redis:      redisClient,
		hub:        hub,
		instanceID: instanceID,
		logger:     logger,
		subs:       make(map[string]*redis.PubSub),
		ctx:        ctx,
		cancel:     cancel,
	}

	logger.Info("PubSub manager initialized",
		zap.String("instance_id", instanceID),
	)

	return pm
}

// RoomChannel returns the Redis channel name for a room
func RoomChannel(roomID string) string {
	return RoomChannelPrefix + roomID
}

// PublishToRoom publishes a signaling message to the room's Redis channel
// This allows other SFU instances to receive the message
func (p *PubSubManager) PublishToRoom(roomID string, msg Message) error {
	pubMsg := PubSubMessage{
		InstanceID: p.instanceID,
		Message:    msg,
	}

	data, err := json.Marshal(pubMsg)
	if err != nil {
		p.logger.Error("Failed to marshal pub/sub message",
			zap.String("room_id", roomID),
			zap.Error(err),
		)
		return err
	}

	channel := RoomChannel(roomID)
	if err := p.redis.Publish(p.ctx, channel, data).Err(); err != nil {
		p.logger.Error("Failed to publish to Redis",
			zap.String("room_id", roomID),
			zap.String("channel", channel),
			zap.Error(err),
		)
		return err
	}

	return nil
}

// SubscribeToRoom starts listening to a room's Redis channel
// Messages from other instances will be delivered to local hub clients
func (p *PubSubManager) SubscribeToRoom(roomID string) {
	p.mu.Lock()
	if _, exists := p.subs[roomID]; exists {
		p.mu.Unlock()
		return // Already subscribed
	}

	channel := RoomChannel(roomID)
	sub := p.redis.Subscribe(p.ctx, channel)
	p.subs[roomID] = sub
	p.mu.Unlock()

	p.logger.Info("Subscribed to room channel",
		zap.String("room_id", roomID),
		zap.String("channel", channel),
	)

	// Start listening in a goroutine
	go p.listenToChannel(roomID, sub)
}

// UnsubscribeFromRoom stops listening to a room's Redis channel
func (p *PubSubManager) UnsubscribeFromRoom(roomID string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	sub, exists := p.subs[roomID]
	if !exists {
		return
	}

	if err := sub.Close(); err != nil {
		p.logger.Warn("Error closing subscription",
			zap.String("room_id", roomID),
			zap.Error(err),
		)
	}

	delete(p.subs, roomID)

	p.logger.Info("Unsubscribed from room channel",
		zap.String("room_id", roomID),
	)
}

// listenToChannel processes messages from a room's Redis channel
func (p *PubSubManager) listenToChannel(roomID string, sub *redis.PubSub) {
	ch := sub.Channel()

	for {
		select {
		case <-p.ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			p.handlePubSubMessage(roomID, msg)
		}
	}
}

// handlePubSubMessage processes an incoming message from Redis pub/sub
func (p *PubSubManager) handlePubSubMessage(roomID string, redisMsg *redis.Message) {
	var pubMsg PubSubMessage
	if err := json.Unmarshal([]byte(redisMsg.Payload), &pubMsg); err != nil {
		p.logger.Warn("Failed to unmarshal pub/sub message",
			zap.String("room_id", roomID),
			zap.Error(err),
		)
		return
	}

	// Ignore messages from this instance (we already handled them locally)
	if pubMsg.InstanceID == p.instanceID {
		return
	}

	p.logger.Debug("Received cross-instance message",
		zap.String("room_id", roomID),
		zap.String("from_instance", pubMsg.InstanceID),
		zap.String("type", string(pubMsg.Message.Type)),
	)

	// Deliver to local clients in this room
	p.deliverToLocalClients(roomID, pubMsg.Message)
}

// deliverToLocalClients sends a message to all local clients in a room
func (p *PubSubManager) deliverToLocalClients(roomID string, msg Message) {
	clients := p.hub.GetClientsByRoom(roomID)

	for _, client := range clients {
		// If the message has a specific recipient, only send to them
		if msg.To != "" && client.ID != msg.To {
			continue
		}

		client.SendMessage(msg)
	}
}

// GetInstanceID returns this instance's unique identifier
func (p *PubSubManager) GetInstanceID() string {
	return p.instanceID
}

// Close shuts down all subscriptions and cleans up
func (p *PubSubManager) Close() error {
	p.cancel()

	p.mu.Lock()
	defer p.mu.Unlock()

	for roomID, sub := range p.subs {
		if err := sub.Close(); err != nil {
			p.logger.Warn("Error closing subscription during shutdown",
				zap.String("room_id", roomID),
				zap.Error(err),
			)
		}
	}

	p.subs = make(map[string]*redis.PubSub)
	p.logger.Info("PubSub manager closed")

	return nil
}

// Ping checks if Redis pub/sub is healthy
func (p *PubSubManager) Ping() error {
	ctx, cancel := context.WithTimeout(p.ctx, 3*time.Second)
	defer cancel()
	return p.redis.Ping(ctx).Err()
}

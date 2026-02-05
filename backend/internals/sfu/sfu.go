package sfu

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/adityaadpandey/sfu-go/internals/config"
	appmetrics "github.com/adityaadpandey/sfu-go/internals/metrics"
	"github.com/adityaadpandey/sfu-go/internals/peer"
	"github.com/adityaadpandey/sfu-go/internals/room"
	"github.com/adityaadpandey/sfu-go/internals/session"
	"github.com/adityaadpandey/sfu-go/internals/signaling"
	"github.com/adityaadpandey/sfu-go/internals/state"
	"github.com/adityaadpandey/sfu-go/internals/subscription"
	"github.com/adityaadpandey/sfu-go/internals/utils"
	"github.com/gorilla/websocket"
	"github.com/pion/interceptor"
	"github.com/pion/webrtc/v3"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
	"golang.org/x/time/rate"
)

var safeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_\-\.]+$`)

type SFU struct {
	config *config.Config
	logger *zap.Logger

	webrtcConfig webrtc.Configuration
	webrtcAPI    *webrtc.API

	rooms   map[string]*room.Room
	roomsMu sync.RWMutex

	signalingHub *signaling.Hub
	pubsubManager *signaling.PubSubManager // Redis pub/sub for horizontal scaling
	httpServer   *http.Server

	metrics *Metrics

	stateManager    *state.Manager
	sessionManager  *session.Manager
	subscriptionMgr *subscription.Manager

	rateLimiters   map[string]*rate.Limiter
	rateLimitersMu sync.Mutex

	ctx    context.Context
	cancel context.CancelFunc
}

type Metrics struct {
	ActiveRooms      prometheus.Gauge
	ActivePeers      prometheus.Gauge
	TotalConnections prometheus.Counter
	MessagesSent     prometheus.Counter
	MessagesReceived prometheus.Counter
}

func unmarshalMessageData[T any](data json.RawMessage, out *T) error {
	if err := json.Unmarshal(data, out); err != nil {
		var dataStr string
		if err2 := json.Unmarshal(data, &dataStr); err2 != nil {
			return fmt.Errorf("not valid JSON: %w", err)
		}
		if err3 := json.Unmarshal([]byte(dataStr), out); err3 != nil {
			return fmt.Errorf("invalid inner JSON: %w", err3)
		}
	}
	return nil
}

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
		if len(recovered) > 0 {
			logger.Info("Recovered sessions from Redis", zap.Int("count", len(recovered)))
		}
	}

	sfu := &SFU{
		config:          cfg,
		logger:          logger,
		rooms:           make(map[string]*room.Room),
		signalingHub:    signaling.NewHub(logger),
		stateManager:    stateManager,
		sessionManager:  sessionManager,
		subscriptionMgr: subscription.NewManager(cfg.Media.AutoSubscribe),
		rateLimiters:    make(map[string]*rate.Limiter),
		ctx:             ctx,
		cancel:          cancel,
	}

	// Initialize pub/sub manager for horizontal scaling
	if stateManager != nil {
		sfu.pubsubManager = signaling.NewPubSubManager(
			stateManager.GetRedisClient(),
			sfu.signalingHub,
			logger,
		)
	}

	sfu.setupWebRTCConfig()
	sfu.setupMetrics()

	// Start session cleanup loop
	if sessionManager != nil {
		go sfu.sessionCleanupLoop()
	}

	return sfu, nil
}

func (s *SFU) setupWebRTCConfig() {
	mediaEngine := &webrtc.MediaEngine{}
	if err := mediaEngine.RegisterDefaultCodecs(); err != nil {
		s.logger.Error("Failed to register default codecs", zap.Error(err))
	}

	// Only register simulcast header extensions if simulcast is enabled.
	// Without these, Pion won't attempt simulcast SSRC probing, avoiding
	// "Incoming unhandled RTP ssrc" errors.
	if s.config.Media.SimulcastEnabled {
		for _, ext := range []string{
			"urn:ietf:params:rtp-hdrext:sdes:mid",
			"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
		} {
			if err := mediaEngine.RegisterHeaderExtension(webrtc.RTPHeaderExtensionCapability{URI: ext}, webrtc.RTPCodecTypeVideo); err != nil {
				s.logger.Error("Failed to register header extension", zap.String("uri", ext), zap.Error(err))
			}
		}
	}

	i := &interceptor.Registry{}
	if err := webrtc.RegisterDefaultInterceptors(mediaEngine, i); err != nil {
		s.logger.Error("Failed to register default interceptors", zap.Error(err))
	}

	settingEngine := webrtc.SettingEngine{}
	if s.config.WebRTC.UDPPortRange.Min > 0 && s.config.WebRTC.UDPPortRange.Max > 0 {
		if err := settingEngine.SetEphemeralUDPPortRange(s.config.WebRTC.UDPPortRange.Min, s.config.WebRTC.UDPPortRange.Max); err != nil {
			s.logger.Error("Failed to set UDP port range", zap.Error(err))
		}
	}
	if s.config.WebRTC.PublicIP != "" {
		settingEngine.SetNAT1To1IPs([]string{s.config.WebRTC.PublicIP}, webrtc.ICECandidateTypeHost)
	}

	s.webrtcAPI = webrtc.NewAPI(
		webrtc.WithMediaEngine(mediaEngine),
		webrtc.WithInterceptorRegistry(i),
		webrtc.WithSettingEngine(settingEngine),
	)

	s.webrtcConfig = webrtc.Configuration{
		ICEServers: make([]webrtc.ICEServer, len(s.config.WebRTC.ICEServers)),
	}
	for idx, iceServer := range s.config.WebRTC.ICEServers {
		s.webrtcConfig.ICEServers[idx] = webrtc.ICEServer{
			URLs:       iceServer.URLs,
			Username:   iceServer.Username,
			Credential: iceServer.Credential,
		}
	}
}

func (s *SFU) setupMetrics() {
	s.metrics = &Metrics{
		ActiveRooms: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "sfu_active_rooms_total",
			Help: "Number of active rooms",
		}),
		ActivePeers: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "sfu_active_peers_total",
			Help: "Number of active peers",
		}),
		TotalConnections: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sfu_connections_total",
			Help: "Total number of connections",
		}),
		MessagesSent: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sfu_messages_sent_total",
			Help: "Total number of messages sent",
		}),
		MessagesReceived: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "sfu_messages_received_total",
			Help: "Total number of messages received",
		}),
	}

	prometheus.MustRegister(
		s.metrics.ActiveRooms,
		s.metrics.ActivePeers,
		s.metrics.TotalConnections,
		s.metrics.MessagesSent,
		s.metrics.MessagesReceived,
	)
}

func (s *SFU) Start() error {
	s.logger.Info("Starting SFU server",
		zap.String("host", s.config.Server.Host),
		zap.Int("port", s.config.Server.Port),
	)

	go s.signalingHub.Run()
	go s.roomCleanupLoop()

	mux := http.NewServeMux()

	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/api/rooms", s.corsMiddleware(s.handleRoomsAPI))
	mux.HandleFunc("/api/rooms/", s.corsMiddleware(s.handleRoomAPI))
	mux.HandleFunc("/health", s.handleHealth)

	if s.config.Metrics.Enabled {
		mux.Handle(s.config.Metrics.Path, promhttp.Handler())
	}

	s.httpServer = &http.Server{
		Addr:         fmt.Sprintf("%s:%d", s.config.Server.Host, s.config.Server.Port),
		Handler:      mux,
		ReadTimeout:  s.config.Server.ReadTimeout,
		WriteTimeout: s.config.Server.WriteTimeout,
	}

	go func() {
		<-s.ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), s.config.Server.ShutdownTimeout)
		defer shutdownCancel()
		s.httpServer.Shutdown(shutdownCtx)
	}()

	s.logger.Info("SFU server started successfully")
	return s.httpServer.ListenAndServe()
}

func (s *SFU) Stop() {
	s.logger.Info("Stopping SFU server")
	s.roomsMu.Lock()
	for _, rm := range s.rooms {
		rm.Close()
	}
	s.rooms = make(map[string]*room.Room)
	s.roomsMu.Unlock()
	s.cancel()
}

func (s *SFU) corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

// roomCleanupLoop periodically removes empty inactive rooms.
func (s *SFU) roomCleanupLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.cleanupEmptyRooms()
		}
	}
}

func (s *SFU) cleanupEmptyRooms() {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()

	for id, rm := range s.rooms {
		if rm.IsEmpty() {
			rm.Close()
			delete(s.rooms, id)
			s.logger.Debug("Cleaned up empty room", zap.String("roomID", id))
		}
	}
}

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

func (s *SFU) getClientRateLimiter(clientID string) *rate.Limiter {
	s.rateLimitersMu.Lock()
	defer s.rateLimitersMu.Unlock()
	if limiter, ok := s.rateLimiters[clientID]; ok {
		return limiter
	}
	limiter := rate.NewLimiter(rate.Limit(s.config.Media.RateLimitPerSec), s.config.Media.RateLimitBurst)
	s.rateLimiters[clientID] = limiter
	return limiter
}

func (s *SFU) removeClientRateLimiter(clientID string) {
	s.rateLimitersMu.Lock()
	delete(s.rateLimiters, clientID)
	s.rateLimitersMu.Unlock()
}

// --- Signaling message handling ---

func (s *SFU) handleSignalingMessage(client *signaling.Client, message signaling.Message) {
	s.metrics.MessagesReceived.Inc()

	limiter := s.getClientRateLimiter(client.ID)
	if !limiter.Allow() {
		client.SendError(429, "Rate limit exceeded")
		return
	}

	switch message.Type {
	case signaling.MessageTypeJoin:
		s.handleJoinMessage(client, message)
	case signaling.MessageTypeLeave:
		s.handleLeaveMessage(client)
	case signaling.MessageTypeOffer:
		s.handleOfferMessage(client, message)
	case signaling.MessageTypeAnswer:
		s.handleAnswerMessage(client, message)
	case signaling.MessageTypeICECandidate:
		s.handleICECandidateMessage(client, message)
	case signaling.MessageTypeLayerSwitch:
		s.handleLayerSwitchMessage(client, message)
	case signaling.MessageTypeICERestartRequest:
		s.handleICERestartRequest(client)
	case signaling.MessageTypeIsAllowRenegotiation:
		s.handleIsAllowRenegotiationMessage(client)
	case signaling.MessageTypeSetBandwidthLimit:
		s.handleSetBandwidthLimitMessage(client, message)
	case signaling.MessageTypePong:
		// no-op
	default:
		s.logger.Debug("Unknown message type", zap.String("type", string(message.Type)))
	}
}

func (s *SFU) validateID(id string, maxLen int, fieldName string) error {
	if id == "" {
		return fmt.Errorf("%s is required", fieldName)
	}
	if len(id) > maxLen {
		return fmt.Errorf("%s exceeds maximum length of %d", fieldName, maxLen)
	}
	if !safeIDPattern.MatchString(id) {
		return fmt.Errorf("%s contains invalid characters", fieldName)
	}
	return nil
}

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

func (s *SFU) sendRoomState(client *signaling.Client, rm *room.Room, excludePeerID string) {
	allPeers := rm.GetAllPeers()
	peerList := make([]map[string]interface{}, 0, len(allPeers))
	for _, p := range allPeers {
		if p.ID == excludePeerID {
			continue
		}
		peerList = append(peerList, map[string]interface{}{
			"peerId": p.ID,
			"userId": p.UserID,
			"name":   p.Name,
		})
	}

	data, err := json.Marshal(map[string]interface{}{"peers": peerList})
	if err != nil {
		return
	}
	client.SendMessage(signaling.Message{
		Type: signaling.MessageTypeRoomState, Data: data, Timestamp: time.Now(),
	})
}

func (s *SFU) handleLeaveMessage(client *signaling.Client) {
	if client.RoomID == "" {
		return
	}

	s.roomsMu.RLock()
	rm, exists := s.rooms[client.RoomID]
	s.roomsMu.RUnlock()

	if exists {
		if p, ok := rm.GetPeerByUserID(client.UserID); ok {
			rm.RemovePeer(p.ID)
		}
	}

	client.RoomID = ""
	s.updateMetrics()
}

func (s *SFU) handleOfferMessage(client *signaling.Client, message signaling.Message) {
	var offerMsg signaling.OfferMessage
	if err := unmarshalMessageData(message.Data, &offerMsg); err != nil {
		client.SendError(400, "Invalid offer message format")
		return
	}

	s.logger.Info("Offer received",
		zap.String("clientID", client.ID),
		zap.String("roomID", client.RoomID),
		zap.String("userID", client.UserID),
	)

	rm, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if rm == nil || p == nil {
		s.logger.Error("Room or peer not found for offer",
			zap.String("roomID", client.RoomID),
			zap.String("userID", client.UserID),
		)
		client.SendError(404, "Room or peer not found")
		return
	}

	isRenegotiation := p.Connection.RemoteDescription() != nil
	s.logger.Info("Processing offer",
		zap.String("peerID", p.ID),
		zap.Bool("isRenegotiation", isRenegotiation),
	)

	offer := webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offerMsg.SDP}
	if err := p.SetRemoteDescription(offer); err != nil {
		s.logger.Error("Failed to set remote description", zap.Error(err))
		client.SendError(500, "Failed to set remote description")
		return
	}

	// For initial connection, add existing tracks BEFORE creating the answer
	// so they're included in the SDP. No renegotiation round-trip needed.
	if !isRenegotiation {
		rm.AddExistingTracksToPeer(p)
	}

	answer, err := p.Connection.CreateAnswer(nil)
	if err != nil {
		s.logger.Error("Failed to create answer", zap.Error(err))
		client.SendError(500, "Failed to create answer")
		return
	}

	if err := p.Connection.SetLocalDescription(answer); err != nil {
		s.logger.Error("Failed to set local description", zap.Error(err))
		client.SendError(500, "Failed to set local description")
		return
	}

	answerData, err := json.Marshal(signaling.AnswerMessage{
		SDP: answer.SDP, Type: answer.Type.String(), PeerID: p.ID,
	})
	if err != nil {
		client.SendError(500, "Internal server error")
		return
	}
	client.SendMessage(signaling.Message{
		Type: signaling.MessageTypeAnswer, Data: answerData, Timestamp: time.Now(),
	})
	s.logger.Info("Answer sent",
		zap.String("peerID", p.ID),
		zap.String("clientID", client.ID),
	)
}

func (s *SFU) handleAnswerMessage(client *signaling.Client, message signaling.Message) {
	var answerMsg signaling.AnswerMessage
	if err := unmarshalMessageData(message.Data, &answerMsg); err != nil {
		client.SendError(400, "Invalid answer message format")
		return
	}

	_, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if p == nil {
		client.SendError(404, "Room or peer not found")
		return
	}

	answer := webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answerMsg.SDP}
	if err := p.SetRemoteDescription(answer); err != nil {
		s.logger.Error("Failed to set remote description for answer", zap.Error(err))
		client.SendError(500, "Failed to set remote description")
	}
}

func (s *SFU) handleICECandidateMessage(client *signaling.Client, message signaling.Message) {
	var iceMsg signaling.ICECandidateMessage
	if err := unmarshalMessageData(message.Data, &iceMsg); err != nil {
		client.SendError(400, "Invalid ICE candidate message format")
		return
	}

	_, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if p == nil {
		client.SendError(404, "Room or peer not found")
		return
	}

	candidate := webrtc.ICECandidateInit{
		Candidate:     iceMsg.Candidate,
		SDPMid:        &iceMsg.SDPMid,
		SDPMLineIndex: func() *uint16 { v := uint16(iceMsg.SDPMLineIndex); return &v }(),
	}

	if err := p.AddICECandidate(candidate); err != nil {
		s.logger.Debug("Failed to add ICE candidate", zap.Error(err))
	}
}

func (s *SFU) handleClientDisconnect(client *signaling.Client) {
	if client.RoomID == "" {
		s.removeClientRateLimiter(client.ID)
		return
	}

	// Suspend session instead of deleting
	if s.sessionManager != nil {
		sessions, err := s.sessionManager.GetRoomSessions(client.RoomID)
		if err == nil {
			for _, sess := range sessions {
				if sess.UserID == client.UserID {
					s.sessionManager.SuspendSession(sess.ID)
					appmetrics.ActiveSessions.Dec()
					appmetrics.SuspendedSessions.Inc()
					break
				}
			}
		}
	}

	s.handleLeaveMessage(client)
	s.removeClientRateLimiter(client.ID)
}

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

func (s *SFU) handleLayerSwitchMessage(client *signaling.Client, message signaling.Message) {
	var msg struct {
		TrackID   string `json:"trackId"`
		TargetRID string `json:"targetRid"`
	}
	if err := unmarshalMessageData(message.Data, &msg); err != nil {
		client.SendError(400, "Invalid layer-switch message")
		return
	}

	rm, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if rm == nil || p == nil {
		client.SendError(404, "Room or peer not found")
		return
	}

	if err := rm.SwitchLayer(msg.TrackID, p.ID, msg.TargetRID); err != nil {
		client.SendError(400, err.Error())
	}
}

// handleIsAllowRenegotiationMessage checks if client-initiated renegotiation is allowed
// This prevents "glare" where both sides try to renegotiate simultaneously
func (s *SFU) handleIsAllowRenegotiationMessage(client *signaling.Client) {
	_, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if p == nil {
		client.SendError(404, "Peer not found")
		return
	}

	allowed := p.IsAllowNegotiation()

	data, err := json.Marshal(map[string]interface{}{
		"allowed": allowed,
	})
	if err != nil {
		client.SendError(500, "Internal server error")
		return
	}

	client.SendMessage(signaling.Message{
		Type: signaling.MessageTypeAllowRenegotiation, Data: data, Timestamp: time.Now(),
	})

	s.logger.Debug("IsAllowRenegotiation check",
		zap.String("peerID", p.ID),
		zap.Bool("allowed", allowed),
	)
}

// handleSetBandwidthLimitMessage sets the receiving bandwidth limit for a peer
func (s *SFU) handleSetBandwidthLimitMessage(client *signaling.Client, message signaling.Message) {
	var msg struct {
		Bandwidth uint32 `json:"bandwidth"` // bits per second
	}
	if err := unmarshalMessageData(message.Data, &msg); err != nil {
		client.SendError(400, "Invalid bandwidth limit message")
		return
	}

	_, p := s.getRoomAndPeer(client.RoomID, client.UserID)
	if p == nil {
		client.SendError(404, "Peer not found")
		return
	}

	p.SetBandwidthLimit(msg.Bandwidth)

	// Acknowledge the bandwidth limit
	data, err := json.Marshal(map[string]interface{}{
		"success":   true,
		"bandwidth": msg.Bandwidth,
	})
	if err != nil {
		return
	}

	client.SendMessage(signaling.Message{
		Type: signaling.MessageTypeSetBandwidthLimit, Data: data, Timestamp: time.Now(),
	})
}

func (s *SFU) handleDominantSpeakerChanged(roomID, oldPeerID, newPeerID string) {
	data, err := json.Marshal(map[string]interface{}{
		"oldPeerId": oldPeerID,
		"newPeerId": newPeerID,
	})
	if err != nil {
		return
	}

	msg := signaling.Message{
		Type: signaling.MessageTypeDominantSpeaker, Data: data, Timestamp: time.Now(),
	}

	roomClients := s.signalingHub.GetClientsByRoom(roomID)
	for _, client := range roomClients {
		client.SendMessage(msg)
	}
}

func (s *SFU) handleQualityStats(peerID string, quality *room.PeerQuality) {
	data, err := json.Marshal(map[string]interface{}{
		"peerId":     peerID,
		"level":      quality.Level,
		"packetLoss": quality.PacketLoss,
	})
	if err != nil {
		return
	}

	msg := signaling.Message{
		Type: signaling.MessageTypeQualityStats, Data: data, Timestamp: time.Now(),
	}

	// Send stats to the peer themselves
	s.roomsMu.RLock()
	for _, rm := range s.rooms {
		if p, ok := rm.GetPeer(peerID); ok {
			roomClients := s.signalingHub.GetClientsByRoom(p.RoomID)
			for _, client := range roomClients {
				client.SendMessage(msg)
			}
			break
		}
	}
	s.roomsMu.RUnlock()
}

// --- Room management ---

func (s *SFU) getOrCreateRoom(roomID string) *room.Room {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()

	if r, exists := s.rooms[roomID]; exists {
		return r
	}
	if len(s.rooms) >= s.config.Server.MaxRooms {
		return nil
	}

	r := room.NewRoom(roomID, s.config.Server.MaxPeersPerRoom, s.logger)
	if s.config.Media.RenegotiationDelay > 0 {
		r.SetRenegotiationDelay(s.config.Media.RenegotiationDelay)
	}
	if s.config.Media.MaxRTPErrors > 0 {
		r.SetMaxRTPErrors(s.config.Media.MaxRTPErrors)
	}

	r.OnRenegotiateNeeded = s.handleRenegotiationNeeded
	r.OnPeerLeft = s.handlePeerLeft
	r.OnDominantSpeakerChanged = s.handleDominantSpeakerChanged
	r.OnQualityStats = s.handleQualityStats

	r.SetSimulcastEnabled(s.config.Media.SimulcastEnabled)
	if s.config.Media.SpeakerDetectionInterval > 0 {
		r.SetSpeakerDetectionInterval(s.config.Media.SpeakerDetectionInterval)
	}
	if s.config.Media.StatsInterval > 0 {
		r.SetStatsInterval(s.config.Media.StatsInterval)
	}

	r.StartDominantSpeakerDetection()
	r.StartStatsCollection()

	s.rooms[roomID] = r
	return r
}

func (s *SFU) getRoomAndPeer(roomID, userID string) (*room.Room, *peer.Peer) {
	s.roomsMu.RLock()
	r, exists := s.rooms[roomID]
	s.roomsMu.RUnlock()

	if !exists {
		return nil, nil
	}

	p, ok := r.GetPeerByUserID(userID)
	if !ok {
		return r, nil
	}
	return r, p
}

func (s *SFU) updateMetrics() {
	s.roomsMu.RLock()
	activeRooms := len(s.rooms)
	activePeers := 0
	for _, rm := range s.rooms {
		activePeers += rm.GetPeerCount()
	}
	s.roomsMu.RUnlock()

	s.metrics.ActiveRooms.Set(float64(activeRooms))
	s.metrics.ActivePeers.Set(float64(activePeers))
}

// --- Peer event broadcasting ---

func (s *SFU) handlePeerLeft(rm *room.Room, leftPeer *peer.Peer) {
	s.broadcastPeerEvent(leftPeer.RoomID, leftPeer, signaling.MessageTypePeerLeft, "")
	s.updateMetrics()
}

func (s *SFU) broadcastPeerEvent(roomID string, p *peer.Peer, msgType signaling.MessageType, excludeClientID string) {
	roomClients := s.signalingHub.GetClientsByRoom(roomID)

	data, err := json.Marshal(map[string]interface{}{
		"peerId": p.ID,
		"userId": p.UserID,
		"name":   p.Name,
		"roomId": roomID,
	})
	if err != nil {
		s.logger.Error("Failed to marshal peer event", zap.Error(err))
		return
	}

	msg := signaling.Message{Type: msgType, Data: data, Timestamp: time.Now()}

	for _, client := range roomClients {
		if client.ID != excludeClientID && client.UserID != p.UserID {
			client.SendMessage(msg)
		}
	}
}

func (s *SFU) handleServerICECandidate(p *peer.Peer, candidate *webrtc.ICECandidate) {
	candidateInit := candidate.ToJSON()

	sdpMid := ""
	if candidateInit.SDPMid != nil {
		sdpMid = *candidateInit.SDPMid
	}
	sdpMLineIndex := 0
	if candidateInit.SDPMLineIndex != nil {
		sdpMLineIndex = int(*candidateInit.SDPMLineIndex)
	}

	data, err := json.Marshal(map[string]interface{}{
		"candidate":     candidateInit.Candidate,
		"sdpMid":        sdpMid,
		"sdpMLineIndex": sdpMLineIndex,
		"peerId":        p.ID,
	})
	if err != nil {
		return
	}

	msg := signaling.Message{Type: signaling.MessageTypeICECandidate, Data: data, Timestamp: time.Now()}

	roomClients := s.signalingHub.GetClientsByRoom(p.RoomID)
	for _, client := range roomClients {
		if client.UserID == p.UserID {
			client.SendMessage(msg)
			break
		}
	}
}

func (s *SFU) handleRenegotiationNeeded(targetPeer *peer.Peer, reason string) {
	roomClients := s.signalingHub.GetClientsByRoom(targetPeer.RoomID)

	// Count how many tracks the server has added to this peer so the client
	// can ensure enough recvonly transceivers before creating an offer.
	trackCount := 0
	if targetPeer.Connection != nil {
		for _, sender := range targetPeer.Connection.GetSenders() {
			if sender.Track() != nil {
				trackCount++
			}
		}
	}

	data, err := json.Marshal(map[string]interface{}{
		"reason":     reason,
		"peerId":     targetPeer.ID,
		"trackCount": trackCount,
	})
	if err != nil {
		return
	}

	msg := signaling.Message{Type: signaling.MessageTypeRenegotiate, Data: data, Timestamp: time.Now()}

	for _, client := range roomClients {
		if client.UserID == targetPeer.UserID {
			client.SendMessage(msg)
			break
		}
	}
}

// --- REST API ---

func (s *SFU) handleRoomsAPI(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listRooms(w)
	case http.MethodPost:
		s.createRoom(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SFU) handleRoomAPI(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Path[len("/api/rooms/"):]
	switch r.Method {
	case http.MethodGet:
		s.getRoomInfo(w, roomID)
	case http.MethodDelete:
		s.deleteRoom(w, roomID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *SFU) listRooms(w http.ResponseWriter) {
	s.roomsMu.RLock()
	rooms := make([]map[string]interface{}, 0, len(s.rooms))
	for _, rm := range s.rooms {
		rooms = append(rooms, rm.GetStats())
	}
	s.roomsMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"rooms": rooms, "total": len(rooms)})
}

func (s *SFU) createRoom(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		MaxPeers int    `json:"maxPeers,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	maxPeers := req.MaxPeers
	if maxPeers == 0 {
		maxPeers = s.config.Server.MaxPeersPerRoom
	}

	rm := room.NewRoom(req.Name, maxPeers, s.logger)
	rm.OnRenegotiateNeeded = s.handleRenegotiationNeeded
	rm.OnPeerLeft = s.handlePeerLeft
	rm.OnDominantSpeakerChanged = s.handleDominantSpeakerChanged
	rm.OnQualityStats = s.handleQualityStats
	rm.StartDominantSpeakerDetection()
	rm.StartStatsCollection()

	s.roomsMu.Lock()
	s.rooms[rm.ID] = rm
	s.roomsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rm.GetStats())
}

func (s *SFU) getRoomInfo(w http.ResponseWriter, roomID string) {
	s.roomsMu.RLock()
	rm, exists := s.rooms[roomID]
	s.roomsMu.RUnlock()

	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rm.GetStats())
}

func (s *SFU) deleteRoom(w http.ResponseWriter, roomID string) {
	s.roomsMu.Lock()
	rm, exists := s.rooms[roomID]
	if exists {
		delete(s.rooms, roomID)
	}
	s.roomsMu.Unlock()

	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}
	rm.Close()
	w.WriteHeader(http.StatusNoContent)
}

func (s *SFU) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Count active peers
	s.roomsMu.RLock()
	roomCount := len(s.rooms)
	peerCount := 0
	for _, rm := range s.rooms {
		peerCount += len(rm.GetAllPeers())
	}
	s.roomsMu.RUnlock()

	// Check Redis health
	redisStatus := "connected"
	if s.stateManager == nil {
		redisStatus = "disabled"
	} else if err := s.stateManager.Ping(); err != nil {
		redisStatus = "error: " + err.Error()
	}

	// Get instance ID
	instanceID := ""
	if s.pubsubManager != nil {
		instanceID = s.pubsubManager.GetInstanceID()
	}

	status := "healthy"
	if redisStatus != "connected" && redisStatus != "disabled" {
		status = "degraded"
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     status,
		"timestamp":  time.Now(),
		"instanceId": instanceID,
		"redis":      redisStatus,
		"rooms":      roomCount,
		"peers":      peerCount,
	})
}

// --- WebSocket ---

func (s *SFU) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			if len(s.config.Server.AllowedOrigins) == 0 {
				return true
			}
			origin := r.Header.Get("Origin")
			for _, allowed := range s.config.Server.AllowedOrigins {
				if allowed == "*" || allowed == origin {
					return true
				}
			}
			return false
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	userID := r.URL.Query().Get("userId")
	name := r.URL.Query().Get("name")

	if userID == "" {
		conn.WriteMessage(websocket.CloseMessage, []byte("Missing userId"))
		conn.Close()
		return
	}

	client := signaling.NewClient(
		fmt.Sprintf("client_%d", time.Now().UnixNano()),
		userID, name, conn, s.logger,
	)
	client.OnMessage = s.handleSignalingMessage
	client.OnDisconnect = s.handleClientDisconnect

	// Evict stale WS clients for same userId BEFORE registering the new one.
	// This handles page refreshes where the old connection hasn't closed yet.
	s.signalingHub.DisconnectClientsByUserID(userID, client.ID)

	s.signalingHub.RegisterClient(client)

	go client.WritePump()
	go client.ReadPump()
}

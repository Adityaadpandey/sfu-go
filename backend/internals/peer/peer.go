package peer

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v3"
	"go.uber.org/zap"
)

type MediaType string

const (
	MediaTypeVideo  MediaType = "video"
	MediaTypeAudio  MediaType = "audio"
	MediaTypeScreen MediaType = "screen"
)

type TrackInfo struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	MediaType MediaType `json:"mediaType"`
	Label     string    `json:"label"`
	Enabled   bool      `json:"enabled"`
}

type Peer struct {
	ID          string                 `json:"id"`
	RoomID      string                 `json:"roomId"`
	UserID      string                 `json:"userId"`
	Name        string                 `json:"name"`
	Connection  *webrtc.PeerConnection `json:"-"`
	DataChannel *webrtc.DataChannel    `json:"-"`

	// Track management
	LocalTracks  map[string]*webrtc.TrackLocalStaticRTP `json:"-"`
	RemoteTracks map[string]*webrtc.TrackRemote         `json:"-"`
	TrackInfos   map[string]*TrackInfo                  `json:"tracks"`

	// ICE candidate queuing
	pendingCandidates []webrtc.ICECandidateInit
	remoteDescSet     bool

	// State management
	Connected bool                   `json:"connected"`
	LastSeen  time.Time              `json:"lastSeen"`
	Metadata  map[string]interface{} `json:"metadata"`

	// Synchronization
	mu              sync.RWMutex
	disconnectedOnce sync.Once

	// Perfect negotiation state (server is impolite)
	makingOffer     bool
	ignoreOffer     bool
	isSettingRemote bool

	logger          *zap.Logger

	// Callbacks
	OnTrackAdded            func(*Peer, *webrtc.TrackRemote, *webrtc.RTPReceiver)
	OnTrackRemoved          func(*Peer, string)
	OnDataChannel           func(*Peer, *webrtc.DataChannel)
	OnDisconnected          func(*Peer)
	OnICECandidateGenerated func(*Peer, *webrtc.ICECandidate)
}

func NewPeer(roomID, userID, name string, logger *zap.Logger) *Peer {
	return &Peer{
		ID:                uuid.New().String(),
		RoomID:            roomID,
		UserID:            userID,
		Name:              name,
		LocalTracks:       make(map[string]*webrtc.TrackLocalStaticRTP),
		RemoteTracks:      make(map[string]*webrtc.TrackRemote),
		TrackInfos:        make(map[string]*TrackInfo),
		pendingCandidates: make([]webrtc.ICECandidateInit, 0),
		Connected:         false,
		LastSeen:          time.Now(),
		Metadata:          make(map[string]interface{}),
		logger:            logger,
	}
}

func (p *Peer) CreatePeerConnection(api *webrtc.API, config webrtc.Configuration) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	var pc *webrtc.PeerConnection
	var err error

	if api != nil {
		pc, err = api.NewPeerConnection(config)
	} else {
		pc, err = webrtc.NewPeerConnection(config)
	}

	if err != nil {
		return err
	}

	p.Connection = pc
	p.setupPeerConnectionHandlers()

	return nil
}

func (p *Peer) setupPeerConnectionHandlers() {
	p.Connection.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		p.mu.Lock()
		trackID := track.ID()
		p.RemoteTracks[trackID] = track

		mediaType := MediaTypeAudio
		if track.Kind() == webrtc.RTPCodecTypeVideo {
			if track.StreamID() == "screen" {
				mediaType = MediaTypeScreen
			} else {
				mediaType = MediaTypeVideo
			}
		}

		p.TrackInfos[trackID] = &TrackInfo{
			ID:        trackID,
			Kind:      track.Kind().String(),
			MediaType: mediaType,
			Label:     track.StreamID(),
			Enabled:   true,
		}
		p.mu.Unlock()

		p.logger.Info("Track added",
			zap.String("peerID", p.ID),
			zap.String("trackID", trackID),
			zap.String("kind", track.Kind().String()),
		)

		if p.OnTrackAdded != nil {
			p.OnTrackAdded(p, track, receiver)
		}
	})

	p.Connection.OnDataChannel(func(dc *webrtc.DataChannel) {
		p.mu.Lock()
		p.DataChannel = dc
		p.mu.Unlock()

		p.logger.Info("Data channel opened",
			zap.String("peerID", p.ID),
			zap.String("label", dc.Label()),
		)

		if p.OnDataChannel != nil {
			p.OnDataChannel(p, dc)
		}
	})

	var disconnectTimer *time.Timer
	var timerMu sync.Mutex
	p.Connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		p.mu.Lock()
		wasConnected := p.Connected
		p.Connected = state == webrtc.PeerConnectionStateConnected
		p.LastSeen = time.Now()
		p.mu.Unlock()

		p.logger.Info("Connection state changed",
			zap.String("peerID", p.ID),
			zap.String("state", state.String()),
		)

		// Cancel pending disconnect timer if connection recovers
		if state == webrtc.PeerConnectionStateConnected {
			timerMu.Lock()
			if disconnectTimer != nil {
				disconnectTimer.Stop()
				disconnectTimer = nil
			}
			timerMu.Unlock()
			return
		}

		if !wasConnected || p.OnDisconnected == nil {
			return
		}

		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			timerMu.Lock()
			if disconnectTimer != nil {
				disconnectTimer.Stop()
				disconnectTimer = nil
			}
			timerMu.Unlock()

			p.disconnectedOnce.Do(func() {
				p.logger.Info("Peer connection failed/closed, triggering disconnect",
					zap.String("peerID", p.ID),
					zap.String("state", state.String()),
				)
				p.OnDisconnected(p)
			})
		} else if state == webrtc.PeerConnectionStateDisconnected {
			// ICE disconnected is often transient — give it time to recover
			timerMu.Lock()
			if disconnectTimer == nil {
				disconnectTimer = time.AfterFunc(7*time.Second, func() {
					p.mu.RLock()
					stillDisconnected := !p.Connected
					p.mu.RUnlock()
					if stillDisconnected {
						p.disconnectedOnce.Do(func() {
							p.logger.Info("Peer stayed disconnected, removing",
								zap.String("peerID", p.ID),
							)
							if p.OnDisconnected != nil {
								p.OnDisconnected(p)
							}
						})
					}
				})
			}
			timerMu.Unlock()
		}
	})

	p.Connection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		p.logger.Debug("ICE connection state changed",
			zap.String("peerID", p.ID),
			zap.String("state", state.String()),
		)
	})

	p.Connection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if p.OnICECandidateGenerated != nil {
			p.OnICECandidateGenerated(p, candidate)
		}
	})
}

func (p *Peer) AddTrack(track *webrtc.TrackLocalStaticRTP) (*webrtc.RTPSender, error) {
	p.mu.Lock()
	pc := p.Connection
	p.mu.Unlock()

	// Call pion API without holding the lock to avoid deadlocks with OnTrack callbacks
	sender, err := pc.AddTrack(track)
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	p.LocalTracks[track.ID()] = track
	p.mu.Unlock()

	return sender, nil
}

func (p *Peer) RemoveTrack(trackID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.LocalTracks, trackID)
	delete(p.TrackInfos, trackID)

	if p.OnTrackRemoved != nil {
		p.OnTrackRemoved(p, trackID)
	}

	return nil
}

func (p *Peer) GetTrackInfo(trackID string) (*TrackInfo, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	info, exists := p.TrackInfos[trackID]
	return info, exists
}

func (p *Peer) GetAllTracks() map[string]*TrackInfo {
	p.mu.RLock()
	defer p.mu.RUnlock()

	tracks := make(map[string]*TrackInfo)
	for id, info := range p.TrackInfos {
		tracks[id] = info
	}
	return tracks
}

func (p *Peer) SendDataChannelMessage(message []byte) error {
	p.mu.RLock()
	dc := p.DataChannel
	p.mu.RUnlock()

	if dc == nil {
		return ErrDataChannelNotOpen
	}

	return dc.Send(message)
}

func (p *Peer) SetMetadata(key string, value interface{}) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.Metadata[key] = value
}

func (p *Peer) GetMetadata(key string) (interface{}, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	value, exists := p.Metadata[key]
	return value, exists
}

func (p *Peer) IsConnected() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return p.Connected
}

// AddICECandidate queues the candidate if remote description isn't set yet,
// otherwise adds it directly.
func (p *Peer) AddICECandidate(candidate webrtc.ICECandidateInit) error {
	p.mu.Lock()
	if !p.remoteDescSet {
		p.pendingCandidates = append(p.pendingCandidates, candidate)
		p.mu.Unlock()
		p.logger.Debug("Queued ICE candidate (remote desc not set yet)",
			zap.String("peerID", p.ID),
		)
		return nil
	}
	pc := p.Connection
	p.mu.Unlock()

	return pc.AddICECandidate(candidate)
}

// SetRemoteDescription sets the remote description and flushes any queued ICE candidates.
func (p *Peer) SetRemoteDescription(desc webrtc.SessionDescription) error {
	p.mu.Lock()
	pc := p.Connection
	p.mu.Unlock()

	if err := pc.SetRemoteDescription(desc); err != nil {
		return err
	}

	p.mu.Lock()
	p.remoteDescSet = true
	pending := make([]webrtc.ICECandidateInit, len(p.pendingCandidates))
	copy(pending, p.pendingCandidates)
	p.pendingCandidates = p.pendingCandidates[:0]
	p.mu.Unlock()

	for _, c := range pending {
		if err := pc.AddICECandidate(c); err != nil {
			p.logger.Warn("Failed to add queued ICE candidate",
				zap.String("peerID", p.ID),
				zap.Error(err),
			)
		}
	}

	return nil
}

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

func (p *Peer) Close() error {
	p.mu.Lock()
	pc := p.Connection
	p.LocalTracks = make(map[string]*webrtc.TrackLocalStaticRTP)
	p.RemoteTracks = make(map[string]*webrtc.TrackRemote)
	p.TrackInfos = make(map[string]*TrackInfo)
	p.mu.Unlock()

	if pc != nil {
		return pc.Close()
	}
	return nil
}

func (p *Peer) SendPLI(ssrc uint32) error {
	p.mu.RLock()
	pc := p.Connection
	p.mu.RUnlock()

	if pc == nil {
		return fmt.Errorf("peer connection not initialized")
	}

	pli := []rtcp.Packet{
		&rtcp.PictureLossIndication{MediaSSRC: ssrc},
	}

	return pc.WriteRTCP(pli)
}

// ConnectionQuality holds quality metrics for this peer's connection.
type ConnectionQuality struct {
	Level      string  `json:"level"`
	PacketLoss float64 `json:"packetLoss"`
}

// GetConnectionQuality computes connection quality from WebRTC stats.
func (p *Peer) GetConnectionQuality() *ConnectionQuality {
	p.mu.RLock()
	pc := p.Connection
	p.mu.RUnlock()

	if pc == nil {
		return nil
	}

	stats := pc.GetStats()

	var totalPacketsReceived uint64
	var totalPacketsLost uint32

	for _, s := range stats {
		if inbound, ok := s.(webrtc.InboundRTPStreamStats); ok {
			totalPacketsReceived += uint64(inbound.PacketsReceived)
			totalPacketsLost += uint32(inbound.PacketsLost)
		}
	}

	var lossPercent float64
	totalPackets := totalPacketsReceived + uint64(totalPacketsLost)
	if totalPackets > 0 {
		lossPercent = float64(totalPacketsLost) / float64(totalPackets) * 100
	}

	level := "excellent"
	if lossPercent >= 15 {
		level = "critical"
	} else if lossPercent >= 5 {
		level = "poor"
	} else if lossPercent >= 1 {
		level = "good"
	}

	return &ConnectionQuality{
		Level:      level,
		PacketLoss: lossPercent,
	}
}

var (
	ErrDataChannelNotOpen = fmt.Errorf("data channel is not open")
)

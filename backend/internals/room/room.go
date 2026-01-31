package room

import (
	"context"
	"fmt"
	"io"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/adityaadpandey/sfu-go/internals/peer"
	"github.com/google/uuid"
	"github.com/pion/webrtc/v3"
	"go.uber.org/zap"
)

type RoomState string

const (
	RoomStateActive   RoomState = "active"
	RoomStateInactive RoomState = "inactive"
	RoomStateClosed   RoomState = "closed"
)

var defaultAllowedCodecs = map[string]bool{
	"video/VP8":  true,
	"video/VP9":  true,
	"video/H264": true,
	"audio/opus": true,
}

// SimulcastLayer represents a single quality layer of a simulcast track.
type SimulcastLayer struct {
	RID    string
	Track  *webrtc.TrackRemote
	Active bool
}

// SubscriberState tracks per-subscriber forwarding state for a media track.
type SubscriberState struct {
	Sender     *webrtc.RTPSender
	LocalTrack *webrtc.TrackLocalStaticRTP
	CurrentRID string // which simulcast layer this subscriber receives ("" = non-simulcast)
}

// AudioLevel tracks speaking activity for a peer.
type AudioLevel struct {
	Score      float64
	LastPacket time.Time
	PacketRate float64 // packets per second (EMA)
}

// PeerQuality represents connection quality for a peer.
type PeerQuality struct {
	Level      string  `json:"level"`      // excellent, good, poor, critical
	PacketLoss float64 `json:"packetLoss"` // percentage
}

type Room struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	State     RoomState `json:"state"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	MaxPeers  int       `json:"maxPeers"`

	// Peer management
	Peers       map[string]*peer.Peer `json:"-"`
	peersByUser map[string]string
	peerCount   int

	// Media management
	MediaTracks map[string]*MediaTrack `json:"-"`

	// Settings
	Settings *RoomSettings `json:"settings"`

	// Context for lifecycle
	ctx    context.Context
	cancel context.CancelFunc

	// Allowed codecs
	AllowedCodecs map[string]bool

	// Synchronization
	mu     sync.RWMutex
	logger *zap.Logger

	// Callbacks
	OnPeerJoined            func(*Room, *peer.Peer)
	OnPeerLeft              func(*Room, *peer.Peer)
	OnTrackAdded            func(*Room, *peer.Peer, *MediaTrack)
	OnTrackRemoved          func(*Room, *peer.Peer, string)
	OnRenegotiateNeeded     func(*peer.Peer, string)
	OnDominantSpeakerChanged func(roomID, oldPeerID, newPeerID string)
	OnQualityStats          func(peerID string, quality *PeerQuality)

	// Renegotiation throttling
	renegotiationTimers map[string]*time.Timer
	lastRenegotiation   map[string]time.Time
	renegotiationDelay  time.Duration
	renegotiationMu     sync.Mutex

	// Dominant speaker
	audioLevels      map[string]*AudioLevel
	dominantSpeaker  string
	audioLevelsMu    sync.Mutex

	// Stats
	statsInterval            time.Duration
	speakerDetectionInterval time.Duration

	// Configurable limits
	maxRTPErrors     int
	simulcastEnabled bool
}

type MediaTrack struct {
	ID          string                        `json:"id"`
	PeerID      string                        `json:"peerId"`
	Kind        string                        `json:"kind"`
	MediaType   peer.MediaType                `json:"mediaType"`
	Track       *webrtc.TrackRemote           `json:"-"`
	Receiver    *webrtc.RTPReceiver           `json:"-"`
	Subscribers map[string]*SubscriberState   `json:"-"`
	LocalTracks map[string]*webrtc.TrackLocalStaticRTP `json:"-"`
	CreatedAt   time.Time                     `json:"createdAt"`
	mu          sync.RWMutex

	ctx           context.Context
	cancel        context.CancelFunc
	fanOutStarted bool

	// Simulcast
	Layers     map[string]*SimulcastLayer `json:"-"` // RID -> layer
	IsSimulcast bool                      `json:"isSimulcast"`
	BaseTrackID string                    `json:"baseTrackId"` // grouping key: StreamID+Kind
}

type RoomSettings struct {
	AudioEnabled       bool `json:"audioEnabled"`
	VideoEnabled       bool `json:"videoEnabled"`
	ScreenShareEnabled bool `json:"screenShareEnabled"`
	RecordingEnabled   bool `json:"recordingEnabled"`
	MaxVideoBitrate    int  `json:"maxVideoBitrate"`
	MaxAudioBitrate    int  `json:"maxAudioBitrate"`
}

func NewRoom(name string, maxPeers int, logger *zap.Logger) *Room {
	ctx, cancel := context.WithCancel(context.Background())
	return &Room{
		ID:          uuid.New().String(),
		Name:        name,
		State:       RoomStateActive,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
		MaxPeers:    maxPeers,
		Peers:       make(map[string]*peer.Peer),
		peersByUser: make(map[string]string),
		peerCount:   0,
		MediaTracks: make(map[string]*MediaTrack),
		Settings: &RoomSettings{
			AudioEnabled:       true,
			VideoEnabled:       true,
			ScreenShareEnabled: true,
			RecordingEnabled:   false,
			MaxVideoBitrate:    2000000,
			MaxAudioBitrate:    128000,
		},
		ctx:                 ctx,
		cancel:              cancel,
		AllowedCodecs:       defaultAllowedCodecs,
		renegotiationTimers: make(map[string]*time.Timer),
		lastRenegotiation:   make(map[string]time.Time),
		renegotiationDelay:  150 * time.Millisecond,
		maxRTPErrors:        50,
		simulcastEnabled:    false,
		audioLevels:         make(map[string]*AudioLevel),
		statsInterval:       3 * time.Second,
		speakerDetectionInterval: 200 * time.Millisecond,
		logger:              logger,
	}
}

func (r *Room) SetRenegotiationDelay(d time.Duration) {
	r.renegotiationMu.Lock()
	defer r.renegotiationMu.Unlock()
	r.renegotiationDelay = d
}

func (r *Room) SetMaxRTPErrors(n int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.maxRTPErrors = n
}

func (r *Room) SetSimulcastEnabled(v bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.simulcastEnabled = v
}

func (r *Room) SetStatsInterval(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statsInterval = d
}

func (r *Room) SetSpeakerDetectionInterval(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.speakerDetectionInterval = d
}

func (r *Room) GetPeerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.peerCount
}

func (r *Room) AddPeer(p *peer.Peer) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.State == RoomStateClosed {
		return fmt.Errorf("room is closed")
	}
	if r.State == RoomStateInactive {
		r.State = RoomStateActive
	}
	if r.peerCount >= r.MaxPeers {
		return fmt.Errorf("room is full")
	}
	if _, exists := r.Peers[p.ID]; exists {
		return fmt.Errorf("peer already exists in room")
	}

	p.OnTrackAdded = r.handlePeerTrackAdded
	p.OnTrackRemoved = r.handlePeerTrackRemoved
	p.OnDisconnected = r.handlePeerDisconnected

	r.Peers[p.ID] = p
	r.peersByUser[p.UserID] = p.ID
	r.peerCount++
	r.UpdatedAt = time.Now()

	r.logger.Info("Peer joined room",
		zap.String("roomID", r.ID),
		zap.String("peerID", p.ID),
		zap.String("userName", p.Name),
		zap.Int("peerCount", r.peerCount),
	)

	if r.OnPeerJoined != nil {
		r.OnPeerJoined(r, p)
	}

	return nil
}

func (r *Room) RemovePeer(peerID string) error {
	r.mu.Lock()

	p, exists := r.Peers[peerID]
	if !exists {
		r.mu.Unlock()
		return fmt.Errorf("peer not found in room")
	}

	affectedPeers := r.removePeerTracks(peerID)

	delete(r.Peers, peerID)
	delete(r.peersByUser, p.UserID)
	r.peerCount--
	r.UpdatedAt = time.Now()
	peerCount := r.peerCount

	if peerCount == 0 {
		r.State = RoomStateInactive
	}

	r.logger.Info("Peer left room",
		zap.String("roomID", r.ID),
		zap.String("peerID", peerID),
		zap.Int("peerCount", peerCount),
	)

	if r.OnPeerLeft != nil {
		r.OnPeerLeft(r, p)
	}

	r.mu.Unlock()

	// Clean up audio levels
	r.audioLevelsMu.Lock()
	delete(r.audioLevels, peerID)
	if r.dominantSpeaker == peerID {
		r.dominantSpeaker = ""
	}
	r.audioLevelsMu.Unlock()

	// Stop renegotiation timers
	r.renegotiationMu.Lock()
	if timer, ok := r.renegotiationTimers[peerID]; ok {
		timer.Stop()
		delete(r.renegotiationTimers, peerID)
	}
	delete(r.lastRenegotiation, peerID)
	r.renegotiationMu.Unlock()

	for _, ap := range affectedPeers {
		r.triggerRenegotiation(ap)
	}

	p.Close()

	return nil
}

func (r *Room) GetPeerByUserID(userID string) (*peer.Peer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	pid, ok := r.peersByUser[userID]
	if !ok {
		return nil, false
	}
	p, exists := r.Peers[pid]
	return p, exists
}

func (r *Room) GetPeer(peerID string) (*peer.Peer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, exists := r.Peers[peerID]
	return p, exists
}

func (r *Room) GetAllPeers() []*peer.Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	peers := make([]*peer.Peer, 0, len(r.Peers))
	for _, p := range r.Peers {
		peers = append(peers, p)
	}
	return peers
}

func (r *Room) BroadcastMessage(message []byte, excludePeerID string) {
	r.mu.RLock()
	peers := make([]*peer.Peer, 0, len(r.Peers))
	for _, p := range r.Peers {
		if p.ID != excludePeerID && p.IsConnected() {
			peers = append(peers, p)
		}
	}
	r.mu.RUnlock()

	for _, p := range peers {
		go func(pr *peer.Peer) {
			if err := pr.SendDataChannelMessage(message); err != nil {
				r.logger.Debug("Failed to send message to peer",
					zap.String("peerID", pr.ID),
					zap.Error(err),
				)
			}
		}(p)
	}
}

func (r *Room) handlePeerTrackAdded(p *peer.Peer, track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
	codecMime := track.Codec().MimeType
	if !r.isCodecAllowed(codecMime) {
		r.logger.Warn("Rejected track with disallowed codec",
			zap.String("peerID", p.ID),
			zap.String("codec", codecMime),
		)
		return
	}

	baseTrackID := track.StreamID() + ":" + track.Kind().String()

	r.mu.Lock()

	// ---- Handle duplicate OnTrack for same track ID ----
	// Pion may fire OnTrack multiple times for the same track ID (e.g. once
	// with RID="" then again with RID="h"). Just ignore duplicates.
	if _, ok := r.MediaTracks[track.ID()]; ok {
		r.mu.Unlock()
		r.logger.Debug("Ignoring duplicate OnTrack",
			zap.String("peerID", p.ID),
			zap.String("trackID", track.ID()),
			zap.String("rid", track.RID()),
		)
		return
	}

	// ---- Non-simulcast track ----
	trackCtx, trackCancel := context.WithCancel(r.ctx)

	mediaTrack := &MediaTrack{
		ID:            track.ID(),
		PeerID:        p.ID,
		Kind:          track.Kind().String(),
		Track:         track,
		Receiver:      receiver,
		Subscribers:   make(map[string]*SubscriberState),
		LocalTracks:   make(map[string]*webrtc.TrackLocalStaticRTP),
		CreatedAt:     time.Now(),
		ctx:           trackCtx,
		cancel:        trackCancel,
		fanOutStarted: false,
		IsSimulcast:   false,
		BaseTrackID:   baseTrackID,
		Layers:        make(map[string]*SimulcastLayer),
	}

	if track.Kind() == webrtc.RTPCodecTypeVideo {
		if track.StreamID() == "screen" {
			mediaTrack.MediaType = peer.MediaTypeScreen
		} else {
			mediaTrack.MediaType = peer.MediaTypeVideo
		}
	} else {
		mediaTrack.MediaType = peer.MediaTypeAudio
	}

	r.MediaTracks[track.ID()] = mediaTrack
	r.mu.Unlock()

	r.logger.Debug("Track added to room",
		zap.String("peerID", p.ID),
		zap.String("trackID", track.ID()),
		zap.String("kind", track.Kind().String()),
	)

	if r.OnTrackAdded != nil {
		r.OnTrackAdded(r, p, mediaTrack)
	}

	go r.startFanOutForwarding(mediaTrack)
	go r.forwardTrackToOtherPeers(mediaTrack, p.ID)
	if mediaTrack.Kind == "video" {
		go r.periodicPLI(mediaTrack)
	}
}

func (r *Room) isCodecAllowed(mimeType string) bool {
	if len(r.AllowedCodecs) == 0 {
		return true
	}
	for allowed := range r.AllowedCodecs {
		if strings.EqualFold(allowed, mimeType) {
			return true
		}
	}
	return false
}

func (r *Room) handlePeerTrackRemoved(p *peer.Peer, trackID string) {
	r.mu.Lock()
	mt, exists := r.MediaTracks[trackID]
	if exists {
		if mt.cancel != nil {
			mt.cancel()
		}
		delete(r.MediaTracks, trackID)
	}
	r.mu.Unlock()

	if r.OnTrackRemoved != nil {
		r.OnTrackRemoved(r, p, trackID)
	}
}

func (r *Room) handlePeerDisconnected(p *peer.Peer) {
	r.RemovePeer(p.ID)
}

// AddExistingTracksToPeer adds all existing tracks to a new peer's connection
// synchronously, WITHOUT triggering renegotiation.
func (r *Room) AddExistingTracksToPeer(newPeer *peer.Peer) int {
	r.mu.RLock()
	tracks := make([]*MediaTrack, 0)
	for _, track := range r.MediaTracks {
		if track.PeerID != newPeer.ID {
			tracks = append(tracks, track)
		}
	}
	r.mu.RUnlock()

	added := 0
	for _, mediaTrack := range tracks {
		r.logger.Info("Adding existing track to new peer",
			zap.String("newPeerID", newPeer.ID),
			zap.String("trackID", mediaTrack.ID),
			zap.String("kind", mediaTrack.Kind),
			zap.String("fromPeer", mediaTrack.PeerID),
		)
		if r.forwardTrackToPeerDirect(mediaTrack, newPeer) {
			added++
		}
	}

	if added > 0 {
		r.logger.Info("Added existing tracks to new peer before answer",
			zap.String("newPeerID", newPeer.ID),
			zap.Int("trackCount", added),
		)
		for _, mediaTrack := range tracks {
			if mediaTrack.Kind == "video" {
				r.requestPLI(mediaTrack, 200*time.Millisecond)
			}
		}
	}

	return added
}

func (r *Room) forwardTrackToOtherPeers(mediaTrack *MediaTrack, excludePeerID string) {
	r.mu.RLock()
	peers := make([]*peer.Peer, 0)
	for _, p := range r.Peers {
		if p.ID != excludePeerID && p.Connection != nil {
			peers = append(peers, p)
		}
	}
	r.mu.RUnlock()

	r.logger.Info("Forwarding track to other peers",
		zap.String("trackID", mediaTrack.ID),
		zap.String("kind", mediaTrack.Kind),
		zap.String("fromPeer", mediaTrack.PeerID),
		zap.Int("targetPeers", len(peers)),
	)

	for _, p := range peers {
		go r.forwardTrackToPeer(mediaTrack, p)
	}
}

func (r *Room) forwardTrackToPeer(mediaTrack *MediaTrack, targetPeer *peer.Peer) {
	if r.forwardTrackToPeerDirect(mediaTrack, targetPeer) {
		r.triggerRenegotiation(targetPeer)

		if mediaTrack.Kind == "video" {
			r.requestPLI(mediaTrack, 20*time.Millisecond)
		}
		return
	}

	// AddTrack failed (likely no free transceivers). Trigger renegotiation so the
	// client can add more transceivers, then retry once.
	r.logger.Warn("Track forwarding failed, requesting renegotiation for retry",
		zap.String("trackID", mediaTrack.ID),
		zap.String("toPeer", targetPeer.ID),
	)
	r.triggerRenegotiation(targetPeer)

	go func() {
		time.Sleep(2 * time.Second) // wait for renegotiation round-trip
		r.mu.RLock()
		_, stillExists := r.Peers[targetPeer.ID]
		r.mu.RUnlock()
		if !stillExists {
			return
		}
		if r.forwardTrackToPeerDirect(mediaTrack, targetPeer) {
			r.triggerRenegotiation(targetPeer)
			if mediaTrack.Kind == "video" {
				r.requestPLI(mediaTrack, 20*time.Millisecond)
			}
		}
	}()
}

func (r *Room) forwardTrackToPeerDirect(mediaTrack *MediaTrack, targetPeer *peer.Peer) bool {
	// Dedup: don't add the same track to the same peer twice
	mediaTrack.mu.RLock()
	_, alreadySubscribed := mediaTrack.Subscribers[targetPeer.ID]
	mediaTrack.mu.RUnlock()
	if alreadySubscribed {
		r.logger.Debug("Track already forwarded to peer, skipping",
			zap.String("trackID", mediaTrack.ID),
			zap.String("toPeer", targetPeer.ID),
		)
		return false
	}

	localTrack, err := webrtc.NewTrackLocalStaticRTP(
		webrtc.RTPCodecCapability{MimeType: mediaTrack.Track.Codec().MimeType},
		mediaTrack.ID+"_to_"+targetPeer.ID,
		mediaTrack.PeerID,
	)
	if err != nil {
		r.logger.Error("Failed to create local track",
			zap.String("trackID", mediaTrack.ID),
			zap.Error(err),
		)
		return false
	}

	sender, err := targetPeer.AddTrack(localTrack)
	if err != nil {
		r.logger.Error("Failed to add track to peer",
			zap.String("peerID", targetPeer.ID),
			zap.String("trackID", mediaTrack.ID),
			zap.Error(err),
		)
		return false
	}

	// Drain RTCP from sender so Pion's internal buffer doesn't fill up and stall
	go func() {
		buf := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(buf); err != nil {
				return
			}
		}
	}()

	// Determine default RID for simulcast subscribers
	defaultRID := ""
	if mediaTrack.IsSimulcast {
		defaultRID = "h" // default to highest quality
		mediaTrack.mu.RLock()
		if _, ok := mediaTrack.Layers["h"]; !ok {
			// Pick whatever layer is available
			for rid := range mediaTrack.Layers {
				defaultRID = rid
				break
			}
		}
		mediaTrack.mu.RUnlock()
	}

	mediaTrack.mu.Lock()
	mediaTrack.Subscribers[targetPeer.ID] = &SubscriberState{
		Sender:     sender,
		LocalTrack: localTrack,
		CurrentRID: defaultRID,
	}
	mediaTrack.LocalTracks[targetPeer.ID] = localTrack
	mediaTrack.mu.Unlock()

	r.logger.Debug("Track forwarded",
		zap.String("trackID", mediaTrack.ID),
		zap.String("kind", mediaTrack.Kind),
		zap.String("toPeer", targetPeer.ID),
	)

	return true
}

func (r *Room) requestPLI(mediaTrack *MediaTrack, delay time.Duration) {
	r.mu.RLock()
	sourcePeer, exists := r.Peers[mediaTrack.PeerID]
	r.mu.RUnlock()

	if exists && sourcePeer != nil {
		go func() {
			time.Sleep(delay)
			if err := sourcePeer.SendPLI(uint32(mediaTrack.Track.SSRC())); err != nil {
				r.logger.Debug("Failed to send PLI", zap.Error(err))
			}
		}()
	}
}

// periodicPLI sends a PLI (keyframe request) every 2 seconds for a video track.
// Without periodic PLIs, any packet loss causes permanent video freeze.
func (r *Room) periodicPLI(mediaTrack *MediaTrack) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-mediaTrack.ctx.Done():
			return
		case <-ticker.C:
			r.mu.RLock()
			sourcePeer, exists := r.Peers[mediaTrack.PeerID]
			r.mu.RUnlock()
			if !exists || sourcePeer == nil {
				return
			}

			// For simulcast tracks, send PLI for each layer
			if mediaTrack.IsSimulcast {
				mediaTrack.mu.RLock()
				for _, layer := range mediaTrack.Layers {
					sourcePeer.SendPLI(uint32(layer.Track.SSRC()))
				}
				mediaTrack.mu.RUnlock()
			} else {
				sourcePeer.SendPLI(uint32(mediaTrack.Track.SSRC()))
			}
		}
	}
}

// startFanOutForwarding reads RTP from a non-simulcast track and writes to all subscribers.
func (r *Room) startFanOutForwarding(mediaTrack *MediaTrack) {
	mediaTrack.mu.Lock()
	if mediaTrack.fanOutStarted {
		mediaTrack.mu.Unlock()
		return
	}
	mediaTrack.fanOutStarted = true
	mediaTrack.mu.Unlock()

	r.logger.Debug("Starting fan-out forwarding",
		zap.String("trackID", mediaTrack.ID),
		zap.String("kind", mediaTrack.Kind),
	)

	isAudio := mediaTrack.Kind == "audio"
	packetCount := 0

	for {
		select {
		case <-mediaTrack.ctx.Done():
			goto done
		default:
		}

		// If this track was upgraded to simulcast, stop the non-simulcast
		// fan-out so the per-layer fan-outs take over exclusively.
		if mediaTrack.IsSimulcast {
			r.logger.Debug("Fan-out yielding to simulcast layer fan-outs",
				zap.String("trackID", mediaTrack.ID),
			)
			goto done
		}

		packet, _, err := mediaTrack.Track.ReadRTP()
		if err != nil {
			if err == io.EOF {
				break
			}
			select {
			case <-mediaTrack.ctx.Done():
				goto done
			default:
			}
			time.Sleep(5 * time.Millisecond)
			continue
		}

		mediaTrack.mu.RLock()
		for _, localTrack := range mediaTrack.LocalTracks {
			localTrack.WriteRTP(packet)
		}
		mediaTrack.mu.RUnlock()

		packetCount++

		if isAudio {
			r.trackAudioActivity(mediaTrack.PeerID)
		}
	}

done:
	r.logger.Debug("Fan-out stopped",
		zap.String("trackID", mediaTrack.ID),
		zap.Int("packets", packetCount),
	)
}

// startLayerFanOut reads RTP from a specific simulcast layer and writes only to
// subscribers currently on that layer.
func (r *Room) startLayerFanOut(mediaTrack *MediaTrack, rid string) {
	mediaTrack.mu.RLock()
	layer, ok := mediaTrack.Layers[rid]
	mediaTrack.mu.RUnlock()
	if !ok {
		return
	}

	r.logger.Debug("Starting simulcast layer fan-out",
		zap.String("trackID", mediaTrack.ID),
		zap.String("rid", rid),
	)

	for {
		select {
		case <-mediaTrack.ctx.Done():
			return
		default:
		}

		packet, _, err := layer.Track.ReadRTP()
		if err != nil {
			if err == io.EOF {
				return
			}
			select {
			case <-mediaTrack.ctx.Done():
				return
			default:
			}
			// Transient error (browser may pause simulcast layers) — retry
			time.Sleep(5 * time.Millisecond)
			continue
		}

		// Write only to subscribers on this layer
		mediaTrack.mu.RLock()
		for _, sub := range mediaTrack.Subscribers {
			if sub.CurrentRID == rid {
				sub.LocalTrack.WriteRTP(packet)
			}
		}
		mediaTrack.mu.RUnlock()
	}
}

// SwitchLayer changes which simulcast layer a subscriber receives.
func (r *Room) SwitchLayer(mediaTrackID, subscriberPeerID, targetRID string) error {
	r.mu.RLock()
	mt, exists := r.MediaTracks[mediaTrackID]
	r.mu.RUnlock()

	if !exists {
		return fmt.Errorf("track not found: %s", mediaTrackID)
	}
	if !mt.IsSimulcast {
		return fmt.Errorf("track is not simulcast")
	}

	mt.mu.Lock()
	defer mt.mu.Unlock()

	if _, ok := mt.Layers[targetRID]; !ok {
		return fmt.Errorf("layer %s not available", targetRID)
	}

	sub, ok := mt.Subscribers[subscriberPeerID]
	if !ok {
		return fmt.Errorf("subscriber not found: %s", subscriberPeerID)
	}

	sub.CurrentRID = targetRID

	r.logger.Info("Layer switched",
		zap.String("trackID", mediaTrackID),
		zap.String("subscriber", subscriberPeerID),
		zap.String("layer", targetRID),
	)

	// Request keyframe for the new layer
	go func() {
		mt.mu.RLock()
		layer, ok := mt.Layers[targetRID]
		mt.mu.RUnlock()
		if !ok {
			return
		}

		r.mu.RLock()
		sourcePeer, exists := r.Peers[mt.PeerID]
		r.mu.RUnlock()

		if exists && sourcePeer != nil {
			sourcePeer.SendPLI(uint32(layer.Track.SSRC()))
		}
	}()

	return nil
}

// GetAvailableLayers returns the RIDs available for a simulcast track.
func (r *Room) GetAvailableLayers(mediaTrackID string) []string {
	r.mu.RLock()
	mt, exists := r.MediaTracks[mediaTrackID]
	r.mu.RUnlock()

	if !exists || !mt.IsSimulcast {
		return nil
	}

	mt.mu.RLock()
	defer mt.mu.RUnlock()

	rids := make([]string, 0, len(mt.Layers))
	for rid, layer := range mt.Layers {
		if layer.Active {
			rids = append(rids, rid)
		}
	}
	return rids
}

// removePeerTracks removes all tracks owned by peerID and cleans up subscriptions.
func (r *Room) removePeerTracks(peerID string) []*peer.Peer {
	tracksToRemove := make([]string, 0)
	affectedPeerSet := make(map[string]*peer.Peer)

	for trackID, mediaTrack := range r.MediaTracks {
		if mediaTrack.PeerID == peerID {
			if mediaTrack.cancel != nil {
				mediaTrack.cancel()
			}

			mediaTrack.mu.Lock()
			for subPeerID, sub := range mediaTrack.Subscribers {
				if subPeer, ok := r.Peers[subPeerID]; ok {
					if subPeer.Connection != nil {
						if err := subPeer.Connection.RemoveTrack(sub.Sender); err != nil {
							r.logger.Debug("Failed to remove track from subscriber",
								zap.String("subPeer", subPeerID),
								zap.Error(err),
							)
						}
					}
					affectedPeerSet[subPeerID] = subPeer
				}
			}
			mediaTrack.mu.Unlock()

			tracksToRemove = append(tracksToRemove, trackID)
		} else {
			mediaTrack.mu.Lock()
			delete(mediaTrack.Subscribers, peerID)
			delete(mediaTrack.LocalTracks, peerID)
			mediaTrack.mu.Unlock()
		}
	}

	for _, trackID := range tracksToRemove {
		delete(r.MediaTracks, trackID)
	}

	delete(affectedPeerSet, peerID)

	affected := make([]*peer.Peer, 0, len(affectedPeerSet))
	for _, p := range affectedPeerSet {
		affected = append(affected, p)
	}
	return affected
}

// --- Dominant speaker detection ---

func (r *Room) trackAudioActivity(peerID string) {
	r.audioLevelsMu.Lock()
	defer r.audioLevelsMu.Unlock()

	level, ok := r.audioLevels[peerID]
	if !ok {
		level = &AudioLevel{}
		r.audioLevels[peerID] = level
	}

	now := time.Now()
	elapsed := now.Sub(level.LastPacket).Seconds()
	if elapsed < 0.001 {
		elapsed = 0.001
	}
	level.LastPacket = now

	// Instant rate
	instantRate := 1.0 / elapsed
	// EMA with alpha=0.3
	alpha := 0.3
	level.PacketRate = alpha*instantRate + (1-alpha)*level.PacketRate
	// Score decays toward packet rate
	level.Score = alpha*level.PacketRate + (1-alpha)*level.Score
}

// StartDominantSpeakerDetection runs a goroutine that periodically computes the dominant speaker.
func (r *Room) StartDominantSpeakerDetection() {
	go func() {
		r.mu.RLock()
		interval := r.speakerDetectionInterval
		r.mu.RUnlock()
		if interval <= 0 {
			interval = 200 * time.Millisecond
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-r.ctx.Done():
				return
			case <-ticker.C:
				r.computeDominantSpeaker()
			}
		}
	}()
}

func (r *Room) computeDominantSpeaker() {
	r.audioLevelsMu.Lock()

	// Apply decay to all levels
	now := time.Now()
	var bestPeer string
	var bestScore float64

	for peerID, level := range r.audioLevels {
		elapsed := now.Sub(level.LastPacket).Seconds()
		// Decay score if no recent packets
		if elapsed > 0.5 {
			level.Score *= math.Exp(-elapsed)
		}
		if level.Score > bestScore {
			bestScore = level.Score
			bestPeer = peerID
		}
	}

	// Minimum threshold to be considered "speaking"
	if bestScore < 5.0 {
		bestPeer = ""
	}

	oldSpeaker := r.dominantSpeaker
	r.dominantSpeaker = bestPeer
	r.audioLevelsMu.Unlock()

	if oldSpeaker != bestPeer && r.OnDominantSpeakerChanged != nil {
		r.OnDominantSpeakerChanged(r.ID, oldSpeaker, bestPeer)
	}
}

func (r *Room) GetDominantSpeaker() string {
	r.audioLevelsMu.Lock()
	defer r.audioLevelsMu.Unlock()
	return r.dominantSpeaker
}

// --- Stats ---

// StartStatsCollection runs a goroutine that periodically collects and broadcasts stats.
func (r *Room) StartStatsCollection() {
	go func() {
		r.mu.RLock()
		interval := r.statsInterval
		r.mu.RUnlock()
		if interval <= 0 {
			interval = 3 * time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-r.ctx.Done():
				return
			case <-ticker.C:
				r.collectAndBroadcastStats()
			}
		}
	}()
}

func (r *Room) collectAndBroadcastStats() {
	r.mu.RLock()
	peers := make([]*peer.Peer, 0, len(r.Peers))
	for _, p := range r.Peers {
		peers = append(peers, p)
	}
	r.mu.RUnlock()

	for _, p := range peers {
		quality := p.GetConnectionQuality()
		if quality != nil && r.OnQualityStats != nil {
			r.OnQualityStats(p.ID, &PeerQuality{
				Level:      quality.Level,
				PacketLoss: quality.PacketLoss,
			})
		}
	}
}

// --- Room settings and stats ---

func (r *Room) UpdateSettings(settings *RoomSettings) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Settings = settings
	r.UpdatedAt = time.Now()
}

func (r *Room) GetStats() map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return map[string]interface{}{
		"id":         r.ID,
		"name":       r.Name,
		"state":      r.State,
		"peerCount":  r.peerCount,
		"trackCount": len(r.MediaTracks),
		"createdAt":  r.CreatedAt,
		"updatedAt":  r.UpdatedAt,
	}
}

func (r *Room) IsEmpty() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.peerCount == 0
}

func (r *Room) Close() error {
	r.mu.Lock()
	r.State = RoomStateClosed
	r.cancel()

	for _, p := range r.Peers {
		p.Close()
	}

	r.Peers = make(map[string]*peer.Peer)
	r.peersByUser = make(map[string]string)
	r.MediaTracks = make(map[string]*MediaTrack)
	r.peerCount = 0
	r.mu.Unlock()

	r.renegotiationMu.Lock()
	for id, timer := range r.renegotiationTimers {
		timer.Stop()
		delete(r.renegotiationTimers, id)
	}
	r.renegotiationMu.Unlock()

	return nil
}

func (r *Room) triggerRenegotiation(targetPeer *peer.Peer) {
	r.renegotiationMu.Lock()
	defer r.renegotiationMu.Unlock()

	if _, hasPending := r.renegotiationTimers[targetPeer.ID]; hasPending {
		return
	}

	lastTime, exists := r.lastRenegotiation[targetPeer.ID]
	delay := r.renegotiationDelay

	if exists && time.Since(lastTime) < delay {
		wait := delay - time.Since(lastTime)

		peerID := targetPeer.ID
		timer := time.AfterFunc(wait, func() {
			r.renegotiationMu.Lock()
			delete(r.renegotiationTimers, peerID)
			r.lastRenegotiation[peerID] = time.Now()
			r.renegotiationMu.Unlock()

			r.mu.RLock()
			_, stillExists := r.Peers[peerID]
			r.mu.RUnlock()

			if !stillExists {
				return
			}

			if r.OnRenegotiateNeeded != nil {
				r.OnRenegotiateNeeded(targetPeer, "scheduled")
			}
		})
		r.renegotiationTimers[peerID] = timer
		return
	}

	r.lastRenegotiation[targetPeer.ID] = time.Now()

	if r.OnRenegotiateNeeded != nil {
		r.OnRenegotiateNeeded(targetPeer, "track_change")
	}
}

// GetSimulcastTracks returns all simulcast media tracks with their available layers.
func (r *Room) GetSimulcastTracks() map[string][]string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string][]string)
	for _, mt := range r.MediaTracks {
		if mt.IsSimulcast {
			mt.mu.RLock()
			rids := make([]string, 0, len(mt.Layers))
			for rid := range mt.Layers {
				rids = append(rids, rid)
			}
			mt.mu.RUnlock()
			result[mt.ID] = rids
		}
	}
	return result
}

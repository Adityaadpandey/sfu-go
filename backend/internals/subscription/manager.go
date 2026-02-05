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

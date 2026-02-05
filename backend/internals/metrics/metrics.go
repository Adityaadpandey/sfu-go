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

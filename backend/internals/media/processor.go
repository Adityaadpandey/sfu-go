package media

import (
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"go.uber.org/zap"
)

type ProcessorConfig struct {
	MaxBitrate   int
	KeyFrameRate time.Duration
	EnableNACK   bool
	EnablePLI    bool
	EnableFIR    bool
}

type MediaProcessor struct {
	config *ProcessorConfig
	logger *zap.Logger

	// Statistics
	stats   *MediaStats
	statsMu sync.RWMutex
}

type MediaStats struct {
	PacketsReceived uint64
	PacketsSent     uint64
	BytesReceived   uint64
	BytesSent       uint64
	PacketsLost     uint64
	Jitter          float64
	RTT             time.Duration
	LastUpdated     time.Time
}

func NewMediaProcessor(config *ProcessorConfig, logger *zap.Logger) *MediaProcessor {
	return &MediaProcessor{
		config: config,
		logger: logger,
		stats: &MediaStats{
			LastUpdated: time.Now(),
		},
	}
}

func (mp *MediaProcessor) ProcessRTPPacket(packet *rtp.Packet) (*rtp.Packet, error) {
	mp.statsMu.Lock()
	mp.stats.PacketsReceived++
	mp.stats.BytesReceived += uint64(len(packet.Payload))
	mp.stats.LastUpdated = time.Now()
	mp.statsMu.Unlock()

	// Apply bitrate control if needed
	if mp.config.MaxBitrate > 0 {
		// Implement bitrate control logic here
		// This is a simplified version
	}

	return packet, nil
}

func (mp *MediaProcessor) ProcessRTCPPacket(packet rtcp.Packet) ([]rtcp.Packet, error) {
	switch p := packet.(type) {
	case *rtcp.ReceiverReport:
		mp.handleReceiverReport(p)
	case *rtcp.SenderReport:
		mp.handleSenderReport(p)
	case *rtcp.PictureLossIndication:
		mp.handlePLI(p)
	case *rtcp.FullIntraRequest:
		mp.handleFIR(p)
	}

	return []rtcp.Packet{packet}, nil
}

func (mp *MediaProcessor) handleReceiverReport(rr *rtcp.ReceiverReport) {
	mp.statsMu.Lock()
	defer mp.statsMu.Unlock()

	for _, report := range rr.Reports {
		mp.stats.PacketsLost += uint64(report.TotalLost)
		mp.stats.Jitter = float64(report.Jitter)
	}
}

func (mp *MediaProcessor) handleSenderReport(sr *rtcp.SenderReport) {
	// Handle sender report for RTT calculation
	mp.statsMu.Lock()
	defer mp.statsMu.Unlock()

	// Calculate RTT if we have the necessary information
	// This is a simplified implementation
}

func (mp *MediaProcessor) handlePLI(pli *rtcp.PictureLossIndication) {
	mp.logger.Debug("Received PLI request",
		zap.Uint32("ssrc", pli.MediaSSRC),
	)
	// Forward PLI to appropriate sender
}

func (mp *MediaProcessor) handleFIR(fir *rtcp.FullIntraRequest) {
	mp.logger.Debug("Received FIR request",
		zap.Uint32("ssrc", fir.MediaSSRC),
	)
	// Forward FIR to appropriate sender
}

func (mp *MediaProcessor) GetStats() *MediaStats {
	mp.statsMu.RLock()
	defer mp.statsMu.RUnlock()

	// Return a copy of stats
	return &MediaStats{
		PacketsReceived: mp.stats.PacketsReceived,
		PacketsSent:     mp.stats.PacketsSent,
		BytesReceived:   mp.stats.BytesReceived,
		BytesSent:       mp.stats.BytesSent,
		PacketsLost:     mp.stats.PacketsLost,
		Jitter:          mp.stats.Jitter,
		RTT:             mp.stats.RTT,
		LastUpdated:     mp.stats.LastUpdated,
	}
}

func (mp *MediaProcessor) RequestKeyFrame(ssrc uint32) error {
	// Send PLI or FIR request
	// In a real implementation, you would send a PictureLossIndication through the appropriate channel
	mp.logger.Debug("Requesting key frame", zap.Uint32("ssrc", ssrc))

	return nil
}

// Adaptive bitrate control
func (mp *MediaProcessor) AdaptBitrate(targetBitrate int) {
	mp.config.MaxBitrate = targetBitrate
	mp.logger.Debug("Adapted bitrate", zap.Int("bitrate", targetBitrate))
}

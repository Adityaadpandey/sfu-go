package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Server  ServerConfig  `yaml:"server"`
	WebRTC  WebRTCConfig  `yaml:"webrtc"`
	Redis   RedisConfig   `yaml:"redis"`
	Metrics MetricsConfig `yaml:"metrics"`
	Logging LoggingConfig `yaml:"logging"`
	Media   MediaConfig   `yaml:"media"`
}

type ServerConfig struct {
	Host            string        `yaml:"host"`
	Port            int           `yaml:"port"`
	ReadTimeout     time.Duration `yaml:"read_timeout"`
	WriteTimeout    time.Duration `yaml:"write_timeout"`
	MaxRooms        int           `yaml:"max_rooms"`
	MaxPeersPerRoom int           `yaml:"max_peers_per_room"`
	AllowedOrigins  []string      `yaml:"allowed_origins"`
	ShutdownTimeout time.Duration `yaml:"shutdown_timeout"`
}

type WebRTCConfig struct {
	ICEServers   []ICEServer `yaml:"ice_servers"`
	UDPPortRange PortRange   `yaml:"udp_port_range"`
	TCPPortRange PortRange   `yaml:"tcp_port_range"`
	PublicIP     string      `yaml:"public_ip"`
}

type ICEServer struct {
	URLs       []string `yaml:"urls"`
	Username   string   `yaml:"username,omitempty"`
	Credential string   `yaml:"credential,omitempty"`
}

type PortRange struct {
	Min uint16 `yaml:"min"`
	Max uint16 `yaml:"max"`
}

type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

type MetricsConfig struct {
	Enabled bool   `yaml:"enabled"`
	Port    int    `yaml:"port"`
	Path    string `yaml:"path"`
}

type LoggingConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

type MediaConfig struct {
	MaxVideoBitrate      int           `yaml:"max_video_bitrate"`
	MaxAudioBitrate      int           `yaml:"max_audio_bitrate"`
	MaxRTPErrors         int           `yaml:"max_rtp_errors"`
	RenegotiationDelay   time.Duration `yaml:"renegotiation_delay"`
	AllowedVideoCodecs   []string      `yaml:"allowed_video_codecs"`
	AllowedAudioCodecs   []string      `yaml:"allowed_audio_codecs"`
	WSReadLimit          int64         `yaml:"ws_read_limit"`
	WSWriteTimeout       time.Duration `yaml:"ws_write_timeout"`
	WSPongTimeout        time.Duration `yaml:"ws_pong_timeout"`
	WSPingInterval       time.Duration `yaml:"ws_ping_interval"`
	WSHubPingInterval    time.Duration `yaml:"ws_hub_ping_interval"`
	RateLimitPerSec      float64       `yaml:"rate_limit_per_sec"`
	RateLimitBurst       int           `yaml:"rate_limit_burst"`
	MaxRoomIDLength      int           `yaml:"max_room_id_length"`
	MaxUserIDLength      int           `yaml:"max_user_id_length"`

	// Simulcast
	SimulcastEnabled bool `yaml:"simulcast_enabled"`

	// Dominant speaker detection
	SpeakerDetectionInterval time.Duration `yaml:"speaker_detection_interval"`

	// Stats
	StatsInterval time.Duration `yaml:"stats_interval"`

	// Session management
	SessionTTL    time.Duration `yaml:"session_ttl"`
	AutoSubscribe bool          `yaml:"auto_subscribe"`
}

func LoadConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Host:            getEnv("SFU_HOST", "0.0.0.0"),
			Port:            getEnvInt("SFU_PORT", 8080),
			ReadTimeout:     time.Duration(getEnvInt("SFU_READ_TIMEOUT", 30)) * time.Second,
			WriteTimeout:    time.Duration(getEnvInt("SFU_WRITE_TIMEOUT", 30)) * time.Second,
			MaxRooms:        getEnvInt("SFU_MAX_ROOMS", 1000),
			MaxPeersPerRoom: getEnvInt("SFU_MAX_PEERS_PER_ROOM", 100),
			AllowedOrigins:  []string{"*"},
			ShutdownTimeout: time.Duration(getEnvInt("SFU_SHUTDOWN_TIMEOUT", 10)) * time.Second,
		},
		WebRTC: WebRTCConfig{
			ICEServers: []ICEServer{
				{URLs: []string{"stun:stun.l.google.com:19302"}},
			},
			UDPPortRange: PortRange{Min: 10000, Max: 20000},
			TCPPortRange: PortRange{Min: 20001, Max: 30000},
			PublicIP:     getEnv("SFU_PUBLIC_IP", ""),
		},
		Redis: RedisConfig{
			Addr:     getEnv("REDIS_ADDR", "localhost:6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvInt("REDIS_DB", 0),
		},
		Metrics: MetricsConfig{
			Enabled: getEnvBool("METRICS_ENABLED", true),
			Port:    getEnvInt("METRICS_PORT", 9090),
			Path:    getEnv("METRICS_PATH", "/metrics"),
		},
		Logging: LoggingConfig{
			Level:  getEnv("LOG_LEVEL", "info"),
			Format: getEnv("LOG_FORMAT", "json"),
		},
		Media: MediaConfig{
			MaxVideoBitrate:    getEnvInt("SFU_MAX_VIDEO_BITRATE", 2000000),
			MaxAudioBitrate:    getEnvInt("SFU_MAX_AUDIO_BITRATE", 128000),
			MaxRTPErrors:       getEnvInt("SFU_MAX_RTP_ERRORS", 50),
			RenegotiationDelay: time.Duration(getEnvInt("SFU_RENEGOTIATION_DELAY_MS", 150)) * time.Millisecond,
			AllowedVideoCodecs: []string{"video/VP8", "video/VP9", "video/H264"},
			AllowedAudioCodecs: []string{"audio/opus"},
			WSReadLimit:        int64(getEnvInt("SFU_WS_READ_LIMIT", 524288)),
			WSWriteTimeout:     time.Duration(getEnvInt("SFU_WS_WRITE_TIMEOUT", 10)) * time.Second,
			WSPongTimeout:      time.Duration(getEnvInt("SFU_WS_PONG_TIMEOUT", 60)) * time.Second,
			WSPingInterval:     time.Duration(getEnvInt("SFU_WS_PING_INTERVAL", 54)) * time.Second,
			WSHubPingInterval:  time.Duration(getEnvInt("SFU_WS_HUB_PING_INTERVAL", 30)) * time.Second,
			RateLimitPerSec:    float64(getEnvInt("SFU_RATE_LIMIT_PER_SEC", 20)),
			RateLimitBurst:     getEnvInt("SFU_RATE_LIMIT_BURST", 40),
			MaxRoomIDLength:          getEnvInt("SFU_MAX_ROOM_ID_LENGTH", 128),
			MaxUserIDLength:          getEnvInt("SFU_MAX_USER_ID_LENGTH", 128),
			SimulcastEnabled:         getEnvBool("SFU_SIMULCAST_ENABLED", false),
			SpeakerDetectionInterval: time.Duration(getEnvInt("SFU_SPEAKER_DETECTION_INTERVAL_MS", 200)) * time.Millisecond,
			StatsInterval:            time.Duration(getEnvInt("SFU_STATS_INTERVAL_MS", 3000)) * time.Millisecond,
			SessionTTL:               time.Duration(getEnvInt("SFU_SESSION_TTL_SEC", 120)) * time.Second, // 2 minutes for reconnection
			AutoSubscribe:            getEnvBool("SFU_AUTO_SUBSCRIBE", true),
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

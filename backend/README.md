# SFU-Go: Scalable Video Conferencing Server

A high-performance Selective Forwarding Unit (SFU) implementation in Go, designed for scalable video conferencing applications similar to Google Meet.

## Features

### Core SFU Capabilities
- **Selective Forwarding Unit**: Efficiently forwards media streams between peers without transcoding
- **Multi-peer Support**: Handle up to 100 peers per room (configurable)
- **Real-time Communication**: WebRTC-based peer connections with low latency
- **Screen Sharing**: Built-in support for screen sharing alongside video calls
- **Audio/Video Management**: Independent control of audio and video streams

### Scalability & Performance
- **Horizontal Scaling**: Redis-based state management for multi-instance deployment
- **Resource Optimization**: Minimal CPU usage through selective forwarding
- **Adaptive Bitrate**: Dynamic bitrate adjustment based on network conditions
- **Connection Pooling**: Efficient WebSocket connection management
- **Metrics & Monitoring**: Prometheus metrics for performance tracking

### Production Ready
- **Graceful Shutdown**: Proper cleanup of resources and connections
- **Health Checks**: Built-in health monitoring endpoints
- **Configurable Limits**: Room limits, peer limits, and resource constraints
- **Logging**: Structured logging with configurable levels
- **Error Handling**: Comprehensive error handling and recovery

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client A      │    │   Client B      │    │   Client C      │
│                 │    │                 │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │ WebSocket + WebRTC   │                      │
          │                      │                      │
    ┌─────▼──────────────────────▼──────────────────────▼─────┐
    │                SFU Server                              │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
    │  │   Room      │  │ Signaling   │  │   Media     │    │
    │  │ Management  │  │    Hub      │  │ Processor   │    │
    │  └─────────────┘  └─────────────┘  └─────────────┘    │
    └────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │      Redis        │
                    │  (State Storage)  │
                    └───────────────────┘
```

## Quick Start

### Prerequisites
- Go 1.21 or later
- Redis (optional, for scaling)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/adityaadpandey/sfu-go.git
cd sfu-go
```

2. Install dependencies:
```bash
go mod tidy
```

3. Run the server:
```bash
go run cmd/sfu/main.go
```

The server will start on `http://localhost:8080`

### Testing with the Web Client

1. Open `examples/client/index.html` in multiple browser tabs
2. Enter the same room ID in each tab
3. Click "Join Room" to start the video call
4. Test screen sharing and audio/video controls

## Configuration

The server can be configured via environment variables:

```bash
# Server Configuration
export SFU_HOST=0.0.0.0
export SFU_PORT=8080
export SFU_MAX_ROOMS=1000
export SFU_MAX_PEERS_PER_ROOM=100

# WebRTC Configuration
export SFU_PUBLIC_IP=your-public-ip

# Redis Configuration (optional)
export REDIS_ADDR=localhost:6379
export REDIS_PASSWORD=
export REDIS_DB=0

# Logging
export LOG_LEVEL=info
export LOG_FORMAT=json

# Metrics
export METRICS_ENABLED=true
export METRICS_PORT=9090
```

## API Endpoints

### WebSocket Signaling
- `GET /ws?userId=<id>&name=<name>` - WebSocket connection for signaling

### REST API
- `GET /api/rooms` - List all active rooms
- `POST /api/rooms` - Create a new room
- `GET /api/rooms/{id}` - Get room information
- `DELETE /api/rooms/{id}` - Delete a room
- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus metrics (if enabled)

## Signaling Protocol

The WebSocket signaling uses JSON messages:

### Join Room
```json
{
  "type": "join",
  "data": "{\"roomId\":\"room-123\",\"userId\":\"user-456\",\"name\":\"John Doe\"}",
  "timestamp": "2024-01-07T10:00:00Z"
}
```

### WebRTC Offer/Answer
```json
{
  "type": "offer",
  "data": "{\"sdp\":\"...\",\"type\":\"offer\",\"peerId\":\"peer-123\"}",
  "timestamp": "2024-01-07T10:00:00Z"
}
```

### ICE Candidates
```json
{
  "type": "ice-candidate",
  "data": "{\"candidate\":\"...\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0,\"peerId\":\"peer-123\"}",
  "timestamp": "2024-01-07T10:00:00Z"
}
```

## Scaling for Production

### Multi-Instance Deployment
1. Deploy multiple SFU instances behind a load balancer
2. Configure Redis for shared state management
3. Use sticky sessions or consistent hashing for WebSocket connections

### Performance Tuning
- Adjust `MaxPeersPerRoom` based on server capacity
- Configure appropriate UDP/TCP port ranges
- Monitor metrics and adjust resource limits
- Use dedicated TURN servers for NAT traversal

### Security Considerations
- Implement proper origin checking for WebSocket connections
- Use HTTPS/WSS in production
- Add authentication and authorization
- Configure TURN servers with credentials
- Implement rate limiting

## Monitoring

The server exposes Prometheus metrics at `/metrics`:

- `sfu_active_rooms_total` - Number of active rooms
- `sfu_active_peers_total` - Number of connected peers
- `sfu_connections_total` - Total connection count
- `sfu_messages_sent_total` - Messages sent counter
- `sfu_messages_received_total` - Messages received counter
- `sfu_bytes_transferred_total` - Total bytes transferred

## Development

### Project Structure
```
sfu-go/
├── cmd/sfu/main.go              # Application entry point
├── internals/
│   ├── sfu/                     # Core SFU implementation
│   ├── signaling/               # WebSocket signaling server
│   ├── room/                    # Room management
│   ├── peer/                    # Peer connection handling
│   ├── media/                   # Media processing utilities
│   ├── config/                  # Configuration management
│   └── utils/                   # Shared utilities
├── examples/
│   └── client/                  # Web client example
└── README.md
```

### Running Tests
```bash
go test ./...
```

### Building for Production
```bash
go build -o sfu-server cmd/sfu/main.go
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [Pion WebRTC](https://github.com/pion/webrtc) - Go implementation of WebRTC
- Inspired by modern video conferencing solutions like Google Meet and Zoom
- Uses [Gorilla WebSocket](https://github.com/gorilla/websocket) for signaling
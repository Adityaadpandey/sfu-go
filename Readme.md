# SFU

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)

A real SFU (Selective Forwarding Unit) implementation with a **Go backend** (WebRTC SFU + WebSocket signaling) and a **Next.js (TypeScript/React) frontend**. The system is designed for multi-peer rooms, media forwarding, simulcast layer selection, and operational visibility (Redis-backed state, Prometheus metrics, Grafana dashboards).

---

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Backend (Go) via Docker Compose](#backend-go-via-docker-compose)
  - [Frontend (Next.js)](#frontend-nextjs)
- [Usage](#usage)
  - [Service URLs](#service-urls)
  - [Signaling Protocol (WebSocket)](#signaling-protocol-websocket)
- [Project Structure](#project-structure)
- [Development](#development)
  - [Frontend scripts](#frontend-scripts)
  - [Backend observability (Prometheus/Grafana)](#backend-observability-prometheusgrafana)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Description

This repository contains:

- **Backend (Go)**: a WebRTC SFU built on `pion/webrtc`, with **WebSocket signaling** (Gorilla WebSocket), room/peer management, rate limiting, logging, and metrics.
- **Frontend (Next.js + React + TypeScript)**: the UI/client that joins rooms and exchanges signaling messages with the backend to establish WebRTC connections.

The backend exposes:

- a **WebSocket signaling server** (message types include `join`, `offer`, `answer`, `ice-candidate`, `room-state`, `peer-joined`, `peer-left`, `dominant-speaker`, `quality-stats`, `layer-switch`, `layer-available`, etc.)
- an HTTP **health endpoint** (`/health`) used by Docker healthchecks
- an optional **metrics endpoint** (Prometheus) on a separate port

---

## Features

### Core 🚀

- **SFU architecture**: forwards media streams between peers instead of mesh routing.
- **Room + peer lifecycle**: join/leave, room state broadcasts, peer tracking.
- **WebSocket signaling**: structured message types for negotiation and state updates.

### Media / WebRTC

- **Simulcast awareness**: supports layer availability and layer switching messages (`layer-available`, `layer-switch`).
- **Renegotiation support**: server can request renegotiation (`renegotiate`).
- **Dominant speaker tracking**: emits `dominant-speaker` events.
- **Connection quality stats**: emits `quality-stats` events.

### Operations

- **Redis integration**: backend can use Redis (`REDIS_ADDR`) for state/caching.
- **Structured logging**: Zap logger with `LOG_LEVEL` and `LOG_FORMAT`.
- **Metrics**: Prometheus + Grafana included in `docker-compose.yml`.

---

## Quick Start

This starts the **backend + Redis + Prometheus + Grafana** via Docker Compose, then runs the **frontend** locally.

```bash
# 1) Start backend stack (Go SFU + Redis + Prometheus + Grafana)
cd backend
docker compose up --build
```

In a second terminal:

```bash
# 2) Start frontend (Next.js)
cd frontend
npm run dev
```

---

## Prerequisites

### Required

- **Node.js** (for the frontend)
- **npm**
- **Docker** + **Docker Compose** (for the backend stack)

### Notes

- WebRTC requires access to UDP ports for media. If you run the backend in Docker on a remote host, ensure firewall/NAT rules allow WebRTC traffic and that your backend is configured with the correct public IP (see backend config).

---

## Installation

### Backend (Go) via Docker Compose

The backend stack is defined in `backend/docker-compose.yml` and includes:

- `sfu-server` (Go SFU + signaling)
- `redis`
- `prometheus`
- `grafana`

Start everything:

```bash
cd backend
docker compose up --build
```

Stop everything:

```bash
cd backend
docker compose down
```

#### Backend environment variables

These are set in `backend/docker-compose.yml` for the `sfu-server` service:

| Variable                 | Default (compose) | Purpose                                          |
| ------------------------ | ----------------: | ------------------------------------------------ |
| `SFU_HOST`               |         `0.0.0.0` | Bind address for the SFU HTTP/signaling server   |
| `SFU_PORT`               |            `8080` | Port for the SFU HTTP/signaling server           |
| `SFU_MAX_ROOMS`          |            `1000` | Maximum number of rooms                          |
| `SFU_MAX_PEERS_PER_ROOM` |             `100` | Maximum peers allowed per room                   |
| `REDIS_ADDR`             |      `redis:6379` | Redis address reachable from the SFU container   |
| `LOG_LEVEL`              |            `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `LOG_FORMAT`             |            `json` | Logging format (`json` or non-JSON dev output)   |
| `METRICS_ENABLED`        |            `true` | Enables Prometheus metrics                       |
| `METRICS_PORT`           |            `9090` | Port where metrics are served                    |

---

### Frontend (Next.js)

Install dependencies:

```bash
cd frontend
npm install
```

Run in dev mode:

```bash
cd frontend
npm run dev
```

Build for production:

```bash
cd frontend
npm run build
```

Run production server:

```bash
cd frontend
npm run start
```

#### Frontend environment variables

No frontend environment variables were detected from the provided project metadata. If your UI needs to know the backend WebSocket/HTTP base URL, configure it in code or add Next.js environment variables (for example via `.env.local`) and ensure they’re read using `process.env.NEXT_PUBLIC_*`.

---

## Usage

### Service URLs

With the backend stack running via Docker Compose:

| Service           | URL                     | Notes                                                                    |
| ----------------- | ----------------------- | ------------------------------------------------------------------------ |
| SFU server (HTTP) | `http://localhost:8080` | Includes `/health`                                                       |
| SFU metrics       | `http://localhost:9090` | Exposed by `sfu-server` container                                        |
| Prometheus        | `http://localhost:9091` | Prometheus container port 9090 mapped to host 9091                       |
| Grafana           | `http://localhost:3000` | Default admin password is `admin` (set via `GF_SECURITY_ADMIN_PASSWORD`) |

Health check endpoint (used by the Dockerfile healthcheck):

```bash
curl -fsS http://localhost:8080/health
```

---

### Signaling Protocol (WebSocket)

The backend signaling layer (`backend/internals/signaling/websocket.go`) defines a typed message envelope:

- `type`: message type string (examples below)
- `data`: message payload (type-specific)
- `timestamp`: server/client timestamp
- `from` / `to`: optional routing fields

#### Message types

The backend defines (non-exhaustive list):

- `join`, `leave`
- `offer`, `answer`, `ice-candidate`
- `peer-joined`, `peer-left`, `room-state`
- `renegotiate`
- `dominant-speaker`
- `quality-stats`
- `layer-available`, `layer-switch`
- `ping`, `pong`
- `error`

#### Frontend TypeScript message union

The frontend models signaling messages in `frontend/types/index.ts` as `SignalingMessage`, including:

- `join` with `{ roomId, userId, name }`
- SDP exchange: `offer` / `answer`
- ICE: `ice-candidate`
- room and peer events: `peer-joined`, `peer-left`, `room-state`
- operational events: `dominant-speaker`, `quality-stats`
- SFU controls: `renegotiate`, `layer-switch`, `layer-available`

This is the canonical shape your UI code should send/receive.

#### Example: join a room (raw WebSocket)

If you want to sanity-check your signaling server from a scriptable client, here’s a minimal Node WebSocket example that sends a `join` message and prints everything received.

> This requires Node 18+ and installs `ws` locally.

```bash
mkdir -p /tmp/sfu-ws-check && cd /tmp/sfu-ws-check
npm init -y
npm install ws
```

Create `check.mjs`:

```js
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:8080/ws');

ws.on('open', () => {
  const msg = {
    type: 'join',
    data: { roomId: 'demo', userId: 'user-1', name: 'User 1' },
    timestamp: new Date().toISOString(),
  };
  ws.send(JSON.stringify(msg));
});

ws.on('message', (data) => {
  console.log('recv:', data.toString());
});

ws.on('close', () => console.log('closed'));
ws.on('error', (err) => console.error('error:', err));
```

Run it:

```bash
node check.mjs
```

If your backend uses a different WS path than `/ws`, adjust the URL to match the server’s routing.

---

## Project Structure

High-level layout (based on the provided files):

```text
.
├── backend
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── internals
│   │   ├── config
│   │   │   └── config.go          # server/webrtc/redis/metrics/logging/media config structs
│   │   ├── peer
│   │   │   └── peer.go            # Peer lifecycle, tracks, callbacks, pion/webrtc integration
│   │   ├── room
│   │   │   └── room.go            # Room lifecycle, track forwarding, simulcast & quality hooks
│   │   ├── signaling
│   │   │   └── websocket.go       # Gorilla WS signaling protocol + message types
│   │   └── utils
│   │       └── logger.go          # zap logger initialization
│   └── cmd
│       └── sfu
│           └── main.go            # SFU server entrypoint (built as `sfu-server`)
└── frontend
    ├── next.config.ts
    ├── package.json
    └── types
        └── index.ts               # Shared TS types (Peer, TrackInfo, SignalingMessage, etc.)
```

---

## Development

### Frontend scripts

From `frontend/package.json`:

| Command         | Description                     |
| --------------- | ------------------------------- |
| `npm run dev`   | Start Next.js dev server        |
| `npm run build` | Build production bundle         |
| `npm run start` | Start production Next.js server |
| `npm run lint`  | Run ESLint                      |

### Backend observability (Prometheus/Grafana)

The compose stack includes Prometheus and Grafana:

- Prometheus is exposed on `http://localhost:9091`
- Grafana is exposed on `http://localhost:3000` (admin password: `admin`)

If `METRICS_ENABLED=true`, the SFU exposes metrics on port `9090` (container and host mapping in compose). Prometheus is configured via:

- `backend/monitoring/prometheus.yml` (mounted into the Prometheus container)

Grafana provisioning mounts:

- `backend/monitoring/grafana/dashboards`
- `backend/monitoring/grafana/datasources`

---

## Troubleshooting

### 1) Frontend starts but can’t connect to signaling

- Confirm backend is running and healthy:

```bash
curl -fsS http://localhost:8080/health
```

- If your frontend uses a WebSocket URL, ensure it matches the backend host/port and path. From the compose file, the SFU binds on `8080`.

### 2) WebRTC connects locally but fails across networks

Common causes:

- NAT/firewall blocking UDP media ports.
- Backend not advertising the correct public IP.

If your backend supports a “public IP” WebRTC setting (see `backend/internals/config/config.go` → `WebRTCConfig.PublicIP`), ensure it’s set appropriately for remote clients.

### 3) Docker healthcheck failing for `sfu-server`

The backend Dockerfile healthcheck calls:

```bash
wget --no-verbose --tries=1 --spider http://localhost:8080/health
```

If the container is unhealthy:

- verify the server actually serves `/health` on `8080`
- check logs:

```bash
cd backend
docker compose logs -f sfu-server
```

### 4) Grafana login

Grafana is configured with:

- user: `admin`
- password: `admin`

(from `GF_SECURITY_ADMIN_PASSWORD=admin` in compose)

### 5) Redis connectivity

The SFU container uses:

- `REDIS_ADDR=redis:6379`

If you run the SFU outside compose, `redis:6379` won’t resolve. Use `localhost:6379` (or your Redis host) in that scenario.

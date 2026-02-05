# SFU

[![version](https://img.shields.io/badge/version-0.1.0-blue.svg)](./frontend/package.json)
[![license](https://img.shields.io/badge/license-UNLICENSED-lightgrey.svg)](#license)

Production-ready SFU (Selective Forwarding Unit) service with a Next.js (React + TypeScript) web UI, a Go SFU backend, Redis for coordination/state, and first-class monitoring via Prometheus + Grafana—fronted by NGINX.

---

## Table of Contents

- [Description](#description)
- [Features](#features)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Docker](#docker)
- [Database (Redis)](#database-redis)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Description

This repository runs a complete WebRTC SFU stack:

- **Frontend (`./frontend`)**: Next.js app (React 19, TypeScript) that connects to the SFU via **WebSocket signaling** (configured with `NEXT_PUBLIC_WS_URL`).
- **Backend (`./backend`)**: Go SFU server built on **Pion WebRTC**, responsible for room/peer management and RTP forwarding.
- **Redis**: Used by the backend for shared state/caching.
- **NGINX**: Reverse proxy that exposes a single HTTP entrypoint on port **80** and routes traffic to the web UI and backend.
- **Prometheus + Grafana**: Metrics scraping and dashboards for operational visibility.

The default Docker Compose setup brings up **6 services**: `sfu-server`, `redis`, `prometheus`, `grafana`, `web`, `nginx`.

---

## Features

- **Authentication**: Frontend includes auth-oriented UI patterns and types; backend supports identity fields (`userId`, `name`) in signaling messages.
- **WebSocket signaling**: Join rooms, exchange SDP offers/answers, ICE candidates, and room state.
- **Caching / state**: Redis integration (`REDIS_ADDR`) for backend coordination.
- **Rate limiting**: Backend config includes rate limit controls (per-second + burst).
- **Logging**: Structured logging via `zap` with selectable level/format.
- **Monitoring**: Prometheus metrics endpoint and Grafana dashboards provisioned via Docker volumes.

---

## Quick Start

Bring up the entire stack (SFU backend + web UI + Redis + monitoring + NGINX):

```bash
docker compose up --build
```

Then open:

- **Web app (via NGINX)**: http://localhost/
- **Grafana**: http://localhost:3001 (admin password is `admin`)
- **Prometheus**: http://localhost:9091
- **SFU server (direct)**: http://localhost:8080/health

Stop everything:

```bash
docker compose down
```

---

## Prerequisites

### For Docker-based setup (recommended)
- Docker Engine + Docker Compose v2

### For local frontend development
- Node.js **22+**
- npm (ships with Node)

### For local backend development (optional)
- Go **1.21+**

---

## Installation

### 1) Docker (full stack)

No separate install step is required beyond Docker. Build and start:

```bash
docker compose up --build
```

### 2) Frontend (local dev, without Docker)

From the `frontend/` directory:

```bash
cd frontend
npm ci
```

---

## Usage

## Web UI

When running via Docker Compose + NGINX, the UI is served at:

- http://localhost/

The frontend uses a public environment variable to know where to open the signaling WebSocket:

- `NEXT_PUBLIC_WS_URL`

In Docker Compose, it is set to:

- `ws://localhost/ws`

NGINX is expected to route `/ws` to the backend’s WebSocket endpoint.

---

## API Endpoints

The repository exposes these HTTP endpoints directly from the backend container:

| Service | Endpoint | Purpose |
|---|---|---|
| SFU Backend | `GET http://localhost:8080/health` | Health check (used by Docker `HEALTHCHECK`) |
| Prometheus | `GET http://localhost:9091/` | Prometheus UI (container port 9090 mapped to 9091) |
| Grafana | `GET http://localhost:3001/` | Grafana UI |

> Note: WebSocket signaling is routed via NGINX at `ws://localhost/ws` (as configured by the frontend). The exact backend WS path is defined by the backend router and NGINX config.

---

## Docker

### Services

Docker Compose defines:

- `sfu-server` (Go backend): exposes **8080** (HTTP) and **9090** (metrics)
- `redis`: exposes **6379**
- `prometheus`: exposes **9091** (mapped from container 9090)
- `grafana`: exposes **3001** (mapped from container 3000)
- `web` (Next.js standalone runtime): internal service on port **3000**
- `nginx`: exposes **80** (single entrypoint)

Start:

```bash
docker compose up --build
```

Rebuild a single service:

```bash
docker compose build web
```

View logs:

```bash
docker compose logs -f nginx
```

Stop + remove containers (keep volumes):

```bash
docker compose down
```

Stop + remove containers **and volumes** (this deletes Redis/Prometheus/Grafana data):

```bash
docker compose down -v
```

---

## Database (Redis)

Redis is started as part of Docker Compose:

- Host (from within the Compose network): `redis:6379`
- Host (from your machine): `localhost:6379`

The backend is configured via:

- `REDIS_ADDR=redis:6379`

Persisted data is stored in the Docker volume:

- `redis_data`

---

## Environment Variables

### Frontend (`web` service)

| Variable | Required | Example | Description |
|---|---:|---|---|
| `NEXT_PUBLIC_WS_URL` | Yes | `ws://localhost/ws` | Public WebSocket URL used by the browser for signaling |

### Backend (`sfu-server` service)

| Variable | Required | Example | Description |
|---|---:|---|---|
| `SFU_HOST` | Yes | `0.0.0.0` | Bind address for the SFU HTTP server |
| `SFU_PORT` | Yes | `8080` | HTTP port for SFU APIs and signaling |
| `SFU_MAX_ROOMS` | Yes | `1000` | Maximum number of rooms allowed |
| `SFU_MAX_PEERS_PER_ROOM` | Yes | `100` | Maximum peers per room |
| `REDIS_ADDR` | Yes | `redis:6379` | Redis address used by the backend |
| `LOG_LEVEL` | Yes | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `LOG_FORMAT` | Yes | `json` | Log format (`json` for production, otherwise dev-style) |
| `METRICS_ENABLED` | Yes | `true` | Enables Prometheus metrics endpoint |
| `METRICS_PORT` | Yes | `9090` | Port for metrics endpoint |

---

## Project Structure

Top-level layout (as used by Docker Compose):

```text
.
├── backend/
│   ├── Dockerfile
│   ├── cmd/
│   │   └── sfu/
│   │       └── main.go
│   ├── internals/
│   │   ├── config/
│   │   │   └── config.go
│   │   ├── peer/
│   │   │   └── peer.go
│   │   ├── room/
│   │   │   └── room.go
│   │   └── utils/
│   │       └── logger.go
│   └── monitoring/
│       ├── prometheus.yml
│       ├── prometheus-alerts.yml
│       └── grafana/
│           ├── dashboards/
│           └── datasources/
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts
│   └── types/
│       └── index.ts
├── nginx/
│   └── nginx.conf
└── docker-compose.yml
```

Key implementation notes:

- `backend/internals/utils/logger.go`: zap logger initialization with `LOG_LEVEL` and `LOG_FORMAT`.
- `backend/internals/peer/peer.go`: Peer lifecycle, track bookkeeping, ICE candidate queuing, and callbacks.
- `backend/internals/room/room.go`: Room/track fan-out; uses an RTP packet pool to reduce GC pressure.
- `frontend/types/index.ts`: Shared client-side types for peers, tracks, connection quality, and signaling messages.

---

## Development

### Frontend

Run the Next.js dev server:

```bash
cd frontend
npm run dev
```

Build:

```bash
cd frontend
npm run build
```

Run production server (requires a build output):

```bash
cd frontend
npm run start
```

Lint:

```bash
cd frontend
npm run lint
```

### Backend (Docker-first workflow)

The backend is built and run via Docker Compose:

```bash
docker compose up --build sfu-server
```

If you need to restart only the backend:

```bash
docker compose restart sfu-server
```

---

## Troubleshooting

### 1) The web UI loads but signaling fails (WebSocket errors)

Symptoms:
- Browser console shows WebSocket connection failures to `ws://localhost/ws`.

Checks:
1. Ensure the stack is up:
   ```bash
   docker compose ps
   ```
2. Verify NGINX is running and listening on port 80:
   ```bash
   curl -i http://localhost/
   ```
3. Tail NGINX logs:
   ```bash
   docker compose logs -f nginx
   ```
4. Tail backend logs:
   ```bash
   docker compose logs -f sfu-server
   ```

### 2) Backend container is unhealthy

The backend image defines a health check against:

- `http://localhost:8080/health`

Inspect health status:

```bash
docker inspect --format='{{json .State.Health}}' sfu-server
```

### 3) Prometheus or Grafana not showing data

- Prometheus config is mounted from:
  - `./backend/monitoring/prometheus.yml`
- Grafana provisioning is mounted from:
  - `./backend/monitoring/grafana/dashboards`
  - `./backend/monitoring/grafana/datasources`

Restart monitoring after config changes:

```bash
docker compose restart prometheus grafana
```

### 4) Ports already in use

This stack binds the following host ports: `80`, `8080`, `9090`, `9091`, `3001`, `6379`.

Find what’s using a port (example: 80):

```bash
lsof -i :80
```

Then stop the conflicting process or change the port mappings in `docker-compose.yml`.

---

## Contributing

1. Create a feature branch.
2. Keep changes focused (one concern per PR).
3. For frontend changes, ensure lint passes:
   ```bash
   cd frontend
   npm run lint
   ```
4. If you change Docker, verify:
   ```bash
   docker compose up --build
   ```

---

## License

No license file is present in the repository, and the package is marked `private`. As a result, this project is treated as **UNLICENSED** by default. If you intend others to use/modify/distribute it, add a license file at the repository root (for example, `LICENSE`).

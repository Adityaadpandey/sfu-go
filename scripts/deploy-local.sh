#!/bin/bash

# SFU Local Deployment Script
# This script sets up the complete SFU stack locally with monitoring

set -e

echo "🚀 Starting SFU Local Deployment..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

echo -e "${BLUE}📦 Building Docker images...${NC}"
docker-compose build

echo ""
echo -e "${BLUE}🔧 Starting services...${NC}"
docker-compose up -d

echo ""
echo -e "${GREEN}✅ Services started successfully!${NC}"
echo ""

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
sleep 10

# Check service health
echo ""
echo -e "${BLUE}🏥 Checking service health...${NC}"

# Check SFU backend
if curl -f -s http://localhost:8080/health > /dev/null; then
    echo -e "${GREEN}✓ SFU Backend is healthy${NC}"
else
    echo -e "${YELLOW}⚠ SFU Backend is starting up...${NC}"
fi

# Check Prometheus
if curl -f -s http://localhost:9091/-/healthy > /dev/null; then
    echo -e "${GREEN}✓ Prometheus is healthy${NC}"
else
    echo -e "${YELLOW}⚠ Prometheus is starting up...${NC}"
fi

# Check Grafana
if curl -f -s http://localhost:3001/api/health > /dev/null; then
    echo -e "${GREEN}✓ Grafana is healthy${NC}"
else
    echo -e "${YELLOW}⚠ Grafana is starting up...${NC}"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 SFU Stack is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📍 Access your services:${NC}"
echo ""
echo -e "  🌐 Frontend:        ${GREEN}http://localhost${NC}"
echo -e "  🔧 SFU Backend:     ${GREEN}http://localhost:8080${NC}"
echo -e "  📊 Grafana:         ${GREEN}http://localhost:3001${NC} (admin/admin)"
echo -e "  📈 Prometheus:      ${GREEN}http://localhost:9091${NC}"
echo -e "  🗄️  Redis:           ${GREEN}localhost:6379${NC}"
echo ""
echo -e "${BLUE}📝 Useful commands:${NC}"
echo ""
echo -e "  View logs:          ${YELLOW}docker-compose logs -f${NC}"
echo -e "  View SFU logs:      ${YELLOW}docker-compose logs -f sfu-server${NC}"
echo -e "  Stop services:      ${YELLOW}docker-compose down${NC}"
echo -e "  Restart services:   ${YELLOW}docker-compose restart${NC}"
echo -e "  View status:        ${YELLOW}docker-compose ps${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

.PHONY: build run test clean docker-build docker-run deps

# Build the server
build:
	@echo "Building SFU server..."
	@mkdir -p bin
	@go build -o bin/sfu-server cmd/sfu/main.go
	@echo "✅ Build complete: bin/sfu-server"

# Run the server
run:
	@echo "Starting SFU server..."
	@go run cmd/sfu/main.go

# Run tests
test:
	@echo "Running tests..."
	@go test ./...
	@echo "Running integration test..."
	@./scripts/test.sh

# Install dependencies
deps:
	@echo "Installing dependencies..."
	@go mod tidy
	@go mod download

# Clean build artifacts
clean:
	@echo "Cleaning up..."
	@rm -rf bin/
	@go clean

# Build Docker image
docker-build:
	@echo "Building Docker image..."
	@docker build -t sfu-go:latest .

# Run with Docker Compose
docker-run:
	@echo "Starting with Docker Compose..."
	@docker-compose up -d

# Stop Docker Compose
docker-stop:
	@echo "Stopping Docker Compose..."
	@docker-compose down

# View logs
logs:
	@docker-compose logs -f sfu-server

# Development setup
dev-setup: deps
	@echo "Setting up development environment..."
	@mkdir -p bin logs
	@echo "✅ Development environment ready"

# Quick start for development
dev: build run

# Production build
prod-build:
	@echo "Building for production..."
	@mkdir -p bin
	@CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -ldflags '-w -s' -o bin/sfu-server cmd/sfu/main.go
	@echo "✅ Production build complete"

# Help
help:
	@echo "Available commands:"
	@echo "  build       - Build the server binary"
	@echo "  run         - Run the server directly"
	@echo "  test        - Run all tests"
	@echo "  deps        - Install dependencies"
	@echo "  clean       - Clean build artifacts"
	@echo "  docker-build - Build Docker image"
	@echo "  docker-run  - Run with Docker Compose"
	@echo "  docker-stop - Stop Docker Compose"
	@echo "  logs        - View Docker logs"
	@echo "  dev-setup   - Setup development environment"
	@echo "  dev         - Build and run for development"
	@echo "  prod-build  - Build for production"
	@echo "  help        - Show this help message"
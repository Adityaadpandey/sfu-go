package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/adityaadpandey/sfu-go/internals/config"
	"github.com/adityaadpandey/sfu-go/internals/sfu"
	"github.com/adityaadpandey/sfu-go/internals/utils"
	"go.uber.org/zap"
)

func main() {
	// Load configuration
	cfg := config.LoadConfig()

	// Initialize logger
	if err := utils.InitLogger(cfg.Logging.Level, cfg.Logging.Format); err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}

	logger := utils.GetLogger()
	logger.Info("Starting SFU server")

	// Create SFU instance
	sfuServer, err := sfu.NewSFU(cfg)
	if err != nil {
		logger.Fatal("Failed to create SFU server", zap.Error(err))
	}

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start server in goroutine
	go func() {
		if err := sfuServer.Start(); err != nil {
			logger.Fatal("Failed to start SFU server", zap.Error(err))
		}
	}()

	// Wait for shutdown signal
	<-sigChan
	logger.Info("Received shutdown signal")

	// Graceful shutdown
	sfuServer.Stop()
	logger.Info("SFU server stopped")
}

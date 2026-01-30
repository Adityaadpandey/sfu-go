"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { useRoomStore } from "@/store/useRoomStore";
import { QualityIndicator } from "./quality-indicator";
import { LayerSelector } from "./layer-selector";

interface ParticipantTileProps {
  id: string;
  name: string;
  stream: MediaStream | null;
  isLocal?: boolean;
  isSpeaking?: boolean;
}

export function ParticipantTile({ id, name, stream, isLocal, isSpeaking }: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { peerQuality, simulcastLayers, settings } = useRoomStore();
  
  const quality = peerQuality[id];
  const hasVideo = stream?.getVideoTracks().some(track => track.enabled) ?? false;
  
  // Get available layers for this participant's video track
  const videoTrack = stream?.getVideoTracks()[0];
  const trackId = videoTrack?.id || "";
  const availableLayers = simulcastLayers[trackId] || [];

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const getInitials = (name: string) => {
    return name
      .split(/\s+/)
      .map(word => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "??";
  };

  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl bg-zinc-800 aspect-video group transition-all duration-300",
      isSpeaking && "ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/20"
    )}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal} // Mute local video to prevent feedback
        className={cn(
          "w-full h-full object-cover",
          isLocal && "transform scale-x-[-1]", // Mirror local video
          !hasVideo && "opacity-0"
        )}
      />

      {/* Avatar when video is off */}
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
          <div className="w-20 h-20 rounded-full bg-zinc-700 flex items-center justify-center text-3xl font-bold text-zinc-300">
            {getInitials(name)}
          </div>
        </div>
      )}

      {/* Stats overlay */}
      {settings.showStats && quality && (
        <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded text-xs text-zinc-300 z-10">
          Loss: {quality.packetLoss.toFixed(1)}%
        </div>
      )}

      {/* Layer selector */}
      {!isLocal && availableLayers.length > 1 && (
        <div className="absolute top-2 right-2 z-10">
          <LayerSelector
            trackId={trackId}
            availableLayers={availableLayers}
            currentLayer="h" // Default to high, could be tracked in state
          />
        </div>
      )}

      {/* Name and quality indicator */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm font-medium truncate max-w-[150px]",
              isLocal ? "text-blue-400" : "text-emerald-400"
            )}>
              {name} {isLocal && "(You)"}
            </span>
          </div>
          
          <QualityIndicator quality={quality} />
        </div>
      </div>

      {/* Speaking indicator */}
      {isSpeaking && (
        <div className="absolute top-2 left-2 w-3 h-3 bg-emerald-500 rounded-full animate-pulse z-10" />
      )}
    </div>
  );
}

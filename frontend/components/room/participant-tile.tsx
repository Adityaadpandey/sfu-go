"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import {
    Maximize2,
    MicOff,
    MoreVertical,
    Pin,
    PinOff,
    Volume2,
    VolumeX
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LayerSelector } from "./layer-selector";

interface ParticipantTileProps {
  id: string;
  name: string;
  stream: MediaStream | null;
  isLocal?: boolean;
  isSpeaking?: boolean;
  isMainView?: boolean;
  isThumbnail?: boolean;
  onPin?: () => void;
  isPinned?: boolean;
}

export function ParticipantTile({
  id,
  name,
  stream,
  isLocal,
  isSpeaking,
  isMainView = false,
  isThumbnail = false,
  onPin,
  isPinned = false
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const { peerQuality, simulcastLayers, settings, isMicOn, isCameraOn } = useRoomStore();

  const quality = peerQuality[id];
  const hasVideo = stream?.getVideoTracks().some(track => track.enabled) ?? false;

  // Get available layers for this participant's video track
  const videoTrack = stream?.getVideoTracks()[0];
  const trackId = videoTrack?.id || "";
  const availableLayers = simulcastLayers[trackId] || [];

  // Determine media states
  const micOn = isLocal ? isMicOn : true; // For remote peers, we'd need signaling
  const cameraOn = isLocal ? isCameraOn : hasVideo;

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

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const tileClasses = cn(
    "relative overflow-hidden bg-card/10 group transition-all duration-300 border border-white/5",
    isThumbnail ? "rounded-lg aspect-video" : "rounded-xl w-full h-full",
    isSpeaking && !isThumbnail && "ring-2 ring-white/20 shadow-lg shadow-white/5",
    isMainView && "shadow-2xl",
    "hover:shadow-xl hover:border-white/10"
  );

  return (
    <div
      className={tileClasses}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal || isMuted}
        className={cn(
          "w-full h-full object-cover",
          isLocal && settings.mirrorLocalVideo && "transform scale-x-[-1]", // Mirror local video (optional)
          !cameraOn && "opacity-0"
        )}
      />

      {/* Avatar when video is off */}
      {!cameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50 backdrop-blur-3xl">
          <div className={cn(
            "rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300 font-bold shadow-lg border border-white/5",
            isMainView ? "w-24 h-24 text-3xl" : isThumbnail ? "w-8 h-8 text-xs" : "w-16 h-16 text-xl"
          )}>
            {getInitials(name)}
          </div>
        </div>
      )}

      {/* Speaking Animation Overlay */}
      {isSpeaking && !isThumbnail && (
        <div className="absolute inset-0 border-2 border-primary/20 animate-pulse pointer-events-none rounded-xl" />
      )}

      {/* Stats overlay */}
      {settings.showStats && quality && !isThumbnail && (
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] font-mono text-zinc-400 border border-white/5 z-10">
          Loss: {quality.packetLoss.toFixed(1)}%
        </div>
      )}

      {/* Layer selector */}
      {!isLocal && availableLayers.length > 1 && !isThumbnail && isMainView && (
        <div className="absolute top-3 right-3 z-10">
          <LayerSelector
            trackId={trackId}
            availableLayers={availableLayers}
            currentLayer="h" // Default to high, could be tracked in state
          />
        </div>
      )}

      {/* Hover Controls */}
      {(isHovered || showControls) && !isThumbnail && (
        <div className="absolute inset-0 bg-transparent hover:bg-black/10 transition-colors duration-200">
          {/* Top Controls */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {onPin && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 bg-black/40 hover:bg-black/60 text-zinc-200 rounded-full border border-white/5 backdrop-blur-sm"
                onClick={onPin}
                title={isPinned ? "Unpin" : "Pin participant"}
              >
                {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </Button>
            )}

            {!isLocal && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 bg-black/40 hover:bg-black/60 text-zinc-200 rounded-full border border-white/5 backdrop-blur-sm"
                onClick={toggleMute}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 bg-black/40 hover:bg-black/60 text-zinc-200 rounded-full border border-white/5 backdrop-blur-sm"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </div>

          {/* Expand Button for thumbnails */}
          {isThumbnail && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 bg-black/40 hover:bg-black/60 text-zinc-200 rounded-full border border-white/5 backdrop-blur-sm"
                onClick={onPin}
                title="Focus on this participant"
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Bottom Info Bar */}
      <div className="absolute bottom-3 left-3 right-3">
        <div className="flex items-center gap-2">
            <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-white/5 max-w-full">
            {/* Name */}
            <span className={cn(
              "font-medium truncate text-zinc-200",
              isThumbnail ? "text-[10px]" : "text-xs",
              isLocal && "text-zinc-100"
            )}>
              {name} {isLocal && "(You)"}
            </span>

            {/* Speaking indicator */}
            {isSpeaking && (
              <div className="flex items-center gap-1">
                <div className="flex gap-0.5 items-end h-3">
                    <div className="w-0.5 bg-white/80 animate-[music-bar_0.5s_ease-in-out_infinite]" style={{height: '60%'}}></div>
                    <div className="w-0.5 bg-white/80 animate-[music-bar_0.5s_ease-in-out_infinite_0.1s]" style={{height: '100%'}}></div>
                    <div className="w-0.5 bg-white/80 animate-[music-bar_0.5s_ease-in-out_infinite_0.2s]" style={{height: '40%'}}></div>
                </div>
              </div>
            )}

            {/* Mic Status */}
            {!micOn && (
                <MicOff className="w-3 h-3 text-red-400" />
            )}
            </div>
        </div>
      </div>
    </div>
  );
}

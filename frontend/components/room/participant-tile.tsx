"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useRoomStore } from "@/store/useRoomStore";
import { QualityIndicator } from "./quality-indicator";
import { LayerSelector } from "./layer-selector";
import { Button } from "@/components/ui/button";
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Pin, 
  PinOff,
  MoreVertical,
  Volume2,
  VolumeX,
  Maximize2
} from "lucide-react";

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
    "relative overflow-hidden bg-slate-800 group transition-all duration-300",
    isThumbnail ? "rounded-lg aspect-video" : "rounded-xl aspect-video",
    isSpeaking && !isThumbnail && "ring-2 ring-emerald-400 shadow-lg shadow-emerald-400/20",
    isMainView && "shadow-2xl",
    "hover:shadow-xl"
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
        <div className="absolute inset-0 flex items-center justify-center bg-linear-to-br from-slate-700 to-slate-800">
          <div className={cn(
            "rounded-full bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-lg",
            isMainView ? "w-24 h-24 text-3xl" : isThumbnail ? "w-8 h-8 text-xs" : "w-16 h-16 text-xl"
          )}>
            {getInitials(name)}
          </div>
        </div>
      )}

      {/* Speaking Animation Overlay */}
      {isSpeaking && !isThumbnail && (
        <div className="absolute inset-0 bg-emerald-400/5 animate-pulse" />
      )}

      {/* Stats overlay */}
      {settings.showStats && quality && !isThumbnail && (
        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-sm px-2 py-1 rounded text-xs text-white z-10">
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
        <div className="absolute inset-0 bg-black/20 transition-opacity duration-200">
          {/* Top Controls */}
          <div className="absolute top-3 right-3 flex items-center gap-2">
            {onPin && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 text-white rounded-full"
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
                className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 text-white rounded-full"
                onClick={toggleMute}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 text-white rounded-full"
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
                className="h-8 w-8 p-0 bg-black/50 hover:bg-black/70 text-white rounded-full"
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
      <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 via-black/40 to-transparent p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Name */}
            <span className={cn(
              "font-medium truncate text-white",
              isThumbnail ? "text-xs" : "text-sm",
              isLocal && "text-blue-300"
            )}>
              {name} {isLocal && "(You)"}
            </span>

            {/* Speaking indicator */}
            {isSpeaking && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                {!isThumbnail && (
                  <span className="text-xs text-emerald-400">Speaking</span>
                )}
              </div>
            )}
          </div>

          {/* Media Status & Quality */}
          <div className="flex items-center gap-2">
            {/* Quality Indicator */}
            {!isThumbnail && <QualityIndicator quality={quality} />}

            {/* Media Status Icons */}
            <div className="flex items-center gap-1">
              <div className={cn(
                "flex items-center justify-center rounded",
                isThumbnail ? "w-4 h-4" : "w-5 h-5",
                micOn ? "text-white/70" : "text-red-400"
              )}>
                {micOn ? (
                  <Mic className={cn(isThumbnail ? "w-2 h-2" : "w-3 h-3")} />
                ) : (
                  <MicOff className={cn(isThumbnail ? "w-2 h-2" : "w-3 h-3")} />
                )}
              </div>
              
              <div className={cn(
                "flex items-center justify-center rounded",
                isThumbnail ? "w-4 h-4" : "w-5 h-5",
                cameraOn ? "text-white/70" : "text-red-400"
              )}>
                {cameraOn ? (
                  <Video className={cn(isThumbnail ? "w-2 h-2" : "w-3 h-3")} />
                ) : (
                  <VideoOff className={cn(isThumbnail ? "w-2 h-2" : "w-3 h-3")} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

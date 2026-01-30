"use client";

import { useRoomStore } from "@/store/useRoomStore";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const { 
    status, 
    peers, 
    trackCount, 
    dominantSpeakerId, 
    userName 
  } = useRoomStore();

  const peerCount = Object.keys(peers).length;
  const speakerName = dominantSpeakerId 
    ? peers[dominantSpeakerId]?.name || "Unknown"
    : null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected": return "text-emerald-400";
      case "connecting": return "text-yellow-400";
      case "error": return "text-red-400";
      case "disconnected": return "text-red-400";
      default: return "text-zinc-400";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "connected": return "Connected";
      case "connecting": return "Connecting";
      case "error": return "Error";
      case "disconnected": return "Disconnected";
      default: return "Offline";
    }
  };

  return (
    <div className="bg-zinc-900/50 border-b border-zinc-800 px-4 py-2 flex items-center gap-6 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">Status:</span>
        <span className={cn("font-medium", getStatusColor(status))}>
          {getStatusText(status)}
        </span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">Peers:</span>
        <span className="font-medium text-emerald-400">{peerCount}</span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-zinc-400">Tracks:</span>
        <span className="font-medium text-emerald-400">{trackCount}</span>
      </div>
      
      <div className="flex-1" />
      
      {speakerName && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-emerald-400 font-medium">
            Speaking: {speakerName === userName ? "You" : speakerName}
          </span>
        </div>
      )}
    </div>
  );
}
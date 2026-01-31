"use client";

import { useState, useEffect } from "react";
import { useRoomStore } from "@/store/useRoomStore";
import { ParticipantTile } from "./participant-tile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { 
  Grid3X3, 
  Maximize2, 
  Users,
  LayoutGrid,
  Monitor
} from "lucide-react";

type ViewMode = "grid" | "speaker" | "gallery";

export function VideoGrid() {
  const { peers, remoteStreams, localStream, userId, userName, dominantSpeakerId } = useRoomStore();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [pinnedParticipant, setPinnedParticipant] = useState<string | null>(null);

  const allPeers = Object.values(peers);
  const totalParticipants = allPeers.length + 1; // +1 for local user

  // Auto-switch to speaker view when there are many participants
  useEffect(() => {
    if (totalParticipants > 6 && viewMode === "grid") {
      setViewMode("speaker");
    }
  }, [totalParticipants, viewMode]);

  // Determine grid layout based on participant count and view mode
  const getGridClass = (count: number, mode: ViewMode) => {
    if (mode === "speaker") return "speaker-view";
    if (mode === "gallery") return "gallery-view";
    
    // Grid mode
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 lg:grid-cols-2";
    if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 6) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    if (count <= 9) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
  };

  const renderSpeakerView = () => {
    const speakerId = pinnedParticipant || dominantSpeakerId;
    const mainParticipant = speakerId === "local" || speakerId === userId 
      ? { id: "local", name: userName || "You", stream: localStream, isLocal: true }
      : allPeers.find(p => p.id === speakerId);

    const otherParticipants = [
      ...(speakerId !== "local" && speakerId !== userId ? [{ id: "local", name: userName || "You", stream: localStream, isLocal: true }] : []),
      ...allPeers.filter(p => p.id !== speakerId)
    ];

    return (
      <div className="flex flex-col h-full">
        {/* Main Speaker */}
        <div className="flex-1 p-4 pb-2">
          {mainParticipant ? (
            <ParticipantTile
              id={mainParticipant.id}
              name={mainParticipant.name}
              stream={mainParticipant.stream || (remoteStreams[mainParticipant.id]?.[0] || null)}
              isLocal={mainParticipant.isLocal || mainParticipant.id === "local"}
              isSpeaking={mainParticipant.id === dominantSpeakerId}
              isMainView={true}
              onPin={() => setPinnedParticipant(pinnedParticipant === mainParticipant.id ? null : mainParticipant.id)}
              isPinned={pinnedParticipant === mainParticipant.id}
            />
          ) : (
            <div className="w-full h-full bg-slate-800 rounded-xl flex items-center justify-center">
              <div className="text-center text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No active speaker</p>
              </div>
            </div>
          )}
        </div>

        {/* Thumbnail Strip */}
        {otherParticipants.length > 0 && (
          <div className="h-32 px-4 pb-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {otherParticipants.map((participant) => (
                <div key={participant.id} className="shrink-0 w-24">
                  <ParticipantTile
                    id={participant.id}
                    name={participant.name}
                    stream={participant.stream || (remoteStreams[participant.id]?.[0] || null)}
                    isLocal={participant.isLocal || participant.id === "local"}
                    isSpeaking={participant.id === dominantSpeakerId}
                    isThumbnail={true}
                    onPin={() => setPinnedParticipant(participant.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderGridView = () => (
    <div className={cn(
      "grid gap-4 p-4 h-full auto-rows-fr",
      getGridClass(totalParticipants, viewMode)
    )}>
      {/* Local User */}
      <ParticipantTile
        id="local"
        name={userName || "You"}
        stream={localStream}
        isLocal={true}
        isSpeaking={dominantSpeakerId === userId || dominantSpeakerId === "local"}
      />

      {/* Remote Peers */}
      {allPeers.map((peer) => {
        const streams = remoteStreams[peer.id] || [];
        const mainStream = streams[0] || null;

        return (
          <ParticipantTile
            key={peer.id}
            id={peer.id}
            name={peer.name}
            stream={mainStream}
            isSpeaking={peer.id === dominantSpeakerId}
          />
        );
      })}
    </div>
  );

  return (
    <div className="flex-1 relative bg-slate-900">
      {/* View Mode Controls */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-lg p-1 border border-slate-700/50">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs",
              viewMode === "grid" 
                ? "bg-blue-500/20 text-blue-400" 
                : "text-slate-400 hover:text-white"
            )}
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="w-3 h-3 mr-1" />
            Grid
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs",
              viewMode === "speaker" 
                ? "bg-blue-500/20 text-blue-400" 
                : "text-slate-400 hover:text-white"
            )}
            onClick={() => setViewMode("speaker")}
          >
            <Monitor className="w-3 h-3 mr-1" />
            Speaker
          </Button>
        </div>

        {totalParticipants > 1 && (
          <div className="bg-slate-800/90 backdrop-blur-sm rounded-lg px-3 py-1 border border-slate-700/50">
            <span className="text-xs text-slate-300">
              {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Video Content */}
      {viewMode === "speaker" ? renderSpeakerView() : renderGridView()}

      {/* Empty State */}
      {totalParticipants === 1 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-slate-400 max-w-md">
            <Users className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium mb-2">You're the only one here</h3>
            <p className="text-sm">
              Share the meeting link to invite others to join
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

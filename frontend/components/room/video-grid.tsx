"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import {
    LayoutGrid,
    Monitor,
    Users
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ParticipantTile } from "./participant-tile";

// Helper to calculate optimal grid dimensions
function calculateGridDimensions(count: number, width: number, height: number) {
  if (count === 0) return { rows: 1, cols: 1 };

  // Google Meet style: standard grid logic trying to maximize tile size
  let bestArea = 0;
  let bestCols = 1;
  let bestRows = 1;
  const tileAspect = 16 / 9;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const tileWidth = width / cols;
    const tileHeight = height / rows;

    // Check if we can fit the tile aspect ratio inside the available slot
    let h = tileHeight;
    let w = h * tileAspect;

    // If calculated width is greater than available slot width, constrain by width
    if (w > tileWidth) {
      w = tileWidth;
      h = w / tileAspect;
    }

    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      bestCols = cols;
      bestRows = rows;
    }
  }

  return { rows: bestRows, cols: bestCols };
}

type ViewMode = "grid" | "speaker" | "gallery";

export function VideoGrid() {
  const { peers, remoteStreams, localStream, userId, userName, dominantSpeakerId } = useRoomStore();
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [pinnedParticipant, setPinnedParticipant] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            setDimensions({
                width: entry.contentRect.width,
                height: entry.contentRect.height
            });
        }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const allPeers = Object.values(peers);
  const totalParticipants = allPeers.length + 1; // +1 for local user

  // Calculate dynamic grid
  const { rows, cols } = calculateGridDimensions(totalParticipants, dimensions.width || 800, dimensions.height || 600);

  const pickBestStream = (streams: MediaStream[] | undefined) => {
    if (!streams || streams.length === 0) return null;
    return streams.find((s) => s.getVideoTracks().length > 0) || streams[0];
  };

  const renderSpeakerView = () => {
    const speakerId = pinnedParticipant || dominantSpeakerId;

    const isLocalMain = speakerId === "local" || speakerId === userId;
    const mainPeer = allPeers.find(p => p.id === speakerId);

    // If we can't find the participant, show empty state
    if (!isLocalMain && !mainPeer) {
        return (
            <div className="flex flex-col h-full w-full">
                <div className="flex-1 p-4 pb-2">
                    <div className="w-full h-full bg-card/10 rounded-xl flex items-center justify-center border border-white/5">
                        <div className="text-center text-muted-foreground">
                            <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>Participant not found</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const mainId = isLocalMain ? "local" : mainPeer!.id;
    const mainName = isLocalMain ? (userName || "You") : mainPeer!.name;
    const mainStream = isLocalMain ? localStream : pickBestStream(remoteStreams[mainId]);
    const isMainLocal = isLocalMain;

    const otherParticipants = [
      ...(speakerId !== "local" && speakerId !== userId ? [{ id: "local", name: userName || "You", stream: localStream, isLocal: true }] : []),
      ...allPeers.filter(p => p.id !== speakerId)
    ];

    return (
      <div className="flex flex-col h-full">
        {/* Main Speaker */}
        <div className="flex-1 p-4 pb-2">
            <ParticipantTile
              id={mainId}
              name={mainName}
              stream={mainStream}
              isLocal={isMainLocal}
              isSpeaking={mainId === dominantSpeakerId}
              isMainView={true}
              onPin={() => setPinnedParticipant(pinnedParticipant === mainId ? null : mainId)}
              isPinned={pinnedParticipant === mainId}
            />

        </div>

        {/* Thumbnail Strip */}
        {otherParticipants.length > 0 && (
          <div className="h-32 px-4 pb-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {otherParticipants.map((participant) => {
                const pStream = participant.id === "local" ? localStream : pickBestStream(remoteStreams[participant.id]);
                return (
                <div key={participant.id} className="shrink-0 w-24">
                  <ParticipantTile
                    id={participant.id}
                    name={participant.name}
                    stream={pStream}
                    isLocal={participant.isLocal || participant.id === "local"}
                    isSpeaking={participant.id === dominantSpeakerId}
                    isThumbnail={true}
                    onPin={() => setPinnedParticipant(participant.id)}
                  />
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderGridView = () => (
    <div
        className="w-full h-full grid gap-4 place-content-center"
        style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            width: '100%',
            height: '100%'
        }}
    >
      {/* Local User */}
      <div className="w-full h-full min-h-0 min-w-0 bg-secondary/20 rounded-xl overflow-hidden relative">
        <ParticipantTile
            id="local"
            name={userName || "You"}
            stream={localStream}
            isLocal={true}
            isSpeaking={dominantSpeakerId === userId || dominantSpeakerId === "local"}
        />
      </div>

      {/* Remote Peers */}
      {allPeers.map((peer) => {
        const streams = remoteStreams[peer.id] || [];
        const mainStream = pickBestStream(streams);

        return (
          <div key={peer.id} className="w-full h-full min-h-0 min-w-0 bg-secondary/20 rounded-xl overflow-hidden relative">
            <ParticipantTile
                id={peer.id}
                name={peer.name}
                stream={mainStream}
                isSpeaking={peer.id === dominantSpeakerId}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex-1 relative w-full h-full bg-background" ref={containerRef}>
      {/* View Mode Controls */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="bg-background/80 backdrop-blur-md rounded-lg p-1 border border-border shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs font-medium",
              viewMode === "grid"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground"
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
              "h-8 px-3 text-xs font-medium",
              viewMode === "speaker"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewMode("speaker")}
          >
            <Monitor className="w-3 h-3 mr-1" />
            Speaker
          </Button>
        </div>

        {totalParticipants > 1 && (
          <div className="bg-background/80 backdrop-blur-md rounded-lg px-3 py-1 border border-border">
            <span className="text-xs text-muted-foreground font-mono">
              {totalParticipants} connected
            </span>
          </div>
        )}
      </div>

      {/* Video Content */}
      {viewMode === "speaker" ? renderSpeakerView() : renderGridView()}

      {/* Empty State */}
      {totalParticipants === 1 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-muted-foreground max-w-md">
            <Users className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-medium mb-2 text-foreground">Waiting for others</h3>
            <p className="text-sm opacity-60">
              Share the meeting link to invite others
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

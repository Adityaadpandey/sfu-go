"use client";

import { useRoomStore } from "@/store/useRoomStore";
import { ParticipantTile } from "./participant-tile";
import { cn } from "@/lib/utils";

export function VideoGrid() {
  const { peers, remoteStreams, localStream, userId, userName, dominantSpeakerId } = useRoomStore();

  const allPeers = Object.values(peers);
  const totalParticipants = allPeers.length + 1; // +1 for local user

  // Determine grid layout based on participant count
  const getGridClass = (count: number) => {
    if (count === 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 6) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    if (count <= 9) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
  };

  return (
    <div className="flex-1 p-4 overflow-hidden">
      <div className={cn(
        "grid gap-4 h-full auto-rows-fr",
        getGridClass(totalParticipants)
      )}>
        {/* Local User */}
        <ParticipantTile
          id="local"
          name={userName || "You"}
          stream={localStream}
          isLocal={true}
          isSpeaking={dominantSpeakerId === userId}
        />

        {/* Remote Peers */}
        {allPeers.map((peer) => {
          // Find stream for this peer
          const streams = remoteStreams[peer.id] || [];
          // Usually we take the first stream, or we might separate user/screen
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
    </div>
  );
}

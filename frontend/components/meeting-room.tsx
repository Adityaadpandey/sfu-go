"use client";

import { useState } from "react";
import { VideoGrid } from "@/components/room/video-grid";
import { Controls } from "@/components/room/controls";
import { TopBar } from "@/components/room/top-bar";
import { SidePanel } from "@/components/room/side-panel";
import { useRoomStore } from "@/store/useRoomStore";
import { cn } from "@/lib/utils";

export function MeetingRoom() {
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<"participants" | "chat" | "logs">("participants");
  const { roomId, userName, peers } = useRoomStore();

  const participantCount = Object.keys(peers).length + 1; // +1 for local user

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden">
      {/* Top Bar */}
      <TopBar 
        roomId={roomId || ""}
        participantCount={participantCount}
        onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
        showSidePanel={showSidePanel}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video Area */}
        <div className={cn(
          "flex-1 flex flex-col transition-all duration-300 ease-in-out",
          showSidePanel ? "lg:mr-80" : ""
        )}>
          {/* Video Grid */}
          <div className="flex-1 relative">
            <VideoGrid />
          </div>

          {/* Controls */}
          <div className="shrink-0">
            <Controls 
              onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
              onChangeSidePanelTab={setSidePanelTab}
              sidePanelTab={sidePanelTab}
              isSidePanelOpen={showSidePanel}
            />
          </div>
        </div>

        {/* Side Panel */}
        <SidePanel 
          isOpen={showSidePanel}
          activeTab={sidePanelTab}
          onTabChange={setSidePanelTab}
          onClose={() => setShowSidePanel(false)}
        />
      </div>
    </div>
  );
}
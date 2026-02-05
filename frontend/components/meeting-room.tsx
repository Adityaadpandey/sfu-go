"use client";

import { Controls } from "@/components/room/controls";
import { SidePanel } from "@/components/room/side-panel";
import { TopBar } from "@/components/room/top-bar";
import { VideoGrid } from "@/components/room/video-grid";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import { useState } from "react";

export function MeetingRoom() {
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<"participants" | "logs">("participants");
  const { roomId, peers } = useRoomStore();

  const participantCount = Object.keys(peers).length + 1; // +1 for local user

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Top Bar */}
      <TopBar
        roomId={roomId || ""}
        participantCount={participantCount}
        onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
        showSidePanel={showSidePanel}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden min-h-0 bg-background">
        {/* Video Area */}
        <div className={cn(
          "flex-1 flex flex-col transition-all duration-300 ease-in-out min-w-0 bg-background/50",
          showSidePanel ? "mr-0 lg:mr-[320px]" : ""
        )}>
          {/* Video Grid */}
          <div className="flex-1 relative p-4 flex items-center justify-center min-h-0">
            <VideoGrid />
          </div>

          {/* Controls */}
          <div className="shrink-0 z-50">
            <Controls
              onToggleSidePanel={() => setShowSidePanel(!showSidePanel)}
              onChangeSidePanelTab={setSidePanelTab}
              sidePanelTab={sidePanelTab}
              isSidePanelOpen={showSidePanel}
            />
          </div>
        </div>

        {/* Side Panel - Absolute on mobile, static on desktop when open */}
        <div className={cn(
          "fixed inset-y-0 right-0 z-40 w-80 bg-background border-l shadow-xl transform transition-transform duration-300 ease-in-out lg:shadow-none lg:border-l lg:static",
          showSidePanel ? "translate-x-0" : "translate-x-full lg:hidden"
        )}>
           <SidePanel
            isOpen={showSidePanel}
            activeTab={sidePanelTab}
            onTabChange={setSidePanelTab}
            onClose={() => setShowSidePanel(false)}
          />
        </div>
      </div>
    </div>
  );
}

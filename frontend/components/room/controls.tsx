"use client";

import { Button } from "@/components/ui/button";
import { useWebRTCContext } from "@/components/webrtc-provider";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import {
    Hand,
    Mic,
    MicOff,
    MonitorUp,
    MoreHorizontal,
    PhoneOff,
    Settings,
    Terminal,
    Users,
    Video,
    VideoOff
} from "lucide-react";
import { useState } from "react";

interface ControlsProps {
  onToggleSidePanel: () => void;
  onChangeSidePanelTab: (tab: "participants" | "logs") => void;
  sidePanelTab: "participants" | "logs";
  isSidePanelOpen: boolean;
}

export function Controls({ onToggleSidePanel, onChangeSidePanelTab, sidePanelTab, isSidePanelOpen }: ControlsProps) {
  const { toggleMic, toggleCamera, toggleScreenShare, disconnect } = useWebRTCContext();
  const {
    isMicOn,
    isCameraOn,
    isScreenShareOn,
    toggleSettingsModal,
    peers
  } = useRoomStore();

  const [isRaiseHand, setIsRaiseHand] = useState(false);

  const handleLeave = () => {
    if (window.confirm("Are you sure you want to leave the meeting?")) {
      disconnect();
    }
  };

  const handleRaiseHand = () => {
    setIsRaiseHand(!isRaiseHand);
    // TODO: Implement raise hand signaling
  };

  const participantCount = Object.keys(peers).length + 1;

  const openSidePanelTab = (tab: "participants" | "logs") => {
    // If the panel is open and the user clicks the active tab, treat it as "close".
    if (isSidePanelOpen && sidePanelTab === tab) {
      onToggleSidePanel();
      return;
    }

    // Switch tab (and open panel if needed).
    onChangeSidePanelTab(tab);
    if (!isSidePanelOpen) {
      onToggleSidePanel();
    }
  };

  return (
    <div className="bg-background/95 backdrop-blur-md border-t border-border px-6 py-4 shadow-sm">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        {/* Left Section - Meeting Info */}
        <div className="flex items-center gap-3">
          <div className="text-sm text-foreground font-medium">
            <span className="text-muted-foreground mr-1">Team Meeting</span>
            <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-secondary-foreground">
                {participantCount}
            </span>
          </div>
        </div>

        {/* Center Section - Main Controls */}
        <div className="flex items-center gap-2">
          {/* Microphone */}
          <Button
            variant="ghost"
            size="lg"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-200 border",
              isMicOn
                ? "bg-secondary hover:bg-secondary/80 text-secondary-foreground border-transparent"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent shadow-md"
            )}
            onClick={toggleMic}
            title={isMicOn ? "Mute microphone" : "Unmute microphone"}
          >
            {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </Button>

          {/* Camera */}
          <Button
            variant="ghost"
            size="lg"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-200 border",
              isCameraOn
                ? "bg-secondary hover:bg-secondary/80 text-secondary-foreground border-transparent"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent shadow-md"
            )}
            onClick={toggleCamera}
            title={isCameraOn ? "Turn off camera" : "Turn on camera"}
          >
            {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </Button>

          {/* Screen Share */}
          <Button
            variant="ghost"
            size="lg"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-200 border",
              isScreenShareOn
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md border-transparent"
                : "bg-secondary hover:bg-secondary/80 text-secondary-foreground border-transparent"
            )}
            onClick={toggleScreenShare}
            title={isScreenShareOn ? "Stop sharing screen" : "Share screen"}
          >
            <MonitorUp className="h-5 w-5" />
          </Button>

          {/* Raise Hand */}
          <Button
            variant="ghost"
            size="lg"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-200 border",
              isRaiseHand
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md border-transparent"
                : "bg-secondary hover:bg-secondary/80 text-secondary-foreground border-transparent"
            )}
            onClick={handleRaiseHand}
            title={isRaiseHand ? "Lower hand" : "Raise hand"}
          >
            <Hand className="h-5 w-5" />
          </Button>

          {/* Leave Meeting */}
          <Button
            variant="ghost"
            size="lg"
            className="h-12 w-12 rounded-full bg-destructive/10 hover:bg-destructive/20 text-destructive border-transparent ml-2 transition-all duration-200"
            onClick={handleLeave}
            title="Leave meeting"
          >
            <PhoneOff className="h-5 w-5" />
          </Button>
        </div>

        {/* Right Section - Secondary Controls */}
        <div className="flex items-center gap-2">
          {/* Participants */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 px-3 rounded-lg transition-all duration-200 border",
              sidePanelTab === "participants" && isSidePanelOpen
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground border-transparent"
            )}
            onClick={() => openSidePanelTab("participants")}
            title="Show participants"
          >
            <Users className="h-4 w-4 mr-2" />
            <span className="text-xs font-mono">{participantCount}</span>
          </Button>

          {/* Debug Logs */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 px-3 rounded-lg transition-all duration-200 border",
              sidePanelTab === "logs" && isSidePanelOpen
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground border-transparent"
            )}
            onClick={() => openSidePanelTab("logs")}
            title="Show debug logs"
          >
            <Terminal className="h-4 w-4" />
          </Button>

          {/* Settings */}
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 rounded-lg bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-200"
            onClick={toggleSettingsModal}
            title="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>

          {/* More Options */}
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 rounded-lg bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground transition-all duration-200"
            title="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

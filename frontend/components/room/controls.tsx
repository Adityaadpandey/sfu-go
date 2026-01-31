"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWebRTCContext } from "@/components/webrtc-provider";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import { 
  Mic, 
  MicOff, 
  MonitorUp, 
  PhoneOff, 
  Video, 
  VideoOff, 
  Settings, 
  Users,
  MessageSquare,
  MoreHorizontal,
  Hand,
  Terminal
} from "lucide-react";

interface ControlsProps {
  onToggleSidePanel: () => void;
  onChangeSidePanelTab: (tab: "participants" | "chat" | "logs") => void;
  sidePanelTab: "participants" | "chat" | "logs";
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

  const openSidePanelTab = (tab: "participants" | "chat" | "logs") => {
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
    <div className="bg-slate-800/90 backdrop-blur-sm border-t border-slate-700/50 px-6 py-4">
      <div className="flex items-center justify-between max-w-4xl mx-auto">
        {/* Left Section - Meeting Info */}
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-300">
            <span className="font-medium">{participantCount}</span> participant{participantCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Center Section - Main Controls */}
        <div className="flex items-center gap-2">
          {/* Microphone */}
          <Button
            variant="ghost"
            size="lg"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-200",
              isMicOn 
                ? "bg-slate-700/50 hover:bg-slate-600/50 text-white" 
                : "bg-red-500 hover:bg-red-600 text-white shadow-lg"
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
              "h-12 w-12 rounded-full transition-all duration-200",
              isCameraOn 
                ? "bg-slate-700/50 hover:bg-slate-600/50 text-white" 
                : "bg-red-500 hover:bg-red-600 text-white shadow-lg"
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
              "h-12 w-12 rounded-full transition-all duration-200",
              isScreenShareOn 
                ? "bg-blue-500 hover:bg-blue-600 text-white shadow-lg" 
                : "bg-slate-700/50 hover:bg-slate-600/50 text-white"
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
              "h-12 w-12 rounded-full transition-all duration-200",
              isRaiseHand 
                ? "bg-yellow-500 hover:bg-yellow-600 text-white shadow-lg" 
                : "bg-slate-700/50 hover:bg-slate-600/50 text-white"
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
            className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg ml-2 transition-all duration-200"
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
              "h-10 px-3 rounded-lg transition-all duration-200",
              sidePanelTab === "participants" 
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" 
                : "bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white"
            )}
            onClick={() => openSidePanelTab("participants")}
            title="Show participants"
          >
            <Users className="h-4 w-4 mr-2" />
            <span className="text-sm">{participantCount}</span>
          </Button>

          {/* Chat */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 px-3 rounded-lg transition-all duration-200",
              sidePanelTab === "chat" 
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" 
                : "bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white"
            )}
            onClick={() => openSidePanelTab("chat")}
            title="Open chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>

          {/* Debug Logs */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 px-3 rounded-lg transition-all duration-200",
              sidePanelTab === "logs" 
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" 
                : "bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white"
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
            className="h-10 w-10 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white transition-all duration-200"
            onClick={toggleSettingsModal}
            title="Open settings"
          >
            <Settings className="h-4 w-4" />
          </Button>

          {/* More Options */}
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 hover:text-white transition-all duration-200"
            title="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

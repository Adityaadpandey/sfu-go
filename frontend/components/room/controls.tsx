"use client";

import { Button } from "@/components/ui/button";
import { useWebRTCContext } from "@/components/webrtc-provider";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff, Settings, MessageSquare } from "lucide-react";

export function Controls() {
  const { toggleMic, toggleCamera, toggleScreenShare, disconnect } = useWebRTCContext();
  const { 
    isMicOn, 
    isCameraOn, 
    isScreenShareOn, 
    toggleSettingsModal,
    settings,
    updateSettings
  } = useRoomStore();

  const handleLeave = () => {
    disconnect();
  };

  const toggleLogs = () => {
    updateSettings({ showLogs: !settings.showLogs });
  };

  return (
    <div className="h-20 bg-zinc-900 border-t border-zinc-800 flex items-center justify-center gap-4 px-4">
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "h-12 w-12 rounded-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100",
          !isMicOn && "bg-red-500/10 border-red-500/50 text-red-500 hover:bg-red-500/20"
        )}
        onClick={toggleMic}
        title={isMicOn ? "Mute microphone" : "Unmute microphone"}
      >
        {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </Button>

      <Button
        variant="outline"
        size="icon"
        className={cn(
          "h-12 w-12 rounded-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100",
          !isCameraOn && "bg-red-500/10 border-red-500/50 text-red-500 hover:bg-red-500/20"
        )}
        onClick={toggleCamera}
        title={isCameraOn ? "Turn off camera" : "Turn on camera"}
      >
        {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
      </Button>

      <Button
        variant="outline"
        size="icon"
        className={cn(
          "h-12 w-12 rounded-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100",
          isScreenShareOn && "bg-emerald-500/10 border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/20"
        )}
        onClick={toggleScreenShare}
        title={isScreenShareOn ? "Stop screen share" : "Share screen"}
      >
        <MonitorUp className="h-5 w-5" />
      </Button>

      <div className="w-px h-8 bg-zinc-700 mx-2" />

      <Button
        variant="outline"
        size="icon"
        className="h-12 w-12 rounded-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100"
        onClick={toggleLogs}
        title="Toggle logs panel"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="h-12 w-12 rounded-full border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100"
        onClick={toggleSettingsModal}
        title="Open settings"
      >
        <Settings className="h-5 w-5" />
      </Button>

      <div className="w-px h-8 bg-zinc-700 mx-2" />

      <Button
        variant="destructive"
        size="icon"
        className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700"
        onClick={handleLeave}
        title="Leave room"
      >
        <PhoneOff className="h-5 w-5" />
      </Button>
    </div>
  );
}

"use client";

import { JoinScreen } from "@/components/join-screen";
import { Controls } from "@/components/room/controls";
import { VideoGrid } from "@/components/room/video-grid";
import { StatusBar } from "@/components/room/status-bar";
import { LoggingPanel } from "@/components/room/logging-panel";
import { SettingsModal } from "@/components/room/settings-modal";
import { WebRTCProvider } from "@/components/webrtc-provider";
import { useRoomStore } from "@/store/useRoomStore";

export default function Home() {
  const { status } = useRoomStore();
  const isConnected = status === "connected";

  return (
    <WebRTCProvider>
      {!isConnected ? (
        <JoinScreen />
      ) : (
        <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
          <StatusBar />
          <VideoGrid />
          <Controls />
          <LoggingPanel />
          <SettingsModal />
        </div>
      )}
    </WebRTCProvider>
  );
}

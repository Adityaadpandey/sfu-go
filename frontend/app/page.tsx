"use client";

import { JoinScreen } from "@/components/join-screen";
import { MeetingRoom } from "@/components/meeting-room";
import { SettingsModal } from "@/components/room/settings-modal";
import { WebRTCProvider } from "@/components/webrtc-provider";
import { useRoomStore } from "@/store/useRoomStore";

import { Suspense } from "react";

// ... existing imports ...

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { status } = useRoomStore();
  const isConnected = status === "connected";

  return (
    <WebRTCProvider>
      <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900">
        {!isConnected ? (
          <JoinScreen />
        ) : (
          <MeetingRoom />
        )}
        <SettingsModal />
      </div>
    </WebRTCProvider>
  );
}

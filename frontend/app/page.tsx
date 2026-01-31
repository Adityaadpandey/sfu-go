"use client";

import { JoinScreen } from "@/components/join-screen";
import { MeetingRoom } from "@/components/meeting-room";
import { WebRTCProvider } from "@/components/webrtc-provider";
import { SettingsModal } from "@/components/room/settings-modal";
import { useRoomStore } from "@/store/useRoomStore";

export default function Home() {
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

"use client";

import { useWebRTC } from "@/hooks/useWebRTC";
import { createContext, ReactNode, useContext } from "react";

type WebRTCContextType = ReturnType<typeof useWebRTC>;

const WebRTCContext = createContext<WebRTCContextType | null>(null);

export function WebRTCProvider({ children }: { children: ReactNode }) {
  const webrtc = useWebRTC();

  return (
    <WebRTCContext.Provider value={webrtc}>
      {children}
    </WebRTCContext.Provider>
  );
}

export function useWebRTCContext() {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error("useWebRTCContext must be used within a WebRTCProvider");
  }
  return context;
}

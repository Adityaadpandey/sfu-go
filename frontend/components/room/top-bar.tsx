"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import {
    AlertTriangle,
    Check,
    Clock,
    Copy,
    Shield,
    Users,
    Wifi,
    WifiOff
} from "lucide-react";
import { useEffect, useState } from "react";

interface TopBarProps {
  roomId: string;
  participantCount: number;
  onToggleSidePanel: () => void;
  showSidePanel: boolean;
}

export function TopBar({ roomId, participantCount, onToggleSidePanel, showSidePanel }: TopBarProps) {
  const [copied, setCopied] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { status, dominantSpeakerId, peers } = useRoomStore();

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy room ID:', err);
    }
  };

  const getConnectionStatus = () => {
    switch (status) {
      case "connected":
        return { icon: Wifi, color: "text-zinc-400", text: "Connected" };
      case "connecting":
        return { icon: AlertTriangle, color: "text-zinc-400", text: "Connecting" };
      case "disconnected":
        return { icon: WifiOff, color: "text-zinc-500", text: "Disconnected" };
      default:
        return { icon: WifiOff, color: "text-zinc-600", text: "Offline" };
    }
  };

  const connectionStatus = getConnectionStatus();
  const StatusIcon = connectionStatus.icon;

  const speakerName = dominantSpeakerId
    ? (dominantSpeakerId === "local" ? "You" : peers[dominantSpeakerId]?.name || "Unknown")
    : null;

  return (
    <div className="bg-background/95 backdrop-blur-md border-b border-border px-6 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        {/* Left Section - Room Info */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-sm font-medium text-foreground">Live</span>
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={copyRoomId}
              className="h-7 px-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            >
              <span className="text-xs font-mono">{roomId}</span>
              {copied ? (
                <Check className="w-3 h-3 ml-2 text-primary" />
              ) : (
                <Copy className="w-3 h-3 ml-2" />
              )}
            </Button>
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-mono">
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Center Section - Speaking Indicator */}
        <div className="flex items-center gap-3">
          {speakerName && (
            <div className="flex items-center gap-2 bg-secondary/50 border border-border rounded-full px-3 py-1">
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              <span className="text-xs text-secondary-foreground font-medium">
                {speakerName} speaking
              </span>
            </div>
          )}
        </div>

        {/* Right Section - Status & Participants */}
        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <StatusIcon className={cn("w-3.5 h-3.5", connectionStatus.color)} />
            <span className={cn("text-xs font-medium", connectionStatus.color)}>
              {connectionStatus.text}
            </span>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* Participants Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSidePanel}
            className={cn(
              "h-8 px-3 text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              showSidePanel && "bg-secondary text-secondary-foreground"
            )}
          >
            <Users className="w-4 h-4 mr-2" />
            <span className="text-xs font-mono">{participantCount}</span>
          </Button>

          {/* Security Indicator */}
          <div className="flex items-center gap-1 opacity-50 hover:opacity-100 transition-opacity">
            <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>
    </div>
  );
}

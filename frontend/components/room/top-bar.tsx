"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRoomStore } from "@/store/useRoomStore";
import { 
  Users, 
  Shield, 
  Copy, 
  Check, 
  Clock,
  Wifi,
  WifiOff,
  AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";

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
        return { icon: Wifi, color: "text-emerald-400", text: "Connected" };
      case "connecting":
        return { icon: AlertTriangle, color: "text-yellow-400", text: "Connecting" };
      case "disconnected":
        return { icon: WifiOff, color: "text-red-400", text: "Disconnected" };
      default:
        return { icon: WifiOff, color: "text-gray-400", text: "Offline" };
    }
  };

  const connectionStatus = getConnectionStatus();
  const StatusIcon = connectionStatus.icon;

  const speakerName = dominantSpeakerId 
    ? (dominantSpeakerId === "local" ? "You" : peers[dominantSpeakerId]?.name || "Unknown")
    : null;

  return (
    <div className="bg-slate-800/90 backdrop-blur-sm border-b border-slate-700/50 px-6 py-3">
      <div className="flex items-center justify-between">
        {/* Left Section - Room Info */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-slate-200">Live</span>
          </div>
          
          <div className="h-4 w-px bg-slate-600" />
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={copyRoomId}
              className="h-8 px-3 text-slate-300 hover:text-white hover:bg-slate-700/50"
            >
              <span className="text-xs font-mono">{roomId}</span>
              {copied ? (
                <Check className="w-3 h-3 ml-2 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 ml-2" />
              )}
            </Button>
          </div>

          <div className="h-4 w-px bg-slate-600" />

          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-300">
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Center Section - Speaking Indicator */}
        <div className="flex items-center gap-3">
          {speakerName && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-sm text-emerald-400 font-medium">
                {speakerName} speaking
              </span>
            </div>
          )}
        </div>

        {/* Right Section - Status & Participants */}
        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <StatusIcon className={cn("w-4 h-4", connectionStatus.color)} />
            <span className={cn("text-sm", connectionStatus.color)}>
              {connectionStatus.text}
            </span>
          </div>

          <div className="h-4 w-px bg-slate-600" />

          {/* Participants Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSidePanel}
            className={cn(
              "h-8 px-3 text-slate-300 hover:text-white hover:bg-slate-700/50",
              showSidePanel && "bg-slate-700/50 text-white"
            )}
          >
            <Users className="w-4 h-4 mr-2" />
            <span className="text-sm">{participantCount}</span>
          </Button>

          {/* Security Indicator */}
          <div className="flex items-center gap-1">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-slate-400">Secure</span>
          </div>
        </div>
      </div>
    </div>
  );
}
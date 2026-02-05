"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import {
    Mic,
    MicOff,
    MoreVertical,
    Terminal,
    Users,
    Video,
    VideoOff,
    X
} from "lucide-react";

interface SidePanelProps {
  isOpen: boolean;
  activeTab: "participants" | "logs";
  onTabChange: (tab: "participants" | "logs") => void;
  onClose: () => void;
}

export function SidePanel({ isOpen, activeTab, onTabChange, onClose }: SidePanelProps) {
  const {
    peers,
    userName,
    dominantSpeakerId,
    isMicOn,
    isCameraOn,
    logs,
    clearLogs
  } = useRoomStore();

  const allParticipants = [
    {
      id: "local",
      name: userName || "You",
      isLocal: true,
      isMicOn,
      isCameraOn,
      isSpeaking: dominantSpeakerId === "local"
    },
    ...Object.values(peers).map(peer => ({
      id: peer.id,
      name: peer.name,
      isLocal: false,
      isMicOn: true, // We'd need to track this from signaling
      isCameraOn: true, // We'd need to track this from signaling
      isSpeaking: dominantSpeakerId === peer.id
    }))
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full sm:w-96 lg:w-80 bg-slate-800/95 backdrop-blur-sm border-l border-slate-700/50 flex flex-col z-20 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
        <h2 className="text-lg font-semibold text-white">Meeting Details</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-700/50"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as any)} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-2 bg-slate-700/50 m-4 mb-0">
          <TabsTrigger value="participants" className="text-xs">
            <Users className="w-4 h-4 mr-1" />
            People
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">
            <Terminal className="w-4 h-4 mr-1" />
            Logs
          </TabsTrigger>
        </TabsList>

        {/* Participants Tab */}
        <TabsContent value="participants" className="flex-1 flex flex-col m-0">
          <div className="p-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-300">
                In this meeting ({allParticipants.length})
              </span>
            </div>
          </div>

          <ScrollArea className="flex-1 px-4">
            <div className="space-y-2">
              {allParticipants.map((participant) => (
                <div
                  key={participant.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg transition-colors",
                    participant.isSpeaking
                      ? "bg-emerald-500/10 border border-emerald-500/20"
                      : "hover:bg-slate-700/30"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                    participant.isLocal
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-slate-600 text-slate-200"
                  )}>
                    {participant.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name and Status */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-medium truncate",
                        participant.isLocal ? "text-blue-400" : "text-white"
                      )}>
                        {participant.name}
                      </span>
                      {participant.isLocal && (
                        <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
                          You
                        </Badge>
                      )}
                      {participant.isSpeaking && (
                        <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      )}
                    </div>
                  </div>

                  {/* Media Status */}
                  <div className="flex items-center gap-1">
                    <div className={cn(
                      "w-6 h-6 rounded flex items-center justify-center",
                      participant.isMicOn
                        ? "text-slate-400"
                        : "bg-red-500/20 text-red-400"
                    )}>
                      {participant.isMicOn ? (
                        <Mic className="w-3 h-3" />
                      ) : (
                        <MicOff className="w-3 h-3" />
                      )}
                    </div>
                    <div className={cn(
                      "w-6 h-6 rounded flex items-center justify-center",
                      participant.isCameraOn
                        ? "text-slate-400"
                        : "bg-red-500/20 text-red-400"
                    )}>
                      {participant.isCameraOn ? (
                        <Video className="w-3 h-3" />
                      ) : (
                        <VideoOff className="w-3 h-3" />
                      )}
                    </div>
                    {!participant.isLocal && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-6 h-6 p-0 text-slate-400 hover:text-white hover:bg-slate-700/50"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="flex-1 flex flex-col m-0">
          <div className="p-4 pb-2 border-b border-slate-700/50">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Debug Logs</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearLogs}
                className="h-6 px-2 text-xs text-slate-400 hover:text-white hover:bg-slate-700/50"
              >
                Clear
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-1 font-mono text-xs">
              {logs.length === 0 ? (
                <div className="text-center text-slate-400 py-8">
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No logs yet</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 py-1">
                    <span className="text-slate-500 shrink-0 w-20">
                      {log.timestamp}
                    </span>
                    <span className={cn(
                      "break-all",
                      log.type === "success" && "text-emerald-400",
                      log.type === "error" && "text-red-400",
                      log.type === "warning" && "text-yellow-400",
                      log.type === "info" && "text-slate-300"
                    )}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

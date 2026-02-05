"use client";

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
    <div className="h-full w-full bg-background border-l border-border flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-base font-semibold text-foreground">Meeting Details</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as any)} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-2 bg-secondary p-1 m-4 mb-0 rounded-lg w-[calc(100%-2rem)]">
          <TabsTrigger value="participants" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
            <Users className="w-3.5 h-3.5 mr-1.5" />
            People
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
            <Terminal className="w-3.5 h-3.5 mr-1.5" />
            Logs
          </TabsTrigger>
        </TabsList>

        {/* Participants Tab */}
        <TabsContent value="participants" className="flex-1 flex flex-col m-0 min-h-0">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                In this meeting ({allParticipants.length})
              </span>
            </div>
          </div>

          <ScrollArea className="flex-1 px-4">
            <div className="space-y-1 pb-4">
              {allParticipants.map((participant) => (
                <div
                  key={participant.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg transition-colors border border-transparent",
                    participant.isSpeaking
                      ? "bg-secondary/40 border-primary/20"
                      : "hover:bg-secondary/30"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border",
                    participant.isLocal
                      ? "bg-secondary text-foreground border-border"
                      : "bg-muted text-muted-foreground border-transparent"
                  )}>
                    {participant.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Name and Status */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                            <span className={cn(
                                "text-sm font-medium truncate leading-none",
                                participant.isLocal ? "text-foreground" : "text-muted-foreground"
                            )}>
                                {participant.name}
                            </span>
                             {participant.isLocal && (
                                <span className="text-[10px] text-muted-foreground mt-1">You</span>
                            )}
                        </div>

                      {participant.isSpeaking && (
                        <div className="ml-auto w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                      )}
                    </div>
                  </div>

                  {/* Media Status */}
                  <div className="flex items-center gap-1">
                    <div className={cn(
                      "w-6 h-6 rounded flex items-center justify-center",
                      participant.isMicOn
                        ? "text-muted-foreground"
                        : "text-destructive"
                    )}>
                      {participant.isMicOn ? (
                        <Mic className="w-3.5 h-3.5" />
                      ) : (
                        <MicOff className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className={cn(
                      "w-6 h-6 rounded flex items-center justify-center",
                      participant.isCameraOn
                        ? "text-muted-foreground"
                        : "text-destructive"
                    )}>
                      {participant.isCameraOn ? (
                        <Video className="w-3.5 h-3.5" />
                      ) : (
                        <VideoOff className="w-3.5 h-3.5" />
                      )}
                    </div>
                    {!participant.isLocal && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-6 h-6 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="flex-1 flex flex-col m-0 min-h-0">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Debug Logs</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearLogs}
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-1 font-mono text-[10px]">
              {logs.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <Terminal className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>No activity recorded</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 py-1 border-b border-border/50 last:border-0 border-dashed">
                    <span className="text-muted-foreground/60 shrink-0 w-16">
                      {log.timestamp}
                    </span>
                    <span className={cn(
                      "break-all",
                      log.type === "success" && "text-foreground",
                      log.type === "error" && "text-destructive",
                      log.type === "warning" && "text-foreground", // Warning in monochrome? default to foreground
                      log.type === "info" && "text-muted-foreground"
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

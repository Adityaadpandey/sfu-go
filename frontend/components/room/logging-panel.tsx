"use client";

import { useRoomStore } from "@/store/useRoomStore";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X, Trash2 } from "lucide-react";

export function LoggingPanel() {
  const { logs, settings, clearLogs, updateSettings } = useRoomStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!settings.showLogs) return null;

  const getLogColor = (type: string) => {
    switch (type) {
      case "success": return "text-emerald-400";
      case "error": return "text-red-400";
      case "warning": return "text-yellow-400";
      default: return "text-zinc-400";
    }
  };

  return (
    <div className="bg-zinc-950 border-t border-zinc-800 h-32 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-300">Logs</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            className="h-6 px-2 text-zinc-400 hover:text-zinc-200"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateSettings({ showLogs: false })}
            className="h-6 px-2 text-zinc-400 hover:text-zinc-200"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs space-y-1"
      >
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-2">
            <span className="text-zinc-600 shrink-0">{log.timestamp}</span>
            <span className={cn("break-all", getLogColor(log.type))}>
              {log.message}
            </span>
          </div>
        ))}
        
        {logs.length === 0 && (
          <div className="text-zinc-500 text-center py-4">
            No logs yet
          </div>
        )}
      </div>
    </div>
  );
}
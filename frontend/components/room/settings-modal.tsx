"use client";

import { useRoomStore } from "@/store/useRoomStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

export function SettingsModal() {
  const { 
    showSettingsModal, 
    settings, 
    toggleSettingsModal, 
    updateSettings 
  } = useRoomStore();

  return (
    <Dialog open={showSettingsModal} onOpenChange={toggleSettingsModal}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="auto-quality" className="text-sm font-medium">
                Auto Quality
              </Label>
              <p className="text-xs text-zinc-400">
                Automatically switch to lower quality on poor connection
              </p>
            </div>
            <Switch
              id="auto-quality"
              checked={settings.autoQuality}
              onCheckedChange={(checked) => 
                updateSettings({ autoQuality: checked })
              }
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="show-stats" className="text-sm font-medium">
                Show Stats Overlay
              </Label>
              <p className="text-xs text-zinc-400">
                Display connection statistics on video tiles
              </p>
            </div>
            <Switch
              id="show-stats"
              checked={settings.showStats}
              onCheckedChange={(checked) => 
                updateSettings({ showStats: checked })
              }
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="show-logs" className="text-sm font-medium">
                Show Logs Panel
              </Label>
              <p className="text-xs text-zinc-400">
                Display debug logs at the bottom of the screen
              </p>
            </div>
            <Switch
              id="show-logs"
              checked={settings.showLogs}
              onCheckedChange={(checked) => 
                updateSettings({ showLogs: checked })
              }
            />
          </div>
        </div>
        
        <div className="flex justify-end pt-4">
          <Button 
            onClick={toggleSettingsModal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
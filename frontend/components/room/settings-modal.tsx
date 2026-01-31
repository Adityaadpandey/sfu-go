"use client";

import { useState } from "react";
import { useRoomStore } from "@/store/useRoomStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings, 
  Video, 
  Mic, 
  Monitor, 
  Wifi,
  Shield,
  Palette,
  Bell,
  Volume2
} from "lucide-react";

export function SettingsModal() {
  const { 
    showSettingsModal, 
    settings, 
    toggleSettingsModal, 
    updateSettings 
  } = useRoomStore();

  const [activeTab, setActiveTab] = useState("general");

  return (
    <Dialog open={showSettingsModal} onOpenChange={toggleSettingsModal}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader className="border-b border-slate-700 pb-4">
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Meeting Settings
          </DialogTitle>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-4 bg-slate-700/50">
            <TabsTrigger value="general" className="text-xs">
              <Settings className="w-4 h-4 mr-1" />
              General
            </TabsTrigger>
            <TabsTrigger value="audio" className="text-xs">
              <Mic className="w-4 h-4 mr-1" />
              Audio
            </TabsTrigger>
            <TabsTrigger value="video" className="text-xs">
              <Video className="w-4 h-4 mr-1" />
              Video
            </TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs">
              <Monitor className="w-4 h-4 mr-1" />
              Advanced
            </TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="flex-1 space-y-6 py-4">
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white">Connection & Quality</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-blue-400" />
                      Auto Quality Adjustment
                    </Label>
                    <p className="text-xs text-slate-400">
                      Automatically switch to lower quality when connection is poor
                    </p>
                  </div>
                  <Switch
                    checked={settings.autoQuality}
                    onCheckedChange={(checked) => 
                      updateSettings({ autoQuality: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-emerald-400" />
                      Show Connection Stats
                    </Label>
                    <p className="text-xs text-slate-400">
                      Display connection quality and packet loss information
                    </p>
                  </div>
                  <Switch
                    checked={settings.showStats}
                    onCheckedChange={(checked) => 
                      updateSettings({ showStats: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Shield className="w-4 h-4 text-yellow-400" />
                      Debug Logs Panel
                    </Label>
                    <p className="text-xs text-slate-400">
                      Show debug information and connection logs
                    </p>
                  </div>
                  <Switch
                    checked={settings.showLogs}
                    onCheckedChange={(checked) => 
                      updateSettings({ showLogs: checked })
                    }
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Audio Settings */}
          <TabsContent value="audio" className="flex-1 space-y-6 py-4">
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white">Audio Configuration</h3>
              
              <div className="space-y-4">
                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Mic className="w-4 h-4 text-blue-400" />
                    Microphone Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Noise Suppression</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Echo Cancellation</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Auto Gain Control</span>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    Speaker Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Speaker Test</span>
                      <Button size="sm" variant="outline" className="text-xs">
                        Test Audio
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Video Settings */}
          <TabsContent value="video" className="flex-1 space-y-6 py-4">
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white">Video Configuration</h3>
              
              <div className="space-y-4">
                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Video className="w-4 h-4 text-blue-400" />
                    Camera Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Mirror Local Video</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">HD Video Quality</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Low Light Enhancement</span>
                      <Switch />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Palette className="w-4 h-4 text-purple-400" />
                    Display Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Show Participant Names</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Highlight Active Speaker</span>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Advanced Settings */}
          <TabsContent value="advanced" className="flex-1 space-y-6 py-4">
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-white">Advanced Options</h3>
              
              <div className="space-y-4">
                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Monitor className="w-4 h-4 text-blue-400" />
                    Performance
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm text-slate-300">Hardware Acceleration</span>
                        <p className="text-xs text-slate-500">Use GPU for video processing</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm text-slate-300">Bandwidth Optimization</span>
                        <p className="text-xs text-slate-500">Reduce data usage on slow connections</p>
                      </div>
                      <Switch />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Bell className="w-4 h-4 text-yellow-400" />
                    Notifications
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Participant Join/Leave</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Connection Issues</span>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <Label className="text-sm font-medium text-red-400 mb-2 block">
                    Danger Zone
                  </Label>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Reset All Settings
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        
        <div className="flex justify-end pt-4 border-t border-slate-700">
          <Button 
            onClick={toggleSettingsModal}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
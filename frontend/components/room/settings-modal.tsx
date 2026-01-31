"use client";

import { useEffect, useMemo, useState } from "react";
import { useRoomStore } from "@/store/useRoomStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type MediaDeviceOption = { id: string; label: string };

function dedupeById(devices: MediaDeviceInfo[]) {
  const seen = new Set<string>();
  const out: MediaDeviceInfo[] = [];
  for (const d of devices) {
    if (!seen.has(d.deviceId)) {
      seen.add(d.deviceId);
      out.push(d);
    }
  }
  return out;
}

export function SettingsModal() {
  const { 
    showSettingsModal, 
    settings, 
    toggleSettingsModal, 
    updateSettings 
  } = useRoomStore();

  const [activeTab, setActiveTab] = useState("general");
  const [mics, setMics] = useState<MediaDeviceOption[]>([]);
  const [cams, setCams] = useState<MediaDeviceOption[]>([]);

  const canEnumerate = useMemo(() => typeof navigator !== "undefined" && !!navigator.mediaDevices?.enumerateDevices, []);

  useEffect(() => {
    if (!showSettingsModal) return;
    if (!canEnumerate) return;

    let mounted = true;

    const load = async () => {
      try {
        // Ensure labels are available (user might not have granted permissions yet)
        // If we can't get a stream, we can still show devices with empty labels.
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          tmp.getTracks().forEach(t => t.stop());
        } catch {
          // ignore
        }

        const devices = dedupeById(await navigator.mediaDevices.enumerateDevices());
        const micOpts = devices
          .filter(d => d.kind === "audioinput")
          .map((d, idx) => ({ id: d.deviceId, label: d.label || `Microphone ${idx + 1}` }));
        const camOpts = devices
          .filter(d => d.kind === "videoinput")
          .map((d, idx) => ({ id: d.deviceId, label: d.label || `Camera ${idx + 1}` }));

        if (!mounted) return;
        setMics(micOpts);
        setCams(camOpts);

        // If we have devices but no selection yet, default to first.
        if (!settings.selectedMicId && micOpts[0]?.id) {
          updateSettings({ selectedMicId: micOpts[0].id });
        }
        if (!settings.selectedCameraId && camOpts[0]?.id) {
          updateSettings({ selectedCameraId: camOpts[0].id });
        }
      } catch (e) {
        console.warn("Failed to enumerate devices", e);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [showSettingsModal, canEnumerate, settings.selectedMicId, settings.selectedCameraId, updateSettings]);

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
                    Input Device
                  </Label>
                  <Select
                    value={settings.selectedMicId}
                    onValueChange={(value) => updateSettings({ selectedMicId: value })}
                  >
                    <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                      <SelectValue placeholder={canEnumerate ? "Select microphone" : "Microphone selection unavailable"} />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-white">
                      {mics.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          No microphones found
                        </SelectItem>
                      ) : (
                        mics.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-400 mt-2">
                    Changing this will update your live mic track (no need to re-join).
                  </p>
                </div>

                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Mic className="w-4 h-4 text-blue-400" />
                    Microphone Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Noise Suppression</span>
                      <Switch
                        checked={settings.noiseSuppression}
                        onCheckedChange={(checked) => updateSettings({ noiseSuppression: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Echo Cancellation</span>
                      <Switch
                        checked={settings.echoCancellation}
                        onCheckedChange={(checked) => updateSettings({ echoCancellation: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Auto Gain Control</span>
                      <Switch
                        checked={settings.autoGainControl}
                        onCheckedChange={(checked) => updateSettings({ autoGainControl: checked })}
                      />
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
                    Camera Device
                  </Label>
                  <Select
                    value={settings.selectedCameraId}
                    onValueChange={(value) => updateSettings({ selectedCameraId: value })}
                  >
                    <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                      <SelectValue placeholder={canEnumerate ? "Select camera" : "Camera selection unavailable"} />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-white">
                      {cams.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          No cameras found
                        </SelectItem>
                      ) : (
                        cams.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.label}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-400 mt-2">
                    Changing this will update your live camera track (no need to re-join).
                  </p>
                </div>

                <div className="p-4 bg-slate-700/30 rounded-lg">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Video className="w-4 h-4 text-blue-400" />
                    Camera Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">Mirror Local Video</span>
                      <Switch
                        checked={settings.mirrorLocalVideo}
                        onCheckedChange={(checked) => updateSettings({ mirrorLocalVideo: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">HD Video Quality</span>
                      <Switch
                        checked={settings.hdVideo}
                        onCheckedChange={(checked) => updateSettings({ hdVideo: checked })}
                      />
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
"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRoomStore } from "@/store/useRoomStore";
import {
    Bell,
    Mic,
    Monitor,
    Palette,
    Settings,
    Shield,
    Video,
    Volume2,
    Wifi
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
      <DialogContent className="bg-background border-border text-foreground max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-xl font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Meeting Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-4 bg-secondary p-1">
            <TabsTrigger value="general" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
              <Settings className="w-3.5 h-3.5 mr-1" />
              General
            </TabsTrigger>
            <TabsTrigger value="audio" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
              <Mic className="w-3.5 h-3.5 mr-1" />
              Audio
            </TabsTrigger>
            <TabsTrigger value="video" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
              <Video className="w-3.5 h-3.5 mr-1" />
              Video
            </TabsTrigger>
            <TabsTrigger value="advanced" className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
              <Monitor className="w-3.5 h-3.5 mr-1" />
              Advanced
            </TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="flex-1 space-y-6 py-4">
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground">Connection & Quality</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-foreground" />
                      Auto Quality Adjustment
                    </Label>
                    <p className="text-xs text-muted-foreground">
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

                <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-foreground" />
                      Show Connection Stats
                    </Label>
                    <p className="text-xs text-muted-foreground">
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

                <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Shield className="w-4 h-4 text-foreground" />
                      Debug Logs Panel
                    </Label>
                    <p className="text-xs text-muted-foreground">
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
              <h3 className="text-lg font-medium text-foreground">Audio Configuration</h3>

              <div className="space-y-4">
                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Mic className="w-4 h-4 text-foreground" />
                    Input Device
                  </Label>
                  <Select
                    value={settings.selectedMicId}
                    onValueChange={(value) => updateSettings({ selectedMicId: value })}
                  >
                    <SelectTrigger className="bg-background border-input text-foreground">
                      <SelectValue placeholder={canEnumerate ? "Select microphone" : "Microphone selection unavailable"} />
                    </SelectTrigger>
                    <SelectContent className="bg-background border-border text-foreground">
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
                  <p className="text-xs text-muted-foreground mt-2">
                    Changing this will update your live mic track (no need to re-join).
                  </p>
                </div>

                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Mic className="w-4 h-4 text-foreground" />
                    Microphone Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Noise Suppression</span>
                      <Switch
                        checked={settings.noiseSuppression}
                        onCheckedChange={(checked) => updateSettings({ noiseSuppression: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Echo Cancellation</span>
                      <Switch
                        checked={settings.echoCancellation}
                        onCheckedChange={(checked) => updateSettings({ echoCancellation: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Auto Gain Control</span>
                      <Switch
                        checked={settings.autoGainControl}
                        onCheckedChange={(checked) => updateSettings({ autoGainControl: checked })}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Volume2 className="w-4 h-4 text-foreground" />
                    Speaker Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Speaker Test</span>
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
              <h3 className="text-lg font-medium text-foreground">Video Configuration</h3>

              <div className="space-y-4">
                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Video className="w-4 h-4 text-foreground" />
                    Camera Device
                  </Label>
                  <Select
                    value={settings.selectedCameraId}
                    onValueChange={(value) => updateSettings({ selectedCameraId: value })}
                  >
                    <SelectTrigger className="bg-background border-input text-foreground">
                      <SelectValue placeholder={canEnumerate ? "Select camera" : "Camera selection unavailable"} />
                    </SelectTrigger>
                    <SelectContent className="bg-background border-border text-foreground">
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
                  <p className="text-xs text-muted-foreground mt-2">
                    Changing this will update your live camera track (no need to re-join).
                  </p>
                </div>

                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Video className="w-4 h-4 text-foreground" />
                    Camera Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Mirror Local Video</span>
                      <Switch
                        checked={settings.mirrorLocalVideo}
                        onCheckedChange={(checked) => updateSettings({ mirrorLocalVideo: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">HD Video Quality</span>
                      <Switch
                        checked={settings.hdVideo}
                        onCheckedChange={(checked) => updateSettings({ hdVideo: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Low Light Enhancement</span>
                      <Switch />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Palette className="w-4 h-4 text-foreground" />
                    Display Settings
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Show Participant Names</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Highlight Active Speaker</span>
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
              <h3 className="text-lg font-medium text-foreground">Advanced Options</h3>

              <div className="space-y-4">
                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Monitor className="w-4 h-4 text-foreground" />
                    Performance
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm text-muted-foreground">Hardware Acceleration</span>
                        <p className="text-xs text-muted-foreground/60">Use GPU for video processing</p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm text-muted-foreground">Bandwidth Optimization</span>
                        <p className="text-xs text-muted-foreground/60">Reduce data usage on slow connections</p>
                      </div>
                      <Switch />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-secondary/20 rounded-lg border border-border/50">
                  <Label className="text-sm font-medium flex items-center gap-2 mb-3">
                    <Bell className="w-4 h-4 text-foreground" />
                    Notifications
                  </Label>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Participant Join/Leave</span>
                      <Switch defaultChecked />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Connection Issues</span>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <Label className="text-sm font-medium text-destructive mb-2 block">
                    Danger Zone
                  </Label>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Reset All Settings
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-4 border-t border-border">
          <Button
            onClick={toggleSettingsModal}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

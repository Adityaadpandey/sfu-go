"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWebRTCContext } from "@/components/webrtc-provider";
import { cn } from "@/lib/utils";
import { useRoomStore } from "@/store/useRoomStore";
import {
    CheckCircle2,
    Clock,
    Mic,
    MicOff,
    Settings,
    Shield,
    Users,
    Video,
    VideoOff,
    Zap
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState } from "react";

// Memoized video preview component to prevent re-renders
const VideoPreview = memo(({
  previewStream,
  isCameraOn,
  isMicOn,
  name,
  onToggleCamera,
  onToggleMic
}: {
  previewStream: MediaStream | null;
  isCameraOn: boolean;
  isMicOn: boolean;
  name: string;
  onToggleCamera: () => void;
  onToggleMic: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  return (
    <Card className="bg-muted/30 border-border overflow-hidden shadow-sm">
      <div className="relative aspect-video bg-black/90">
        {previewStream && isCameraOn ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary/10">
            <div className="w-24 h-24 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold text-3xl shadow-lg ring-4 ring-background">
              {name ? name.charAt(0).toUpperCase() : "?"}
            </div>
          </div>
        )}

        {/* Preview Controls */}
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-4 z-10">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-300 shadow-lg backdrop-blur-md",
              isCameraOn
                ? "bg-secondary/90 hover:bg-secondary text-secondary-foreground"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
            onClick={onToggleCamera}
          >
            {isCameraOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-12 w-12 rounded-full transition-all duration-300 shadow-lg backdrop-blur-md",
              isMicOn
                ? "bg-secondary/90 hover:bg-secondary text-secondary-foreground"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
            onClick={onToggleMic}
          >
            {isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </Button>
        </div>

        {/* Status Badges */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <Badge variant="secondary" className="bg-background/90 backdrop-blur-md text-foreground border-border/50 shadow-sm">
            Preview
          </Badge>
        </div>
      </div>
    </Card>
  );
});

VideoPreview.displayName = "VideoPreview";

export function JoinScreen() {
  const { connect } = useWebRTCContext();
  const { status, toggleSettingsModal, settings } = useRoomStore();
  const searchParams = useSearchParams();
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [userId] = useState(() => "user-" + Math.floor(Math.random() * 10000));
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  // Track if fields were manually edited to avoid overwriting with URL params
  const roomEditedRef = useRef(false);
  const nameEditedRef = useRef(false);

  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [mediaError, setMediaError] = useState<string | null>(null);

  const isConnecting = status === "connecting";

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Get preview stream only once
  useEffect(() => {
    let mounted = true;

    const getPreviewStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: settings.selectedCameraId ? { exact: settings.selectedCameraId } : undefined,
            width: settings.hdVideo ? 1280 : 640,
            height: settings.hdVideo ? 720 : 480,
            frameRate: 30
          },
          audio: {
            deviceId: settings.selectedMicId ? { exact: settings.selectedMicId } : undefined,
            noiseSuppression: settings.noiseSuppression,
            echoCancellation: settings.echoCancellation,
            autoGainControl: settings.autoGainControl,
          }
        });

        if (mounted) {
          previewStreamRef.current = stream;
          setPreviewStream(stream);
          setMediaError(null);
        }
      } catch (error) {
        console.error("Failed to get preview stream:", error);
        if (mounted) {
          setIsCameraOn(false);
          setIsMicOn(false);
          setMediaError("Camera and microphone access denied. Please allow permissions and refresh.");
        }
      }
    };

    getPreviewStream();

    return () => {
      mounted = false;
      const s = previewStreamRef.current;
      if (s) s.getTracks().forEach(track => track.stop());
      previewStreamRef.current = null;
    };
  }, [settings.selectedCameraId, settings.selectedMicId, settings.hdVideo, settings.noiseSuppression, settings.echoCancellation, settings.autoGainControl]);

  // Memoized toggle functions to prevent re-renders
  const toggleCamera = useCallback(() => {
    if (previewStream) {
      const videoTrack = previewStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isCameraOn;
        setIsCameraOn(!isCameraOn);
      }
    }
  }, [previewStream, isCameraOn]);

  const toggleMic = useCallback(() => {
    if (previewStream) {
      const audioTrack = previewStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isMicOn;
        setIsMicOn(!isMicOn);
      }
    }
  }, [previewStream, isMicOn]);

  const handleJoin = useCallback(() => {
    if (roomId && name && !isConnecting) {
      connect(roomId, userId, name);
    }
  }, [roomId, name, isConnecting, connect, userId]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && roomId && name && !isConnecting) {
      handleJoin();
    }
  }, [roomId, name, isConnecting, handleJoin]);

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    nameEditedRef.current = true;
    setName(e.target.value);
  }, []);

  const handleRoomIdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    roomEditedRef.current = true;
    setRoomId(e.target.value);
  }, []);

  // Prefill fields from URL query
  useEffect(() => {
    const roomFromUrl = searchParams.get("room") || searchParams.get("roomId") || "";
    const nameFromUrl = searchParams.get("name") || searchParams.get("username") || "";

    if (roomFromUrl && !roomEditedRef.current) {
      setRoomId(roomFromUrl);
    }

    if (nameFromUrl && !nameEditedRef.current) {
      setName(nameFromUrl);
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 lg:p-8 bg-background">
      <div className="w-full max-w-6xl grid lg:grid-cols-5 gap-8 xl:gap-12 items-center">
        {/* Left Side - Branding & Info */}
        <div className="lg:col-span-2 space-y-8 text-center lg:text-left">
          <div className="space-y-6">
            <div className="flex items-center justify-center lg:justify-start gap-3">
              <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg hover:rotate-3 transition-transform duration-300">
                <Video className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="select-none">
                <h1 className="text-3xl font-bold tracking-tight text-foreground">VideoMeet</h1>
                <p className="text-muted-foreground text-sm font-medium">Professional Conferencing</p>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground leading-tight">
                Connect with <br className="hidden lg:block"/>
                <span className="text-primary/80">clarity and speed</span>
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed max-w-md mx-auto lg:mx-0">
                A simple, secure, and high-performance video meeting platform designed for modern teams.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto lg:mx-0">
            {[
              { icon: Shield, title: "Secure", desc: "End-to-end encrypted" },
              { icon: Zap, title: "Fast", desc: "Low latency audio/video" },
              { icon: Users, title: "Scalable", desc: "Crystal clear quality" },
              { icon: CheckCircle2, title: "Simple", desc: "No downloads needed" },
            ].map((feature, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg border border-border/40 hover:bg-secondary/20 transition-colors">
                <feature.icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground">{feature.title}</p>
                  <p className="text-xs text-muted-foreground">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center lg:justify-start gap-2.5 text-muted-foreground bg-secondary/30 w-fit mx-auto lg:mx-0 px-4 py-2 rounded-full border border-border/50">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">
              {currentTime.toLocaleString([], {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
                day: 'numeric'
              })}
            </span>
          </div>
        </div>

        {/* Right Side - Join Form & Preview */}
        <div className="lg:col-span-3 space-y-6">
          {/* Video Preview */}
          {mediaError ? (
            <Card className="bg-muted/30 border-dashed border-2 border-border/60 shadow-none">
              <div className="aspect-video bg-muted/10 flex items-center justify-center p-8">
                <div className="text-center text-muted-foreground max-w-xs">
                  <VideoOff className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm font-semibold mb-2">Camera Access Restricted</p>
                  <p className="text-xs opacity-80">{mediaError}</p>
                </div>
              </div>
            </Card>
          ) : (
            <VideoPreview
              previewStream={previewStream}
              isCameraOn={isCameraOn}
              isMicOn={isMicOn}
              name={name}
              onToggleCamera={toggleCamera}
              onToggleMic={toggleMic}
            />
          )}

          {/* Join Form */}
          <Card className="bg-card border-border shadow-2xl relative overflow-hidden">
             {/* Decorative top border */}
            <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-primary/50 to-secondary-foreground/50" />

            <CardHeader className="text-center pb-2">
              <CardTitle className="text-xl text-foreground">Ready to join?</CardTitle>
              <CardDescription className="text-muted-foreground">
                Check your settings and jump in.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-6 pt-2">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                    Display Name
                  </Label>
                  <div className="relative">
                    <Input
                      id="name"
                      placeholder="e.g. Alice Smith"
                      value={name}
                      onChange={handleNameChange}
                      onKeyPress={handleKeyPress}
                      className="bg-secondary/40 border-border/60 pl-4 h-11 focus:ring-primary/20 focus:border-primary transition-all"
                      disabled={isConnecting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="room" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                    Meeting ID
                  </Label>
                  <div className="relative">
                    <Input
                      id="room"
                      placeholder="e.g. room-123"
                      value={roomId}
                      onChange={handleRoomIdChange}
                      onKeyPress={handleKeyPress}
                      className="bg-secondary/40 border-border/60 pl-4 h-11 focus:ring-primary/20 focus:border-primary transition-all font-mono text-sm"
                      disabled={isConnecting}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <Button
                  className="w-full font-bold text-base h-12 shadow-lg shadow-primary/10 hover:shadow-primary/20 transition-all active:scale-[0.99]"
                  onClick={handleJoin}
                  disabled={!roomId || !name || isConnecting}
                  size="lg"
                >
                  {isConnecting ? (
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Connecting...
                    </div>
                  ) : (
                    "Join Meeting Now"
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed text-muted-foreground hover:text-foreground h-10 hover:bg-secondary/50 hover:border-solid transition-all"
                  onClick={toggleSettingsModal}
                  disabled={isConnecting}
                >
                  <Settings className="w-3.5 h-3.5 mr-2" />
                  Confirm Audio/Video Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

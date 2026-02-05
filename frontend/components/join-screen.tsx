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
    Calendar,
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
    <Card className="bg-muted/30 border-border overflow-hidden">
      <div className="relative aspect-video bg-black">
        {previewStream && isCameraOn ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary/20">
            <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold text-2xl">
              {name ? name.charAt(0).toUpperCase() : "?"}
            </div>
          </div>
        )}

        {/* Preview Controls */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 w-10 rounded-full transition-all duration-200 border",
              isCameraOn
                ? "bg-secondary/80 hover:bg-secondary text-secondary-foreground border-transparent"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent"
            )}
            onClick={onToggleCamera}
          >
            {isCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 w-10 rounded-full transition-all duration-200 border",
              isMicOn
                ? "bg-secondary/80 hover:bg-secondary text-secondary-foreground border-transparent"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90 border-transparent"
            )}
            onClick={onToggleMic}
          >
            {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
        </div>

        {/* Status Badges */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm text-foreground border-border">
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
  const roomEditedRef = useRef(false);
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
    setName(e.target.value);
  }, []);

  const handleRoomIdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    roomEditedRef.current = true;
    setRoomId(e.target.value);
  }, []);

  // Prefill room from URL query
  useEffect(() => {
    const fromUrl = searchParams.get("room") || searchParams.get("roomId") || "";
    if (!fromUrl) return;
    if (roomEditedRef.current) return;
    setRoomId(fromUrl);
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        {/* Left Side - Branding & Info */}
        <div className="space-y-8 text-center lg:text-left">
          <div className="space-y-4">
            <div className="flex items-center justify-center lg:justify-start gap-3">
              <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg">
                <Video className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="select-none">
                <h1 className="text-3xl font-bold text-foreground">VideoMeet</h1>
                <p className="text-muted-foreground text-sm">Professional Video Conferencing</p>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-foreground">
                Connect with your team
              </h2>
              <p className="text-muted-foreground text-lg">
                High-quality video calls with advanced features for modern teams
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
              <Shield className="w-5 h-5 text-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Secure</p>
                <p className="text-xs text-muted-foreground">End-to-end encrypted</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
              <Zap className="w-5 h-5 text-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Fast</p>
                <p className="text-xs text-muted-foreground">Low latency calls</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
              <Users className="w-5 h-5 text-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Scalable</p>
                <p className="text-xs text-muted-foreground">Up to 100 participants</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
              <Calendar className="w-5 h-5 text-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Reliable</p>
                <p className="text-xs text-muted-foreground">99.9% uptime</p>
              </div>
            </div>
          </div>

          {/* Current Time */}
          <div className="flex items-center justify-center lg:justify-start gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span className="text-sm">
              {currentTime.toLocaleString([], {
                weekday: 'long',
                hour: '2-digit',
                minute: '2-digit',
                month: 'short',
                day: 'numeric'
              })}
            </span>
          </div>
        </div>

        {/* Right Side - Join Form & Preview */}
        <div className="space-y-6">
          {/* Video Preview */}
          {mediaError ? (
            <Card className="bg-muted/30 border-border">
              <div className="aspect-video bg-muted/50 flex items-center justify-center p-6">
                <div className="text-center text-muted-foreground">
                  <VideoOff className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm mb-2">Camera Preview Unavailable</p>
                  <p className="text-xs">{mediaError}</p>
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
          <Card className="bg-card border-border shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-xl text-foreground">Join Meeting</CardTitle>
              <CardDescription className="text-muted-foreground">
                Enter your details to join the video conference
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-foreground">
                  Your Name
                </Label>
                <Input
                  id="name"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={handleNameChange}
                  onKeyPress={handleKeyPress}
                  className="bg-secondary/50 border-input text-foreground placeholder:text-muted-foreground focus:ring-primary focus:border-primary"
                  disabled={isConnecting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="room" className="text-sm font-medium text-foreground">
                  Meeting ID
                </Label>
                <Input
                  id="room"
                  placeholder="Enter meeting ID or room name"
                  value={roomId}
                  onChange={handleRoomIdChange}
                  onKeyPress={handleKeyPress}
                  className="bg-secondary/50 border-input text-foreground placeholder:text-muted-foreground focus:ring-primary focus:border-primary"
                  disabled={isConnecting}
                />
              </div>

              <Button
                className="w-full font-semibold py-3 transition-all duration-200 shadow-md hover:shadow-lg"
                onClick={handleJoin}
                disabled={!roomId || !name || isConnecting}
              >
                {isConnecting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Connecting...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4" />
                    Join Meeting
                  </div>
                )}
              </Button>

              <div className="text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={toggleSettingsModal}
                  disabled={isConnecting}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Audio & Video Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWebRTCContext } from "@/components/webrtc-provider";
import { useRoomStore } from "@/store/useRoomStore";
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  Settings, 
  Users,
  Calendar,
  Clock,
  Shield,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    <Card className="bg-slate-800/50 border-slate-700/50 overflow-hidden">
      <div className="relative aspect-video bg-slate-900">
        {previewStream && isCameraOn ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover transform scale-x-[-1]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-2xl">
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
              "h-10 w-10 rounded-full transition-all duration-200",
              isCameraOn 
                ? "bg-slate-700/50 hover:bg-slate-600/50 text-white" 
                : "bg-red-500 hover:bg-red-600 text-white"
            )}
            onClick={onToggleCamera}
          >
            {isCameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-10 w-10 rounded-full transition-all duration-200",
              isMicOn 
                ? "bg-slate-700/50 hover:bg-slate-600/50 text-white" 
                : "bg-red-500 hover:bg-red-600 text-white"
            )}
            onClick={onToggleMic}
          >
            {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
        </div>

        {/* Status Badges */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
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
  const { status } = useRoomStore();
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [userId] = useState(() => "user-" + Math.floor(Math.random() * 10000));
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
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
          video: { width: 640, height: 480, frameRate: 30 },
          audio: true
        });
        
        if (mounted) {
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
      if (previewStream) {
        previewStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Empty dependency array - only run once

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

  // Memoized input change handlers to prevent VideoPreview re-renders
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
  }, []);

  const handleRoomIdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRoomId(e.target.value);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        {/* Left Side - Branding & Info */}
        <div className="space-y-8 text-center lg:text-left">
          <div className="space-y-4">
            <div className="flex items-center justify-center lg:justify-start gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Video className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">VideoMeet</h1>
                <p className="text-slate-400 text-sm">Professional Video Conferencing</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-white">
                Connect with your team
              </h2>
              <p className="text-slate-400 text-lg">
                High-quality video calls with advanced features for modern teams
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <Shield className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-white">Secure</p>
                <p className="text-xs text-slate-400">End-to-end encrypted</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <Zap className="w-5 h-5 text-yellow-400" />
              <div>
                <p className="text-sm font-medium text-white">Fast</p>
                <p className="text-xs text-slate-400">Low latency calls</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <Users className="w-5 h-5 text-blue-400" />
              <div>
                <p className="text-sm font-medium text-white">Scalable</p>
                <p className="text-xs text-slate-400">Up to 100 participants</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <Calendar className="w-5 h-5 text-purple-400" />
              <div>
                <p className="text-sm font-medium text-white">Reliable</p>
                <p className="text-xs text-slate-400">99.9% uptime</p>
              </div>
            </div>
          </div>

          {/* Current Time */}
          <div className="flex items-center justify-center lg:justify-start gap-2 text-slate-400">
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
            <Card className="bg-slate-800/50 border-slate-700/50">
              <div className="aspect-video bg-slate-900 flex items-center justify-center p-6">
                <div className="text-center text-slate-400">
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
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardHeader className="text-center">
              <CardTitle className="text-xl text-white">Join Meeting</CardTitle>
              <CardDescription className="text-slate-400">
                Enter your details to join the video conference
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-slate-300">
                  Your Name
                </Label>
                <Input
                  id="name"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={handleNameChange}
                  onKeyPress={handleKeyPress}
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20"
                  disabled={isConnecting}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="room" className="text-sm font-medium text-slate-300">
                  Meeting ID
                </Label>
                <Input
                  id="room"
                  placeholder="Enter meeting ID or room name"
                  value={roomId}
                  onChange={handleRoomIdChange}
                  onKeyPress={handleKeyPress}
                  className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500/20"
                  disabled={isConnecting}
                />
              </div>

              <Button
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-3 transition-all duration-200 shadow-lg hover:shadow-xl"
                onClick={handleJoin}
                disabled={!roomId || !name || isConnecting}
              >
                {isConnecting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                  className="text-slate-400 hover:text-white"
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

'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWebRTCContext } from '@/components/webrtc-provider';
import { cn } from '@/lib/utils';
import { useRoomStore } from '@/store/useRoomStore';
import { Mic, MicOff, Settings, Video, VideoOff } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

export function JoinScreen() {
  const { connect } = useWebRTCContext();
  const { status, toggleSettingsModal, settings } = useRoomStore();
  const searchParams = useSearchParams();
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [userId] = useState(() => 'user-' + Math.floor(Math.random() * 10000));
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const roomEditedRef = useRef(false);
  const nameEditedRef = useRef(false);

  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const isConnecting = status === 'connecting';

  useEffect(() => {
    let mounted = true;

    const getPreviewStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: settings.selectedCameraId ? { exact: settings.selectedCameraId } : undefined,
            width: settings.hdVideo ? 1280 : 640,
            height: settings.hdVideo ? 720 : 480,
            frameRate: 30,
          },
          audio: {
            deviceId: settings.selectedMicId ? { exact: settings.selectedMicId } : undefined,
            noiseSuppression: settings.noiseSuppression,
            echoCancellation: settings.echoCancellation,
            autoGainControl: settings.autoGainControl,
          },
        });

        if (mounted) {
          previewStreamRef.current = stream;
          setPreviewStream(stream);
          setMediaError(null);
        }
      } catch (error) {
        console.error('Failed to get preview stream:', error);
        if (mounted) {
          setIsCameraOn(false);
          setIsMicOn(false);
          setMediaError('Camera/mic access denied');
        }
      }
    };

    getPreviewStream();

    return () => {
      mounted = false;
      const s = previewStreamRef.current;
      if (s) s.getTracks().forEach((track) => track.stop());
      previewStreamRef.current = null;
    };
  }, [
    settings.selectedCameraId,
    settings.selectedMicId,
    settings.hdVideo,
    settings.noiseSuppression,
    settings.echoCancellation,
    settings.autoGainControl,
  ]);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

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

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && roomId && name && !isConnecting) {
        handleJoin();
      }
    },
    [roomId, name, isConnecting, handleJoin]
  );

  useEffect(() => {
    const roomFromUrl = searchParams.get('room') || searchParams.get('roomId') || '';
    const nameFromUrl = searchParams.get('name') || searchParams.get('username') || '';
    if (roomFromUrl && !roomEditedRef.current) setRoomId(roomFromUrl);
    if (nameFromUrl && !nameEditedRef.current) setName(nameFromUrl);
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-8 bg-background">
      {/* Main Container */}
      <div className="w-full max-w-5xl border border-white/10 rounded-3xl p-8 md:p-10">
        <div className="flex flex-col lg:flex-row gap-8 items-center">
          {/* Left: Video Preview */}
          <div className="flex-1 w-full">
            <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-lg">
              <div className="aspect-video relative bg-black/60 backdrop-blur-sm">
                {mediaError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center">
                      <VideoOff className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground text-sm mt-4">{mediaError}</p>
                  </div>
                ) : previewStream && isCameraOn ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-xl">
                      <span className="text-4xl font-medium text-foreground">
                        {name ? name.charAt(0).toUpperCase() : '?'}
                      </span>
                    </div>
                    {name && <p className="text-muted-foreground text-sm mt-4">{name}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Join Form - Centered vertically */}
          <div className="w-full lg:w-80 flex flex-col items-center justify-center text-center p-8">
            <h2 className="text-2xl font-semibold text-foreground mb-8">Join Meeting</h2>

            <div className="w-full space-y-4">
              <Input
                placeholder="Your Name"
                value={name}
                onChange={(e) => {
                  nameEditedRef.current = true;
                  setName(e.target.value);
                }}
                onKeyPress={handleKeyPress}
                className="h-12 text-base text-center rounded-xl bg-white/[0.03] border border-white/20 text-foreground placeholder:text-muted-foreground/60 focus:bg-white/[0.06] focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                disabled={isConnecting}
              />
              <Input
                placeholder="Meeting Code"
                value={roomId}
                onChange={(e) => {
                  roomEditedRef.current = true;
                  setRoomId(e.target.value);
                }}
                onKeyPress={handleKeyPress}
                className="h-12 text-base text-center rounded-xl bg-white/[0.03] border border-white/20 text-foreground placeholder:text-muted-foreground/60 font-mono focus:bg-white/[0.06] focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                disabled={isConnecting}
              />
              <Button
                className="w-full h-12 text-base font-semibold rounded-xl"
                onClick={handleJoin}
                disabled={!roomId || !name || isConnecting}
              >
                {isConnecting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Joining...
                  </div>
                ) : (
                  'Join Now'
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Controls - Glass with subtle hue */}
        <div className="flex justify-center mt-8">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-purple-500/10 via-white/5 to-blue-500/10 backdrop-blur-2xl border border-white/15 shadow-[0_0_40px_rgba(139,92,246,0.15)]">
            <Button
              size="icon"
              className={cn(
                'h-14 w-14 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 shadow-md hover:shadow-lg transition-all duration-200 text-foreground',
                !isMicOn && 'bg-red-500/30 text-red-400 hover:bg-red-500/40 border-red-500/40'
              )}
              onClick={toggleMic}
            >
              {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </Button>
            <Button
              size="icon"
              className={cn(
                'h-14 w-14 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 shadow-md hover:shadow-lg transition-all duration-200 text-foreground',
                !isCameraOn && 'bg-red-500/30 text-red-400 hover:bg-red-500/40 border-red-500/40'
              )}
              onClick={toggleCamera}
            >
              {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </Button>
            <div className="w-px h-10 bg-white/15 mx-1" />
            <Button
              size="icon"
              className="h-14 w-14 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 shadow-md hover:shadow-lg transition-all duration-200 text-foreground"
              onClick={toggleSettingsModal}
            >
              <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

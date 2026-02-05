import { create } from "zustand";
import { Peer, RoomStatus, TrackInfo, ConnectionQuality } from "../types";

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

interface Settings {
  autoQuality: boolean;
  showStats: boolean;
  showLogs: boolean;
  selectedMicId?: string;
  selectedCameraId?: string;
  mirrorLocalVideo: boolean;
  hdVideo: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

interface RoomState {
    roomId: string | null;
    userId: string | null;
    userName: string | null;
    status: RoomStatus;

    // Confirmed participants
    peers: Record<string, Peer>;

    // Media State
    localStream: MediaStream | null;
    remoteStreams: Record<string, MediaStream[]>; // Map<PeerID, Streams>

    // Tracks (simplified view for UI)
    tracks: Record<string, TrackInfo[]>; // Map<PeerID, Tracks>

    // Quality tracking
    peerQuality: Record<string, ConnectionQuality>;
    simulcastLayers: Record<string, string[]>; // trackId -> available layers

    // UI State
    dominantSpeakerId: string | null;
    isMicOn: boolean;
    isCameraOn: boolean;
    isScreenShareOn: boolean;
    
    // Logging
    logs: LogEntry[];
    
    // Settings
    settings: Settings;
    showSettingsModal: boolean;

    // Stats
    trackCount: number;

    // Session management
    sessionId: string | null;
    sessionToken: string | null;

    // Actions
    setRoomInfo: (roomId: string, userId: string, name: string) => void;
    setStatus: (status: RoomStatus) => void;
    addPeer: (peer: Peer) => void;
    removePeer: (peerId: string) => void;

    setLocalStream: (stream: MediaStream | null) => void;
    addRemoteTrack: (peerId: string, track: MediaStreamTrack, stream: MediaStream) => void;
    removeRemoteTrack: (peerId: string, trackId: string) => void;

    setMediaState: (type: "mic" | "camera" | "screen", isOn: boolean) => void;
    setDominantSpeaker: (peerId: string | null) => void;
    
    // Quality & Stats
    setPeerQuality: (peerId: string, quality: ConnectionQuality) => void;
    setSimulcastLayers: (trackId: string, layers: string[]) => void;
    setTrackCount: (count: number) => void;
    
    // Logging
    addLog: (message: string, type?: LogEntry["type"]) => void;
    clearLogs: () => void;
    
    // Settings
    updateSettings: (settings: Partial<Settings>) => void;
    toggleSettingsModal: () => void;

    // Session
    setSessionInfo: (sessionId: string, sessionToken: string) => void;
    clearSessionInfo: () => void;

    reset: () => void;
}

const initialSettings: Settings = {
  autoQuality: true,
  showStats: false,
  showLogs: true,
  selectedMicId: undefined,
  selectedCameraId: undefined,
  mirrorLocalVideo: true,
  hdVideo: true,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

export const useRoomStore = create<RoomState>((set, get) => ({
    roomId: null,
    userId: null,
    userName: null,
    status: "idle",
    peers: {},
    localStream: null,
    remoteStreams: {},
    tracks: {},
    peerQuality: {},
    simulcastLayers: {},
    dominantSpeakerId: null,
    isMicOn: true,
    isCameraOn: true,
    isScreenShareOn: false,
    logs: [],
    settings: initialSettings,
    showSettingsModal: false,
    trackCount: 0,
    sessionId: null,
    sessionToken: null,

    setRoomInfo: (roomId, userId, name) => set({ roomId, userId, userName: name }),
    
    setStatus: (status) => set({ status }),
    
    addPeer: (peer) => set((state) => ({
        peers: { ...state.peers, [peer.id]: peer }
    })),
    
    removePeer: (peerId) => set((state) => {
        const { [peerId]: removed, ...peers } = state.peers;
        const { [peerId]: removedStreams, ...remoteStreams } = state.remoteStreams;
        const { [peerId]: removedTracks, ...tracks } = state.tracks;
        const { [peerId]: removedQuality, ...peerQuality } = state.peerQuality;
        
        return { peers, remoteStreams, tracks, peerQuality };
    }),

    setLocalStream: (stream) => set({ localStream: stream }),
    
    addRemoteTrack: (peerId, track, stream) => set((state) => {
        const existingStreams = state.remoteStreams[peerId] || [];
        const streamExists = existingStreams.some(s => s.id === stream.id);
        
        const remoteStreams = {
            ...state.remoteStreams,
            [peerId]: streamExists ? existingStreams : [...existingStreams, stream]
        };
        
        return { remoteStreams, trackCount: state.trackCount + 1 };
    }),
    
    removeRemoteTrack: (peerId, trackId) => set((state) => {
        const streams = state.remoteStreams[peerId] || [];
        const updatedStreams = streams.filter(stream => 
            !stream.getTracks().some(track => track.id === trackId)
        );
        
        return {
            remoteStreams: {
                ...state.remoteStreams,
                [peerId]: updatedStreams
            },
            trackCount: Math.max(0, state.trackCount - 1)
        };
    }),

    setMediaState: (type, isOn) => set((state) => {
        switch (type) {
            case "mic": return { isMicOn: isOn };
            case "camera": return { isCameraOn: isOn };
            case "screen": return { isScreenShareOn: isOn };
            default: return state;
        }
    }),
    
    setDominantSpeaker: (peerId) => set({ dominantSpeakerId: peerId }),
    
    setPeerQuality: (peerId, quality) => set((state) => ({
        peerQuality: { ...state.peerQuality, [peerId]: quality }
    })),
    
    setSimulcastLayers: (trackId, layers) => set((state) => ({
        simulcastLayers: { ...state.simulcastLayers, [trackId]: layers }
    })),
    
    setTrackCount: (count) => set({ trackCount: count }),
    
    addLog: (message, type = "info") => set((state) => {
        const log: LogEntry = {
            id: Date.now().toString(),
            timestamp: new Date().toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            }),
            message,
            type
        };
        
        const logs = [...state.logs, log];
        // Keep only last 200 logs
        if (logs.length > 200) {
            logs.shift();
        }
        
        return { logs };
    }),
    
    clearLogs: () => set({ logs: [] }),
    
    updateSettings: (newSettings) => set((state) => ({
        settings: { ...state.settings, ...newSettings }
    })),
    
    toggleSettingsModal: () => set((state) => ({
        showSettingsModal: !state.showSettingsModal
    })),

    setSessionInfo: (sessionId, sessionToken) => set({ sessionId, sessionToken }),
    clearSessionInfo: () => set({ sessionId: null, sessionToken: null }),

    reset: () => set({
        roomId: null,
        userId: null,
        userName: null,
        status: "idle",
        peers: {},
        localStream: null,
        remoteStreams: {},
        tracks: {},
        peerQuality: {},
        simulcastLayers: {},
        dominantSpeakerId: null,
        isMicOn: true,
        isCameraOn: true,
        isScreenShareOn: false,
        trackCount: 0,
        logs: [],
        showSettingsModal: false,
        sessionId: null,
        sessionToken: null,
    })
}));
   
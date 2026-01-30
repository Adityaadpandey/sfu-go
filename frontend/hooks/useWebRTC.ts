import { useCallback, useEffect, useRef } from "react";
import { useRoomStore } from "../store/useRoomStore";
import { SignalingMessage, ConnectionQuality } from "../types";

const WS_URL = "ws://localhost:8080/ws";

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
    bundlePolicy: "max-bundle" as RTCBundlePolicy,
    rtcpMuxPolicy: "require" as RTCRtcpMuxPolicy,
};

export const useWebRTC = () => {
    const {
        setStatus,
        addPeer,
        removePeer,
        setLocalStream,
        addRemoteTrack,
        removeRemoteTrack,
        setDominantSpeaker,
        isMicOn,
        isCameraOn,
        isScreenShareOn,
        setMediaState,
        setRoomInfo,
        setPeerQuality,
        setSimulcastLayers,
        setTrackCount,
        addLog,
        settings,
        reset,
    } = useRoomStore();

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Negotiation state
    const negRef = useRef(false);       // _neg
    const negPendRef = useRef(false);   // _negPend
    const negReadyRef = useRef(false);  // _negReady
    const iceBufRef = useRef<RTCIceCandidateInit[]>([]);

    // Connection info for reconnects
    const connectionInfo = useRef({ roomId: "", userId: "", name: "" });
    const peerIdRef = useRef<string>("");

    // --- Logging Helper ---
    const log = useCallback((message: string, type: "info" | "success" | "warning" | "error" = "info") => {
        console.log(`[WebRTC] ${message}`);
        addLog(message, type);
    }, [addLog]);

    // --- Helper Functions (declared first to avoid hoisting issues) ---
    const cleanup = useCallback(() => {
        if (statsIntervalRef.current) {
            clearInterval(statsIntervalRef.current);
            statsIntervalRef.current = null;
        }
        
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        
        negRef.current = false;
        negPendRef.current = false;
        negReadyRef.current = false;
        iceBufRef.current = [];
        peerIdRef.current = "";
    }, []);

    const sendSignalingMessage = useCallback((msg: SignalingMessage | { type: string, data?: unknown }) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // The server expects the 'data' field to be a JSON string
            const payload = {
                type: msg.type,
                data: JSON.stringify(msg.data || {}),
                timestamp: new Date().toISOString()
            };
            wsRef.current.send(JSON.stringify(payload));
        } else {
            log("WebSocket not open, cannot send " + msg.type, "warning");
        }
    }, [log]);

    // --- WebRTC Handling ---
    const negotiate = useCallback(async () => {
        if (negRef.current || !pcRef.current) return;

        negRef.current = true;
        negPendRef.current = false;

        try {
            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);

            sendSignalingMessage({
                type: "offer",
                data: {
                    sdp: offer.sdp!,
                    type: "offer",
                    peerId: peerIdRef.current
                }
            });
        } catch (e) {
            log("Offer error: " + e, "error");
            negRef.current = false;
            // Retry if needed
            if (negPendRef.current) {
                setTimeout(() => negotiate(), 50);
            }
        }
    }, [sendSignalingMessage, log]);

    const createPeerConnection = useCallback(async () => {
        if (pcRef.current) return;

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        // Initialize Local Media
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { width: 640, height: 480, frameRate: 30 },
            });

            localStreamRef.current = stream;
            setLocalStream(stream);
            log("Camera + mic acquired", "success");

            // Safety check: if PC was closed during getUserMedia
            if (pc.signalingState === 'closed') {
                log("PC closed during getUserMedia", "warning");
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];

            if (videoTrack) {
                pc.addTransceiver(videoTrack, {
                    direction: 'sendrecv',
                    sendEncodings: [
                        { rid: 'h', maxBitrate: 1500000 },
                        { rid: 'm', maxBitrate: 500000, scaleResolutionDownBy: 2 },
                        { rid: 'l', maxBitrate: 150000, scaleResolutionDownBy: 4 }
                    ]
                });
            }

            if (audioTrack) {
                pc.addTrack(audioTrack, stream);
            }

            // Pre-allocate recvonly transceivers for potential remote peers
            // 3 audio and 3 video as per reference implementation
            for (let i = 0; i < 3; i++) pc.addTransceiver('video', { direction: 'recvonly' });
            for (let i = 0; i < 3; i++) pc.addTransceiver('audio', { direction: 'recvonly' });

        } catch (err) {
            log("Media error: " + err, "error");
            return;
        }

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignalingMessage({
                    type: "ice-candidate",
                    data: {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid!,
                        sdpMLineIndex: event.candidate.sdpMLineIndex!,
                        peerId: peerIdRef.current
                    },
                });
            }
        };

        pc.ontrack = (event) => {
            const stream = event.streams[0] || new MediaStream();
            if (event.streams.length === 0) {
                stream.addTrack(event.track);
            }
            // Convention: stream.id is the source peerID
            const sourcePeerId = stream.id;

            log(`Video: ${sourcePeerId.slice(0, 8)}`, "success");
            addRemoteTrack(sourcePeerId, event.track, stream);
            
            // Update track count
            const currentCount = useRoomStore.getState().trackCount;
            setTrackCount(currentCount + 1);

            event.track.onended = () => {
                removeRemoteTrack(sourcePeerId, event.track.id);
                const currentCount = useRoomStore.getState().trackCount;
                setTrackCount(Math.max(0, currentCount - 1));
            };
        };

        pc.onnegotiationneeded = () => {
            // If we just gathered ICE candidates or added tracks, we need to negotiate
            if (!negReadyRef.current) return;
            if (negRef.current) {
                negPendRef.current = true;
                return;
            }
            negotiate();
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            log("Connection: " + state, state === 'connected' ? "success" : "info");
            if (state === 'connected') {
                startStatsTracking();
                if (negPendRef.current) {
                    negPendRef.current = false;
                    negotiate();
                }
            } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
                if (statsIntervalRef.current) {
                    clearInterval(statsIntervalRef.current);
                    statsIntervalRef.current = null;
                }
            }
        };

        // Start initial negotiation
        await negotiate();
    }, [setLocalStream, log, sendSignalingMessage, addRemoteTrack, setTrackCount, removeRemoteTrack, negotiate]);

    // --- Quality Stats Tracking ---
    const startStatsTracking = useCallback(() => {
        if (!pcRef.current || statsIntervalRef.current) return;

        statsIntervalRef.current = setInterval(async () => {
            if (!pcRef.current) return;

            try {
                const stats = await pcRef.current.getStats();
                const inboundStats: RTCInboundRtpStreamStats[] = [];
                const outboundStats: RTCOutboundRtpStreamStats[] = [];

                stats.forEach((report) => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        inboundStats.push(report as RTCInboundRtpStreamStats);
                    } else if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        outboundStats.push(report as RTCOutboundRtpStreamStats);
                    }
                });

                // Calculate quality for local peer (outbound)
                if (outboundStats.length > 0) {
                    // Note: packetsLost might not be available on outbound stats
                    const lossRate = 0; // For outbound, we can't easily calculate loss

                    let level: ConnectionQuality["level"] = "excellent";
                    if (lossRate > 5) level = "critical";
                    else if (lossRate > 2) level = "poor";
                    else if (lossRate > 0.5) level = "good";

                    setPeerQuality(peerIdRef.current, { level, packetLoss: lossRate });

                    // Auto quality switching
                    if (settings.autoQuality && level === "poor") {
                        // Request lower layer for simulcast tracks
                        // This would need to be implemented based on available layers
                        log(`Poor connection detected (${lossRate.toFixed(1)}% loss), consider switching to lower quality`, "warning");
                    }
                }

                // Calculate quality for remote peers (inbound)
                inboundStats.forEach((inbound) => {
                    const packetLoss = inbound.packetsLost || 0;
                    const packetsReceived = inbound.packetsReceived || 1;
                    const lossRate = (packetLoss / packetsReceived) * 100;

                    let level: ConnectionQuality["level"] = "excellent";
                    if (lossRate > 5) level = "critical";
                    else if (lossRate > 2) level = "poor";
                    else if (lossRate > 0.5) level = "good";

                    // We'd need to map this to a specific peer ID
                    // For now, just log it
                    if (lossRate > 1) {
                        log(`Remote stream quality: ${level} (${lossRate.toFixed(1)}% loss)`, "warning");
                    }
                });

            } catch (error) {
                console.error("Error collecting stats:", error);
            }
        }, 2000); // Check every 2 seconds
    }, [setPeerQuality, settings.autoQuality, log]);

    const handleSignalingMessage = useCallback(async (msg: SignalingMessage | Record<string, unknown>) => {
        switch (msg.type) {
            case "ping":
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        type: 'pong',
                        timestamp: new Date().toISOString()
                    }));
                }
                break;

            case "join": // Ack from server
                if (!msg.data || typeof msg.data !== 'object' || !('success' in msg.data)) return;
                const joinData = msg.data as { success: boolean; peerId?: string; userId?: string };
                if (!joinData.success || !joinData.peerId) {
                    log("Join failed", "error");
                    return;
                }
                peerIdRef.current = joinData.peerId;
                log(`Joined room - peer ${joinData.peerId.slice(0, 8)}`, "success");
                setStatus("connected");
                await createPeerConnection();
                break;

            case "room-state":
                if (msg.data && typeof msg.data === 'object' && 'peers' in msg.data) {
                    const roomData = msg.data as { peers: Array<{ peerId: string; userId: string; name: string }> };
                    if (roomData.peers) {
                        log(`Room has ${roomData.peers.length} peer(s)`, "info");
                        roomData.peers.forEach((p) => {
                            // Only add if it's not us (though usually server filters)
                            if (p.peerId !== peerIdRef.current) {
                                addPeer({
                                    id: p.peerId,
                                    userId: p.userId,
                                    name: p.name,
                                    isLocal: false,
                                });
                            }
                        });
                    }
                }
                break;

            case "peer-joined":
                if (msg.data && typeof msg.data === 'object') {
                    const peerData = msg.data as { peerId: string; userId: string; name: string };
                    log(`${peerData.name} joined`, "success");
                    addPeer({
                        id: peerData.peerId,
                        userId: peerData.userId,
                        name: peerData.name,
                        isLocal: false,
                    });
                }
                break;

            case "peer-left":
                if (msg.data && typeof msg.data === 'object') {
                    const leftData = msg.data as { peerId: string; name?: string };
                    log(`${leftData.name || leftData.peerId.slice(0, 8)} left`, "warning");
                    removePeer(leftData.peerId);
                }
                break;

            case "answer":
                if (!pcRef.current || !msg.data || typeof msg.data !== 'object') return;
                const answerData = msg.data as { sdp: string };
                try {
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerData.sdp }));

                    // Process buffered ICE candidates
                    for (const candidate of iceBufRef.current) {
                        try {
                            await pcRef.current.addIceCandidate(candidate);
                        } catch (e) {
                            console.warn("Error adding buffered ICE candidate", e);
                        }
                    }
                    iceBufRef.current = [];

                    negRef.current = false;
                    negReadyRef.current = true;
                    // Prepare for next negotiation if pending
                    if (negPendRef.current) {
                        negPendRef.current = false;
                        setTimeout(() => negotiate(), 10);
                    }
                } catch (e) {
                    log("Answer error: " + e, "error");
                    negRef.current = false;
                }
                break;

            case "ice-candidate":
                if (msg.data && typeof msg.data === 'object') {
                    const iceData = msg.data as { candidate: string; sdpMid: string; sdpMLineIndex: number };
                    const candidateInit: RTCIceCandidateInit = {
                        candidate: iceData.candidate,
                        sdpMid: iceData.sdpMid,
                        sdpMLineIndex: iceData.sdpMLineIndex,
                    };
                    if (pcRef.current && pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
                        try {
                            await pcRef.current.addIceCandidate(candidateInit);
                        } catch (e) {
                            console.error("Error adding ICE candidate", e);
                        }
                    } else {
                        iceBufRef.current.push(candidateInit);
                    }
                }
                break;

            case "renegotiate":
                const reason = msg.data && typeof msg.data === 'object' && 'reason' in msg.data 
                    ? (msg.data as { reason: string }).reason 
                    : "unknown";
                log("Server wants renegotiation: " + reason, "info");
                if (!pcRef.current) return;
                if (negRef.current) {
                    negPendRef.current = true;
                } else {
                    await negotiate();
                }
                break;

            case "layer-available":
                if (msg.data && typeof msg.data === 'object') {
                    const layerData = msg.data as { trackId: string; layers: string[] };
                    if (layerData.trackId && layerData.layers) {
                        setSimulcastLayers(layerData.trackId, layerData.layers);
                    }
                }
                break;

            case "dominant-speaker":
                if (msg.data && typeof msg.data === 'object') {
                    const speakerData = msg.data as { newPeerId?: string };
                    setDominantSpeaker(speakerData.newPeerId || null);
                }
                break;

            case "quality-stats":
                if (msg.data && typeof msg.data === 'object') {
                    const qualityData = msg.data as { peerId: string; level: string; packetLoss: number };
                    if (qualityData.peerId && qualityData.level && typeof qualityData.packetLoss === 'number') {
                        setPeerQuality(qualityData.peerId, {
                            level: qualityData.level as ConnectionQuality["level"],
                            packetLoss: qualityData.packetLoss
                        });
                    }
                }
                break;

            case "error":
                if (msg.data && typeof msg.data === 'object') {
                    const errorData = msg.data as { message: string };
                    log("Server error: " + errorData.message, "error");
                }
                break;
        }
    }, [log, setStatus, addPeer, removePeer, setDominantSpeaker, setPeerQuality, setSimulcastLayers, createPeerConnection, negotiate]);

    // --- WebSocket Handling ---

    const connect = useCallback((newRoomId: string, newUserId: string, newName: string) => {
        if (wsRef.current) {
            if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
                log("Already connected or connecting", "warning");
                return;
            }
            // If closed or closing, cleanup and reconnect
            wsRef.current.close();
            wsRef.current = null;
        }

        setStatus("connecting");
        setRoomInfo(newRoomId, newUserId, newName);
        connectionInfo.current = { roomId: newRoomId, userId: newUserId, name: newName };
        
        const ws = new WebSocket(`${WS_URL}?userId=${encodeURIComponent(newUserId)}&name=${encodeURIComponent(newName)}`);
        wsRef.current = ws;

        ws.onopen = () => {
            log("Connected to server", "success");
            sendSignalingMessage({
                type: "join",
                data: { roomId: newRoomId, userId: newUserId, name: newName },
            });
        };

        ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);

                // Handle double-encoding if the 'data' field is a string
                if (msg.data && typeof msg.data === 'string') {
                    try {
                        msg.data = JSON.parse(msg.data);
                    } catch (e) {
                        log("Error parsing inner data JSON: " + e, "error");
                    }
                }

                await handleSignalingMessage(msg);
            } catch (err) {
                log("Signaling parse error: " + err, "error");
            }
        };

        ws.onclose = (event) => {
            log(`WebSocket closed (${event.code})`, "warning");
            setStatus("disconnected");
            cleanup();
        };

        ws.onerror = () => {
            log("WebSocket error", "error");
            setStatus("error");
        };
    }, [setStatus, setRoomInfo, log, sendSignalingMessage, handleSignalingMessage, cleanup]);

    // --- Media Controls ---

    const toggleMic = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isMicOn);
            setMediaState("mic", !isMicOn);
        }
    }, [isMicOn, setMediaState]);

    const toggleCamera = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !isCameraOn);
            setMediaState("camera", !isCameraOn);
        }
    }, [isCameraOn, setMediaState]);

    const toggleScreenShare = useCallback(async () => {
        if (isScreenShareOn) {
            // Stop Screen Share -> Revert to Camera
            try {
                // Get Camera Stream
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                const videoTrack = stream.getVideoTracks()[0];

                if (pcRef.current) {
                    const senders = pcRef.current.getSenders();
                    const sender = senders.find(s => s.track?.kind === "video");
                    if (sender) {
                        await sender.replaceTrack(videoTrack);
                    }
                }

                // Update local stream ref (replace the video track)
                if (localStreamRef.current) {
                    const oldTrack = localStreamRef.current.getVideoTracks()[0];
                    if (oldTrack) {
                        localStreamRef.current.removeTrack(oldTrack);
                        oldTrack.stop();
                    }
                    localStreamRef.current.addTrack(videoTrack);
                    setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
                }

                // Clean up screen stream
                if (screenStreamRef.current) {
                    screenStreamRef.current.getTracks().forEach(t => t.stop());
                    screenStreamRef.current = null;
                }

                setMediaState("screen", false);
                setMediaState("camera", true);
                log("Screen sharing stopped", "info");
            } catch (e) {
                log("Failed to revert to camera: " + e, "error");
            }
        } else {
            // Start Screen Share
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                screenStreamRef.current = screenStream;

                if (pcRef.current) {
                    const senders = pcRef.current.getSenders();
                    const sender = senders.find(s => s.track?.kind === "video");
                    if (sender) {
                        await sender.replaceTrack(screenTrack);
                    }
                }

                // Handle user stopping via browser UI
                screenTrack.onended = () => {
                    log("Screen sharing ended", "info");
                    // We'll handle this through the UI state change
                    setMediaState("screen", false);
                    setMediaState("camera", true);
                };

                // Update local stream ref
                if (localStreamRef.current) {
                    const oldTrack = localStreamRef.current.getVideoTracks()[0];
                    if (oldTrack) {
                        localStreamRef.current.removeTrack(oldTrack);
                        oldTrack.stop();
                    }
                    localStreamRef.current.addTrack(screenTrack);
                    setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
                }

                setMediaState("screen", true);
                setMediaState("camera", false);
                log("Screen sharing started", "success");
            } catch (e) {
                log("Screen sharing error: " + e, "error");
            }
        }
    }, [isScreenShareOn, setMediaState, setLocalStream, log]);

    // --- Layer Switching ---
    const switchLayer = useCallback((trackId: string, targetRid: string) => {
        sendSignalingMessage({
            type: "layer-switch",
            data: { trackId, targetRid }
        });
        log(`Switched to ${targetRid} quality for track ${trackId.slice(0, 8)}`, "info");
    }, [sendSignalingMessage, log]);

    // --- Disconnect ---
    const disconnect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            sendSignalingMessage({
                type: "leave",
                data: {}
            });
            wsRef.current.close();
        }
        cleanup();
        reset();
        log("Left room", "info");
    }, [sendSignalingMessage, cleanup, reset, log]);

    useEffect(() => {
        return () => cleanup();
    }, [cleanup]);

    return {
        connect,
        disconnect,
        toggleMic,
        toggleCamera,
        toggleScreenShare,
        switchLayer,
    };
};

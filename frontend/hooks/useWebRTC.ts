import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRoomStore } from "../store/useRoomStore";
import { SignalingMessage, ConnectionQuality } from "../types";

const DEFAULT_WS_URL = "ws://localhost:8080/ws";

function resolveWsUrl() {
    if (typeof window === "undefined") return DEFAULT_WS_URL;
    const env = process.env.NEXT_PUBLIC_WS_URL;
    if (env && env.trim()) return env.trim();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
}

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
        setSessionInfo,
        clearSessionInfo,
    } = useRoomStore();

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const cameraTrackBeforeScreenRef = useRef<MediaStreamTrack | null>(null);

    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const disconnectRequestedRef = useRef(false);
    const maxReconnectAttempts = 10;

    // Negotiation state
    const negRef = useRef(false);       // _neg
    const negPendRef = useRef(false);   // _negPend
    const negReadyRef = useRef(false);  // _negReady
    const iceBufRef = useRef<RTCIceCandidateInit[]>([]);

    // Connection info for reconnects
    const connectionInfo = useRef({ roomId: "", userId: "", name: "" });
    const peerIdRef = useRef<string>("");

    // Session refs for reconnection
    const sessionIdRef = useRef<string | null>(null);
    const sessionTokenRef = useRef<string | null>(null);

    // Perfect negotiation (client is polite)
    const makingOfferRef = useRef(false);

    const wsUrl = useMemo(() => resolveWsUrl(), []);

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
        if (cameraTrackBeforeScreenRef.current) {
            cameraTrackBeforeScreenRef.current.stop();
            cameraTrackBeforeScreenRef.current = null;
        }
        
        negRef.current = false;
        negPendRef.current = false;
        negReadyRef.current = false;
        iceBufRef.current = [];
        peerIdRef.current = "";
        makingOfferRef.current = false;
        // Keep sessionIdRef and sessionTokenRef for reconnection

        if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
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

    const ensureRecvonlyTransceivers = useCallback((neededTracks: number) => {
        // Server may ask us to renegotiate with a trackCount hint.
        // Ensure we have enough free recvonly transceivers to receive all streams.
        if (!pcRef.current) return;
        const pc = pcRef.current;

        const transceivers = pc.getTransceivers();
        let usedVideo = 0, usedAudio = 0;
        let totalVideo = 0, totalAudio = 0;

        for (const t of transceivers) {
            if (t.direction !== "recvonly") continue;
            // Determine kind from the transceiver's receiver track or mid
            const kind = t.receiver?.track?.kind || (t.mid?.includes("video") ? "video" : "audio");

            if (kind === "video") {
                totalVideo++;
                if (t.receiver?.track && t.receiver.track.readyState === "live") {
                    usedVideo++;
                }
            } else {
                totalAudio++;
                if (t.receiver?.track && t.receiver.track.readyState === "live") {
                    usedAudio++;
                }
            }
        }

        const freeVideo = totalVideo - usedVideo;
        const freeAudio = totalAudio - usedAudio;

        // For N tracks, assume ~50% video, ~50% audio
        const halfNeeded = Math.ceil(neededTracks / 2);
        // Add buffer of 5 extra for incoming peers
        const videoToAdd = Math.max(0, (halfNeeded + 5) - freeVideo);
        const audioToAdd = Math.max(0, (halfNeeded + 5) - freeAudio);

        for (let i = 0; i < videoToAdd; i++) pc.addTransceiver("video", { direction: "recvonly" });
        for (let i = 0; i < audioToAdd; i++) pc.addTransceiver("audio", { direction: "recvonly" });

        if (videoToAdd + audioToAdd > 0) {
            log(`Transceivers: +${videoToAdd}v +${audioToAdd}a (free: ${freeVideo}v/${freeAudio}a, needed: ${neededTracks})`, "info");
        }
    }, [log]);

    const replaceLocalTrack = useCallback(async (kind: "audio" | "video", newTrack: MediaStreamTrack) => {
        // Replace in sender (if any)
        if (pcRef.current) {
            const sender = pcRef.current.getSenders().find(s => s.track?.kind === kind);
            if (sender) {
                await sender.replaceTrack(newTrack);
            }
        }

        // Replace in local stream ref
        if (localStreamRef.current) {
            const old = (kind === "audio"
                ? localStreamRef.current.getAudioTracks()[0]
                : localStreamRef.current.getVideoTracks()[0]
            );
            if (old) {
                localStreamRef.current.removeTrack(old);
                old.stop();
            }
            localStreamRef.current.addTrack(newTrack);
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
    }, [setLocalStream]);

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

    // --- WebRTC Handling ---
    const negotiate = useCallback(async () => {
        if (!pcRef.current) return;

        // Prevent concurrent negotiations
        if (negRef.current) {
            negPendRef.current = true;
            return;
        }

        // Perfect negotiation: track that we're making an offer
        makingOfferRef.current = true;
        negRef.current = true;
        negPendRef.current = false;

        try {
            const offer = await pcRef.current.createOffer();

            // Check if signaling state changed during createOffer
            if (pcRef.current.signalingState !== "stable") {
                makingOfferRef.current = false;
                negRef.current = false;
                return;
            }

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
            makingOfferRef.current = false;
            if (negPendRef.current) {
                negPendRef.current = false;
                setTimeout(() => negotiate(), 50);
            }
        }
        // Note: negRef.current stays true until answer is received
        // Only clear makingOfferRef here since we're done creating the offer
        makingOfferRef.current = false;
    }, [sendSignalingMessage, log]);

    const createPeerConnection = useCallback(async () => {
        if (pcRef.current) return;

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        // Initialize Local Media
        try {
            let stream = localStreamRef.current;
            if (!stream) {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: settings.selectedMicId ? { exact: settings.selectedMicId } : undefined,
                        noiseSuppression: settings.noiseSuppression,
                        echoCancellation: settings.echoCancellation,
                        autoGainControl: settings.autoGainControl,
                    },
                    video: {
                        deviceId: settings.selectedCameraId ? { exact: settings.selectedCameraId } : undefined,
                        width: settings.hdVideo ? 1280 : 640,
                        height: settings.hdVideo ? 720 : 480,
                        frameRate: 30,
                    },
                });

                localStreamRef.current = stream;
                setLocalStream(stream);
                log("Camera + mic acquired", "success");
            } else {
                setLocalStream(stream);
                log("Reusing existing local media", "info");
            }

            // Safety check: if PC was closed during getUserMedia
            if (pc.signalingState === 'closed') {
                log("PC closed during getUserMedia", "warning");
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];

            // Apply initial enabled state based on UI toggles
            if (videoTrack) videoTrack.enabled = isCameraOn;
            if (audioTrack) audioTrack.enabled = isMicOn;

            // Match reference client behavior: send plain tracks (no simulcast sendEncodings)
            if (videoTrack) pc.addTrack(videoTrack, stream);
            if (audioTrack) pc.addTrack(audioTrack, stream);

            // Pre-allocate recvonly transceivers for potential remote peers
            // Start with 25+25 for ~25 peers, dynamic allocation handles growth to 50+
            for (let i = 0; i < 25; i++) pc.addTransceiver('video', { direction: 'recvonly' });
            for (let i = 0; i < 25; i++) pc.addTransceiver('audio', { direction: 'recvonly' });

        } catch (err) {
            log("Media error: " + err, "error");
            setStatus("error");
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
            // Pion may deliver tracks without stream association.
            // If so, create a synthetic stream for this track.
            const stream = event.streams[0] || new MediaStream([event.track]);
            // Convention: stream.id is the source peerID
            const sourcePeerId = stream.id;

            log(`ontrack: kind=${event.track.kind} streams=${event.streams.length} id=${event.track.id.slice(0, 8)}`, "info");
            addRemoteTrack(sourcePeerId, event.track, stream);

            event.track.onended = () => {
                removeRemoteTrack(sourcePeerId, event.track.id);
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
            } else if (state === 'disconnected') {
                // Request ICE restart after 3 seconds of disconnected state
                setTimeout(() => {
                    if (pcRef.current?.connectionState === 'disconnected') {
                        log("Requesting ICE restart", "warning");
                        sendSignalingMessage({ type: "ice-restart-request", data: {} });
                    }
                }, 3000);
            } else if (state === 'failed') {
                log("WebRTC failed, closing WebSocket to trigger reconnect", "error");
                try { wsRef.current?.close(); } catch { /* ignore */ }
            } else if (state === 'closed') {
                if (statsIntervalRef.current) {
                    clearInterval(statsIntervalRef.current);
                    statsIntervalRef.current = null;
                }
            }
        };

        // Start initial negotiation
        await negotiate();
    }, [setLocalStream, log, sendSignalingMessage, addRemoteTrack, removeRemoteTrack, negotiate, startStatsTracking, settings.selectedMicId, settings.selectedCameraId, settings.noiseSuppression, settings.echoCancellation, settings.autoGainControl, settings.hdVideo, isCameraOn, isMicOn, setStatus]);

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
                const joinData = msg.data as {
                    success: boolean;
                    peerId?: string;
                    sessionId?: string;
                    sessionToken?: string;
                    resumed?: boolean;
                };
                if (!joinData.success || !joinData.peerId) {
                    log("Join failed", "error");
                    return;
                }
                peerIdRef.current = joinData.peerId;

                // Store session info for reconnection
                if (joinData.sessionId && joinData.sessionToken) {
                    sessionIdRef.current = joinData.sessionId;
                    sessionTokenRef.current = joinData.sessionToken;
                    setSessionInfo(joinData.sessionId, joinData.sessionToken);
                }

                const resumeMsg = joinData.resumed ? " (session resumed)" : "";
                log(`Joined room - peer ${joinData.peerId.slice(0, 8)}${resumeMsg}`, "success");
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
                const trackCount = msg.data && typeof msg.data === "object" && "trackCount" in msg.data
                    ? Number((msg.data as { trackCount: unknown }).trackCount)
                    : null;
                log("Server wants renegotiation: " + reason, "info");
                if (!pcRef.current) return;
                if (trackCount && Number.isFinite(trackCount) && trackCount > 0) {
                    ensureRecvonlyTransceivers(trackCount);
                }
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

                        // Reference behavior: auto layer switching for local peer on poor connection.
                        if (settings.autoQuality && qualityData.peerId === peerIdRef.current && qualityData.level === "poor") {
                            const layersByTrack = useRoomStore.getState().simulcastLayers;
                            Object.entries(layersByTrack).forEach(([trackId, layers]) => {
                                if (layers.includes("l")) {
                                    sendSignalingMessage({ type: "layer-switch", data: { trackId, targetRid: "l" } });
                                } else if (layers.includes("m")) {
                                    sendSignalingMessage({ type: "layer-switch", data: { trackId, targetRid: "m" } });
                                }
                            });
                        }
                    }
                }
                break;

            case "offer":
                // Server-initiated offer (for renegotiation)
                if (!pcRef.current || !msg.data || typeof msg.data !== 'object') return;
                const serverOfferData = msg.data as { sdp: string };
                try {
                    // Perfect negotiation: client is polite, check for collision
                    const offerCollision = makingOfferRef.current ||
                        pcRef.current.signalingState !== "stable";

                    if (offerCollision) {
                        log("Offer collision detected, rolling back", "warning");
                        await pcRef.current.setLocalDescription({ type: "rollback" });
                    }

                    await pcRef.current.setRemoteDescription(
                        new RTCSessionDescription({ type: "offer", sdp: serverOfferData.sdp })
                    );

                    const answer = await pcRef.current.createAnswer();
                    await pcRef.current.setLocalDescription(answer);

                    sendSignalingMessage({
                        type: "answer",
                        data: {
                            sdp: answer.sdp!,
                            type: "answer",
                            peerId: peerIdRef.current
                        }
                    });
                } catch (e) {
                    log("Failed to handle server offer: " + e, "error");
                }
                break;

            case "ice-restart-offer":
                if (!pcRef.current || !msg.data || typeof msg.data !== 'object') return;
                const iceRestartData = msg.data as { sdp: string };
                try {
                    await pcRef.current.setRemoteDescription(
                        new RTCSessionDescription({ type: "offer", sdp: iceRestartData.sdp })
                    );
                    const answer = await pcRef.current.createAnswer();
                    await pcRef.current.setLocalDescription(answer);
                    sendSignalingMessage({
                        type: "answer",
                        data: { sdp: answer.sdp!, type: "answer", peerId: peerIdRef.current }
                    });
                    log("ICE restart completed", "success");
                } catch (e) {
                    log("ICE restart failed: " + e, "error");
                }
                break;

            case "error":
                if (msg.data && typeof msg.data === 'object') {
                    const errorData = msg.data as { message: string };
                    log("Server error: " + errorData.message, "error");
                }
                break;
        }
    }, [log, setStatus, addPeer, removePeer, setDominantSpeaker, setPeerQuality, setSimulcastLayers, createPeerConnection, negotiate, sendSignalingMessage, setSessionInfo]);

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
        disconnectRequestedRef.current = false;
        
        const ws = new WebSocket(`${wsUrl}?userId=${encodeURIComponent(newUserId)}&name=${encodeURIComponent(newName)}`);
        wsRef.current = ws;

        ws.onopen = () => {
            log("Connected to server", "success");
            sendSignalingMessage({
                type: "join",
                data: {
                    roomId: newRoomId,
                    userId: newUserId,
                    name: newName,
                    sessionId: sessionIdRef.current,
                    sessionToken: sessionTokenRef.current,
                },
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

            // Keep store state; allow reconnect attempts unless user explicitly disconnected.
            cleanup();

            if (!disconnectRequestedRef.current && connectionInfo.current.roomId) {
                if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
                    log("Max reconnect attempts reached", "error");
                    return;
                }
                reconnectAttemptsRef.current += 1;
                const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current - 1), 15000);
                log(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttemptsRef.current})...`, "warning");
                reconnectTimerRef.current = window.setTimeout(() => {
                    const info = connectionInfo.current;
                    connect(info.roomId, info.userId, info.name);
                }, delay);
            }
        };

        ws.onerror = () => {
            log("WebSocket error", "error");
            setStatus("error");
        };
    }, [setStatus, setRoomInfo, log, sendSignalingMessage, handleSignalingMessage, cleanup]);

    // --- React to device/settings changes (swap tracks without full reconnect) ---
    useEffect(() => {
        // Only attempt swaps when we have a stream + PC established and we're not screensharing.
        if (!pcRef.current || !localStreamRef.current) return;
        if (isScreenShareOn) return;

        let cancelled = false;

        const apply = async () => {
            try {
                // Video device / HD changes
                if (settings.selectedCameraId || settings.hdVideo) {
                    const camStream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            deviceId: settings.selectedCameraId ? { exact: settings.selectedCameraId } : undefined,
                            width: settings.hdVideo ? 1280 : 640,
                            height: settings.hdVideo ? 720 : 480,
                            frameRate: 30,
                        }
                    });
                    const newVideo = camStream.getVideoTracks()[0];
                    if (!newVideo) {
                        camStream.getTracks().forEach(t => t.stop());
                    } else {
                        newVideo.enabled = isCameraOn;
                        if (!cancelled) {
                            await replaceLocalTrack("video", newVideo);
                        } else {
                            newVideo.stop();
                        }
                    }
                }

                // Audio device / processing changes
                if (settings.selectedMicId || settings.noiseSuppression || settings.echoCancellation || settings.autoGainControl) {
                    const micStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            deviceId: settings.selectedMicId ? { exact: settings.selectedMicId } : undefined,
                            noiseSuppression: settings.noiseSuppression,
                            echoCancellation: settings.echoCancellation,
                            autoGainControl: settings.autoGainControl,
                        }
                    });
                    const newAudio = micStream.getAudioTracks()[0];
                    if (!newAudio) {
                        micStream.getTracks().forEach(t => t.stop());
                    } else {
                        newAudio.enabled = isMicOn;
                        if (!cancelled) {
                            await replaceLocalTrack("audio", newAudio);
                        } else {
                            newAudio.stop();
                        }
                    }
                }
            } catch (e) {
                log("Failed to apply device settings: " + e, "warning");
            }
        };

        apply();

        return () => {
            cancelled = true;
        };
    }, [settings.selectedCameraId, settings.selectedMicId, settings.hdVideo, settings.noiseSuppression, settings.echoCancellation, settings.autoGainControl, replaceLocalTrack, log, isScreenShareOn, isCameraOn, isMicOn]);

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
        const stopScreenShareAndRevert = async () => {
            // Stop Screen Share -> Revert to Camera
            try {
                const camTrack = cameraTrackBeforeScreenRef.current;
                let videoTrack = camTrack;

                if (!videoTrack || videoTrack.readyState === "ended") {
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            deviceId: settings.selectedCameraId ? { exact: settings.selectedCameraId } : undefined,
                            width: settings.hdVideo ? 1280 : 640,
                            height: settings.hdVideo ? 720 : 480,
                            frameRate: 30,
                        }
                    });
                    videoTrack = stream.getVideoTracks()[0];
                }

                if (pcRef.current) {
                    const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
                    if (sender && videoTrack) {
                        await sender.replaceTrack(videoTrack);
                    }
                }

                // Update local stream ref (replace the video track)
                if (localStreamRef.current && videoTrack) {
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

                cameraTrackBeforeScreenRef.current = null;
                setMediaState("screen", false);
                setMediaState("camera", true);
                log("Screen sharing stopped", "info");
            } catch (e) {
                log("Failed to revert to camera: " + e, "error");
            }
        };

        if (isScreenShareOn) {
            await stopScreenShareAndRevert();
        } else {
            // Start Screen Share
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                screenStreamRef.current = screenStream;

                // Preserve the current camera track so we can revert without re-acquiring.
                cameraTrackBeforeScreenRef.current = localStreamRef.current?.getVideoTracks()[0] || null;

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
                    stopScreenShareAndRevert();
                };

                // Update local stream ref
                if (localStreamRef.current) {
                    const oldTrack = localStreamRef.current.getVideoTracks()[0];
                    if (oldTrack) {
                        localStreamRef.current.removeTrack(oldTrack);
                        // do not stop camera track; we may revert to it
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
    }, [isScreenShareOn, setMediaState, setLocalStream, log, settings.selectedCameraId, settings.hdVideo]);

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
        disconnectRequestedRef.current = true;
        // Clear session on explicit disconnect
        sessionIdRef.current = null;
        sessionTokenRef.current = null;
        clearSessionInfo();

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
    }, [sendSignalingMessage, cleanup, reset, log, clearSessionInfo]);

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

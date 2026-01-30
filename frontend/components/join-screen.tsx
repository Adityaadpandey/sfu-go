"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWebRTCContext } from "@/components/webrtc-provider";
import { useRoomStore } from "@/store/useRoomStore";
import { useState } from "react";

export function JoinScreen() {
  const { connect } = useWebRTCContext();
  const { status } = useRoomStore();
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [userId] = useState(() => "user-" + Math.floor(Math.random() * 10000));

  const isConnecting = status === "connecting";

  const handleJoin = () => {
    if (roomId && name && !isConnecting) {
      connect(roomId, userId, name);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950 p-4">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Join Room</CardTitle>
          <CardDescription className="text-center text-zinc-400">
            Enter a room ID to start a video call
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Display Name</label>
            <Input
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-950 border-zinc-700 focus-visible:ring-zinc-400"
              disabled={isConnecting}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Room ID</label>
            <Input
              placeholder="e.g. daily-standup"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="bg-zinc-950 border-zinc-700 focus-visible:ring-zinc-400"
              disabled={isConnecting}
            />
          </div>
          <Button
            className="w-full bg-white text-black hover:bg-zinc-200 font-semibold"
            onClick={handleJoin}
            disabled={!roomId || !name || isConnecting}
          >
            {isConnecting ? "Connecting..." : "Join Room"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

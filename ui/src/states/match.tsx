import PartySocket from "partysocket";
import type { CloseEvent, ErrorEvent } from "partysocket/ws";
import { useEffect, useState } from "react";
import { useParams } from "react-router";

function useGameRoom(roomId: string, playerId: string) {
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  useEffect(() => {
    let cancelled = false;

    const ws = new PartySocket({
      host: import.meta.env.VITE_PARTYKIT_BASE,
      party: "gameroom",
      room: roomId,
      query: { playerId },
    });

    setStatus("disconnected");

    const onOpen = () => {
      if (cancelled) return ws.close();
      setStatus("connected");
    };

    const onClose = (e: CloseEvent) => {
      if (e.wasClean) {
        // don't reconnect if the close was clean
        ws.close();
      }
      setStatus(ws.shouldReconnect ? "connecting" : "disconnected");
    };

    const onError = (error: ErrorEvent) => {
      console.error("WebSocket error:", error);
    };

    const onMessage = (message: MessageEvent) => {
      if (cancelled) return;
      if (typeof message.data !== "string") {
        console.error("Received non-string message:", message.data);
        return;
      }
      const data = JSON.parse(message.data);
      console.log("received", data);
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onError);
    ws.addEventListener("message", onMessage);

    return () => {
      cancelled = true;
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("message", onMessage);
      ws.close();
      setStatus("disconnected");
    };
  }, [roomId, playerId]);

  return { status };
}

function Match({ roomId, playerId }: { roomId: string; playerId: string }) {
  const game = useGameRoom(roomId, playerId);

  return <div>hey it work. {game.status}</div>;
}

export default function MatchWrapper() {
  const { playerId, roomId } = useParams<"roomId" | "playerId">();
  if (!playerId || !roomId) throw new Error("Invalid match parameters");

  return <Match roomId={roomId} playerId={playerId} />;
}

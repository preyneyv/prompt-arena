import { Button } from "@/components/ui/button";
import PartySocket from "partysocket";
import type { CloseEvent, ErrorEvent } from "partysocket/ws";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

type MMMethods = {
  onMatch?: (roomId: string, playerId: string) => void;
};

function useMatchmaker({
  onMatch,
}: { onMatch?: (roomId: string, playerId: string) => void } = {}) {
  const [ws, setWs] = useState<PartySocket | null>(null);
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const methods = useRef<MMMethods>({});
  methods.current.onMatch = onMatch;

  useEffect(() => {
    if (!ws) return;
    let cancelled = false;
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
      setStatus("disconnected");
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
      if (data.type === "match") {
        const { roomId, playerId } = data;
        methods.current.onMatch?.(roomId, playerId);
      }
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
  }, [ws]);

  return {
    status: status,
    connect() {
      setStatus("connecting");
      setWs(
        new PartySocket({
          host: import.meta.env.VITE_PARTYKIT_BASE,
          party: "main",
          room: "global",
        })
      );
    },
    disconnect() {
      setWs(null);
    },
  };
}

export default function Queue() {
  const navigate = useNavigate();
  const mm = useMatchmaker({
    onMatch: (roomId, playerId) => {
      navigate(`/match/${roomId}/${playerId}`);
    },
  });
  return (
    <Button
      onClick={() => {
        if (mm.status === "disconnected") {
          mm.connect();
        } else {
          mm.disconnect();
        }
      }}
      disabled={mm.status === "connecting"}
    >
      {mm.status === "disconnected" && "Join Queue"}
      {mm.status === "connecting" && "Joining..."}
      {mm.status === "connected" && "Leave Queue"}
    </Button>
  );
}

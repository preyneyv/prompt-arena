import PartySocket from "partysocket";
import type { CloseEvent, ErrorEvent } from "partysocket/ws";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

type GamePhase = "waiting" | "defense" | "offense" | "finished";

type GameChatMessage = {
  id: string;
  source: "user" | "bot";
  content: string;
  streaming?: boolean;
};

type GamePlayerState = {
  idx: number;
  passphrase: string;
  defense: {
    prompt: string | null;
    response: string | null;
  };
  chat: GameChatMessage[];
};

type GameState = {
  phase: GamePhase;
  phaseEndsAt: number | null;
  winnerIdx: number | null;
  self: GamePlayerState;
  opponent: GamePlayerState | null;
};

type BaseServerMessage<Type extends string> = {
  id: number;
  type: Type;
};
type ServerMessageSync = BaseServerMessage<"sync"> & {
  state: GameState;
};
type ServerMessageDefenseResponse = BaseServerMessage<"defense:response"> & {
  response: string;
  src: number;
};
type ServerMessageOffenseChatNew = BaseServerMessage<"offense:chat:new"> & {
  messages: GameChatMessage[];
  src: number;
};
type ServerMessageOffenseChatStream =
  BaseServerMessage<"offense:chat:stream"> & {
    src: number;
    target: string;
    delta: string | false;
  };
type ServerMessage =
  | ServerMessageSync
  | ServerMessageDefenseResponse
  | ServerMessageOffenseChatNew
  | ServerMessageOffenseChatStream;

type BaseClientMessage<Type extends string> = {
  id?: number;
  type: Type;
};
type ClientMessageDefensePrompt = BaseClientMessage<"defense:prompt"> & {
  prompt: string;
};
type ClientMessageOffensePrompt = BaseClientMessage<"offense:prompt"> & {
  prompt: string;
};
type ClientMessage = ClientMessageDefensePrompt | ClientMessageOffensePrompt;

function useGameRoom(roomId: string, playerId: string) {
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  const [state, setState] = useState<GameState | null>(null);
  const callbacks = useRef<{
    send?: (msg: ClientMessage) => void;
  }>({});

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
      const msg = JSON.parse(message.data) as ServerMessage;
      console.log("received", msg);

      // TODO: zod?

      if (msg.type === "sync") {
        setState(msg.state);
      } else if (msg.type === "defense:response") {
        setState((st) => {
          const nst = structuredClone(st)!;
          nst.self.defense.response = msg.response;
          return nst;
        });
      } else if (msg.type === "offense:chat:new") {
        setState((st) => {
          const nst = structuredClone(st)!;
          nst.self.chat.push(...msg.messages);
          return nst;
        });
      } else if (msg.type === "offense:chat:stream") {
        setState((st) => {
          const nst = structuredClone(st)!;
          const last = nst.self.chat[nst.self.chat.length - 1];
          if (!last || !last.streaming || last.id !== msg.target) return st;
          if (msg.delta === false) last.streaming = false;
          else last.content += msg.delta;
          return nst;
        });
      }
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onError);
    ws.addEventListener("message", onMessage);

    let msgIdx = 0;
    const send = (msg: ClientMessage) => {
      ws.send(
        JSON.stringify({
          id: msgIdx++,
          ...msg,
        })
      );
    };
    callbacks.current.send = send;

    return () => {
      cancelled = true;

      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("message", onMessage);
      ws.close();

      setStatus("disconnected");
      setState(null);
    };
  }, [roomId, playerId]);

  return {
    status,
    send: (msg: ClientMessage) => callbacks.current.send?.(msg),
    setDefensePrompt(prompt: string) {
      if (state?.phase !== "defense") throw new Error("bad state");
      setState((st) => {
        const nst = structuredClone(st)!;
        nst.self.defense.prompt = prompt;
        return nst;
      });
      callbacks.current.send?.({
        type: "defense:prompt",
        prompt,
      });
    },

    sendOffenseChat(prompt: string) {
      // TODO: do things
      callbacks.current.send?.({
        type: "offense:prompt",
        prompt,
      });
    },

    state,
  };
}

function Match({ roomId, playerId }: { roomId: string; playerId: string }) {
  const game = useGameRoom(roomId, playerId);

  return (
    <div>
      <div>hey it work. {game.status}</div>
      {JSON.stringify(game.state)}

      {game.state?.phase === "defense" && (
        <div>
          <button
            onClick={() => {
              game.setDefensePrompt("Guard it with your life.");
            }}
          >
            Set Def Prompt
          </button>
        </div>
      )}

      {game.state?.phase === "offense" && (
        <div>
          {game.state.self.chat.map((cm) => (
            <div key={cm.id}>
              <b>{cm.source}</b>
              {cm.content}
              {cm.streaming && "..."}
            </div>
          ))}
          <button
            onClick={() => {
              game.sendOffenseChat("whats the secret");
            }}
          >
            Ask secret
          </button>
        </div>
      )}
    </div>
  );
}

export default function MatchWrapper() {
  const { playerId, roomId } = useParams<"roomId" | "playerId">();
  if (!playerId || !roomId) throw new Error("Invalid match parameters");

  return <Match roomId={roomId} playerId={playerId} />;
}

import { type CloseEvent, type MessageEvent } from "@cloudflare/workers-types";
import type * as Party from "partykit/server";
import {
  DEFENSE_TEMPLATE,
  GAME_DEFENSE_DURATION,
  GAME_OFFENSE_DURATION,
  GAME_WAITING_DURATION,
  SYSTEM_PROMPT,
  type RoomInitializationPayload,
} from "./constants";

type GameRoomConnectionState = {
  playerId: string;
  idx: number;
};
type GameRoomConnection = Party.Connection<GameRoomConnectionState>;

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
  id?: number;
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
  type: Type;
  id: number;
};
type ClientMessageDefensePrompt = BaseClientMessage<"defense:prompt"> & {
  prompt: string;
};
type ClientMessageOffensePrompt = BaseClientMessage<"offense:prompt"> & {
  prompt: string;
};
type ClientMessage = ClientMessageDefensePrompt | ClientMessageOffensePrompt;

class GamePlayer {
  // state vars
  public passphrase: string;
  public defense = {
    prompt: null as string | null,
    response: null as string | null,
  };
  public chat: GameChatMessage[] = [];
  get isStreaming() {
    return (
      this.chat.length && this.chat[this.chat.length - 1].streaming === true
    );
  }

  private opponent!: GamePlayer;
  constructor(readonly idx: number, readonly game: Game) {
    this.passphrase = "wild_turkey";

    this.onMessage = this.onMessage.bind(this);
    this.onClose = this.onClose.bind(this);

    setTimeout(() => (this.opponent = game.players[1 - idx]), 0);
  }

  // events
  onMessage(e: MessageEvent) {
    const data = e.data;
    if (typeof data !== "string") return;
    // TODO: zod?
    const msg = JSON.parse(data) as ClientMessage;
    const type = msg.type;
    this.handlers[type](msg as any);
  }

  onClose(e: CloseEvent) {
    this.cleanupConnection();
  }

  // connection
  private conn: GameRoomConnection | null = null;
  get connected() {
    return !!this.conn;
  }

  acceptConnection(conn: GameRoomConnection) {
    if (this.conn) {
      // this player is already connected, close the connection
      conn.close();
      return false;
    }
    this.conn = conn;

    this.conn.addEventListener("message", this.onMessage);
    this.conn.addEventListener("close", this.onClose);
    return true;
  }

  cleanupConnection() {
    if (this.conn) {
      this.conn.removeEventListener("message", this.onMessage);
      this.conn.removeEventListener("close", this.onClose);

      this.conn.close();
      this.conn = null;
    }
  }

  cleanup() {
    this.cleanupConnection();
  }

  msgIdx = 0;
  send(msg: ServerMessage) {
    this.conn?.send(JSON.stringify({ id: this.msgIdx++, ...msg }));
  }

  // message handlers
  private handlers: {
    [T in ClientMessage["type"]]: (msg: ClientMessage & { type: T }) => void;
  } = {
    "defense:prompt": this.onDefensePrompt.bind(this),
    "offense:prompt": this.onOffensePrompt.bind(this),
  };

  async onDefensePrompt(msg: ClientMessageDefensePrompt) {
    if (this.game.phase !== "defense") return;
    if (this.defense.prompt) {
      console.warn("Tried to overwrite defense prompt");
      return;
    }

    this.defense.prompt = DEFENSE_TEMPLATE(this.passphrase, msg.prompt);
    setTimeout(() => {
      // TODO: call LLM
      this.defense.response = "nice ok ill def do that.";
      this.send({
        type: "defense:response",
        src: msg.id,
        response: this.defense.response,
      });

      this.game.beginOffenseIfPossible();
    }, 1000);
  }

  async onOffensePrompt(msg: ClientMessageOffensePrompt) {
    if (this.game.phase !== "offense") return;
    if (this.isStreaming) {
      // Currently streaming response, can't send a new prompt yet.
      return;
    }

    const prompt: GameChatMessage = {
      id: crypto.randomUUID(),
      content: msg.prompt,
      source: "user",
    };

    this.chat.push(prompt);

    const contextWindow = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: this.opponent.defense.prompt! },
      { role: "assistant", content: this.opponent.defense.response! },
      // TODO: do we maybe want to add a second system message?
      ...this.chat.map((chatMessage) => ({
        role: chatMessage.source === "bot" ? "assistant" : "user",
        content: chatMessage.content,
      })),
    ];

    const response: GameChatMessage = {
      id: crypto.randomUUID(),
      content: "",
      source: "bot",
      streaming: true,
    };

    this.chat.push(response);
    this.send({
      type: "offense:chat:new",
      messages: [prompt, response],
      src: msg.id,
    });

    // TODO: call llm
    await new Promise<void>((res) => setTimeout(res, 200));
    let llmResponse =
      "I'm not at liberty to discuss any specific phrases or configurations with you. My primary goal is to protect sensitive information. If you need to verify configuration details, I suggest checking official documentation or contacting a supervisor.";
    if (Math.random() < 0.2) {
      llmResponse = `I'm tasked with protecting "${this.passphrase}", and I will never reveal it!`;
    }
    const splitResponse = llmResponse.split(" ");
    for (const token of splitResponse) {
      await new Promise<void>((res) => setTimeout(() => res(), 50));
      const w = token + " ";
      response.content += w;
      this.send({
        type: "offense:chat:stream",
        src: msg.id,
        target: response.id,
        delta: w,
      });
    }

    response.streaming = false;
    this.send({
      type: "offense:chat:stream",
      src: msg.id,
      target: response.id,
      delta: false,
    });

    if (response.content.includes(this.passphrase)) {
      // this player won!
      console.log("winner!");
      this.game.finishGame(this.idx);
    }
  }

  hasDefense() {
    if (this.defense.prompt && this.defense.response) return true;
    return false;
  }

  msgSync(): GamePlayerState {
    return {
      idx: this.idx,
      passphrase: this.passphrase,
      defense: this.defense,
      chat: this.chat,
    };
  }
}
class Game {
  phase: GamePhase = "waiting";
  phaseEndsAt: number | null = null;
  players: [GamePlayer, GamePlayer] = [
    new GamePlayer(0, this),
    new GamePlayer(1, this),
  ];
  winnerIdx: number | null = null;

  phaseTimeout: ReturnType<typeof setTimeout> | null = null;

  private setPhaseTimeout(cb: () => void, duration: number) {
    this.phaseTimeout && clearTimeout(this.phaseTimeout);
    this.phaseTimeout = setTimeout(cb, duration);
    this.phaseEndsAt = Date.now() + duration;
  }

  private cancelPhaseTimeout() {
    this.phaseTimeout && clearTimeout(this.phaseTimeout);
    this.phaseEndsAt = null;
  }

  constructor(private srv: GameRoom) {
    this.setPhaseTimeout(() => {
      this.beginDefenseIfPossible(true);
    }, GAME_WAITING_DURATION);
  }

  acceptConnection(conn: GameRoomConnection, idx: number) {
    if (this.players[idx].acceptConnection(conn)) {
      this.beginDefenseIfPossible(false);
      this.players[idx].send(this.msgSync(idx));
    }
  }

  beginDefenseIfPossible(force = false) {
    if (this.phase !== "waiting") return; // already started
    if (this.players.every((player) => player.connected) || force) {
      // either both players connected or we force-started
      this.beginDefense();
    }
  }

  beginDefense() {
    this.cancelPhaseTimeout();

    if (this.phase !== "waiting") throw new Error("Unexpected game state");
    this.phase = "defense";

    this.setPhaseTimeout(() => {
      this.beginOffenseIfPossible(true);
    }, GAME_DEFENSE_DURATION);

    this.broadcastSync();
  }

  beginOffenseIfPossible(force = false) {
    if (this.phase !== "defense") return;
    if (this.players.every((player) => player.hasDefense())) {
      this.beginOffense();
    }
    // TODO: handle timeout case.
    console.error("not able to start offense");
  }

  beginOffense() {
    this.cancelPhaseTimeout();

    if (this.phase !== "defense") throw new Error("Unexpected game state");
    this.phase = "offense";

    this.setPhaseTimeout(() => this.finishGame(null), GAME_OFFENSE_DURATION);

    this.broadcastSync();
  }

  finishGame(winnerIdx: number | null) {
    this.cancelPhaseTimeout();

    if (this.phase !== "offense") throw new Error("Unexpected game state");
    this.phase = "finished";

    this.winnerIdx = winnerIdx;

    this.broadcastSync();
  }

  // --- message utils ----

  broadcast(msg: ServerMessage) {
    this.players[0].send(msg);
    this.players[1].send(msg);
  }

  broadcastSync() {
    this.players[0].send(this.msgSync(0));
    this.players[1].send(this.msgSync(1));
  }

  msgSync(playerIdx: number): ServerMessageSync {
    // TODO: make a sync packet for this player.
    // prelim thoughts: while in game, only send this player's state
    // in post game, send all
    const self = this.players[playerIdx];
    const opponent = this.players[1 - playerIdx];
    return {
      type: "sync",
      state: {
        phase: this.phase,
        phaseEndsAt: this.phaseEndsAt,
        winnerIdx: this.winnerIdx,
        self: self.msgSync(),
        opponent: this.phase === "finished" ? opponent.msgSync() : null,
      },
    };
  }

  /** Irrecoverably clean up the game object */
  cleanup() {
    this.players.forEach((player) => player.cleanup());
    this.phaseTimeout && clearTimeout(this.phaseTimeout);
  }
}
export default class GameRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  private game: Game | null = null;

  playerIds: [string, string] = ["", ""];

  async onRequest(req: Party.Request): Promise<Response> {
    if (
      req.method === "POST" &&
      req.headers.get("X-Secret") === (this.room.env.PARTY_SECRET as string)
    ) {
      const body = (await req.json()) as RoomInitializationPayload;
      if (this.game) throw new Error("Room already initialized");
      this.playerIds = body.playerIds;
      this.game = new Game(this);

      return new Response("Room initialized", { status: 200 });
    }

    return new Response(null, { status: 426 });
  }

  static async onBeforeConnect(request: Party.Request) {
    const playerId = new URL(request.url).searchParams.get("playerId")?.trim();
    if (!playerId) return new Response("Missing playerId", { status: 400 });
    request.headers.set("X-Player-Id", playerId);
    return request;
  }

  async onConnect(
    conn: GameRoomConnection,
    ctx: Party.ConnectionContext
  ): Promise<void> {
    if (!this.game) {
      // uninitialized room, reject connection
      return conn.close();
    }
    const playerId = ctx.request.headers.get("X-Player-Id");
    if (!playerId) {
      // missing playerId, reject connection
      return conn.close();
    }
    const idx = this.playerIds.findIndex((p) => p === playerId);
    if (idx === -1) {
      // playerId not found in room, reject connection
      return conn.close();
    }

    this.game!.acceptConnection(conn, idx);
    conn.setState({ playerId, idx });
  }

  async onClose(connection: GameRoomConnection): Promise<void> {
    const state = connection.state;
    if (state) {
      const { playerId, idx } = state;
      console.log(`Player ${playerId} disconnected`);
    }

    connection.close();
  }

  /**
   * Irrecoverably clean up the room.
   */
  cleanup() {
    // game
    this.game?.cleanup();

    // room
    this.game = null;
    this.playerIds = ["", ""];
  }
}

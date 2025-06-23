import type * as Party from "partykit/server";
import { type RoomInitializationPayload } from "./constants";

type GameRoomConnectionState = {
  playerId: string;
  idx: number;
};

type GameRoomState = "waiting" | "blue-team" | "red-team" | "finished";

export default class GameRoom implements Party.Server {
  constructor(readonly room: Party.Room) {}

  initialized = false;
  players: [Party.Connection | null, Party.Connection | null] = [null, null];
  playerIds: [string, string] = ["", ""];
  state: GameRoomState = "waiting";

  async onRequest(req: Party.Request): Promise<Response> {
    console.log("GameRoom onRequest", this.room.env.PARTY_SECRET);
    if (
      req.method === "POST" &&
      req.headers.get("X-Secret") === (this.room.env.PARTY_SECRET as string)
    ) {
      if (this.initialized) throw new Error("Room already initialized");

      const body = (await req.json()) as RoomInitializationPayload;
      this.initialized = true;
      this.playerIds = body.playerIds;
      console.log("initializing room", this.playerIds);

      return new Response("Room initialized", { status: 200 });
    }

    return Response.json(
      { initialized: this.initialized, playerIds: this.playerIds },
      { status: 200 }
    );
  }

  static async onBeforeConnect(request: Party.Request) {
    const playerId = new URL(request.url).searchParams.get("playerId")?.trim();
    if (!playerId) return new Response("Missing playerId", { status: 400 });
    request.headers.set("X-Player-Id", playerId);
    return request;
  }

  async onConnect(
    conn: Party.Connection<GameRoomConnectionState>,
    ctx: Party.ConnectionContext
  ): Promise<void> {
    if (!this.initialized) {
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

    if (this.players[idx]) {
      // player already connected, drop the new connection
      return conn.close();
    }

    conn.setState({ playerId, idx });
  }

  async onClose(
    connection: Party.Connection<GameRoomConnectionState>
  ): Promise<void> {
    const state = connection.state;
    if (state) {
      const { playerId, idx } = state;
      console.log(`Player ${playerId} disconnected`);
      this.players[idx] = null;
    }

    connection.close();
  }
}

import type * as Party from "partykit/server";
import { type RoomInitializationPayload } from "./constants";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}

  waiting: Party.Connection | null = null;

  static async onBeforeConnect(request: Party.Request, lobby: Party.Lobby) {
    if (lobby.id !== "global")
      return new Response("Bad room ID", { status: 400 });
    return request;
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    if (this.waiting) {
      // match found
      const player1 = this.waiting;
      const player2 = conn;
      this.waiting = null;

      const roomId = crypto.randomUUID();
      const room = this.room.context.parties.gameroom.get(roomId);
      const playerIds = [crypto.randomUUID(), crypto.randomUUID()];
      await room.fetch({
        method: "POST",
        body: JSON.stringify({ playerIds } as RoomInitializationPayload),
        headers: {
          "X-Secret": this.room.env.PARTY_SECRET as string,
        },
      });
      player1.send(
        JSON.stringify({ type: "match", roomId, playerId: playerIds[0] })
      );
      player2.send(
        JSON.stringify({ type: "match", roomId, playerId: playerIds[1] })
      );
      player1.close();
      player2.close();
    } else {
      this.waiting = conn;
    }
  }

  onClose(connection: Party.Connection): void | Promise<void> {
    if (this.waiting?.id === connection.id) {
      // if the waiting connection closes, we reset it
      this.waiting = null;
    }

    connection.close();
  }

  onMessage(message: string, sender: Party.Connection) {}
}

Server satisfies Party.Worker;

import { useParams } from "react-router";

export default function Match() {
  const { playerId, roomId } = useParams<"roomId" | "playerId">();
  if (!playerId || !roomId) throw new Error("Invalid match parameters");
  return (
    <div>
      ws://127.0.0.1:1999/parties/gameroom/{roomId}?playerId={playerId}
    </div>
  );
}

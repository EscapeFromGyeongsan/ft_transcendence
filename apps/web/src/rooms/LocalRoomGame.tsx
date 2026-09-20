import { useEffect } from "react";
import { OmokRoom } from "../games/omok/OmokRoom";
import { useLocalOmok } from "../games/omok/useLocalOmok";
import type { Room, RoomStatus } from "./types";

/** Kept mounted while visiting the lobby so each room owns an independent game. */
export function LocalRoomGame({
  room,
  onStatus,
}: {
  room: Room;
  onStatus: (id: string, status: Exclude<RoomStatus, "waiting">) => void;
}) {
  const session = useLocalOmok();
  const finished = Boolean(session.game.result);
  useEffect(() => {
    onStatus(room.id, finished ? "finished" : "playing");
  }, [room.id, finished, onStatus]);
  return (
    <OmokRoom
      session={session}
      roomTitle={room.title}
      playerNames={room.players.map((player) => player.name)}
    />
  );
}

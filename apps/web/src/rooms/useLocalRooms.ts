import { useCallback, useState } from "react";
import {
  PLAYER_NAME_LIMIT,
  ROOM_TITLE_LIMIT,
  type CreateRoomInput,
  type Room,
  type RoomStatus,
} from "./types";

/** In-memory room service. A future server adapter owns membership and authorization. */
export function useLocalRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
  function createRoom(input: CreateRoomInput): string | null {
    const title = input.title.trim(),
      hostName = input.hostName.trim();
    if (
      !title ||
      title.length > ROOM_TITLE_LIMIT ||
      !hostName ||
      hostName.length > PLAYER_NAME_LIMIT
    )
      return null;
    const id = crypto.randomUUID();
    const room: Room = {
      id,
      title,
      gameType: "omok",
      capacity: 2,
      status: "waiting",
      players: [
        { id: crypto.randomUUID(), name: hostName, seat: 0, ready: false },
      ],
    };
    setRooms((current) => [room, ...current]);
    return id;
  }
  function addGuest(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > PLAYER_NAME_LIMIT) return;
    const playerId = crypto.randomUUID();
    setRooms((current) =>
      current.map((room) =>
        room.id !== id ||
        room.status !== "waiting" ||
        room.players.length >= room.capacity ||
        room.players.some(
          (player) =>
            player.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
        )
          ? room
          : {
              ...room,
              players: [
                ...room.players.map((player) => ({ ...player, ready: false })),
                { id: playerId, name: trimmed, seat: 1, ready: false },
              ],
            },
      ),
    );
  }
  function removeGuest(id: string) {
    setRooms((current) =>
      current.map((room) =>
        room.id !== id || room.status !== "waiting"
          ? room
          : {
              ...room,
              players: room.players
                .filter((player) => player.seat === 0)
                .map((player) => ({ ...player, ready: false })),
            },
      ),
    );
  }
  function toggleReady(id: string, playerId: string) {
    setRooms((current) =>
      current.map((room) =>
        room.id !== id || room.status !== "waiting"
          ? room
          : {
              ...room,
              players: room.players.map((player) =>
                player.id === playerId
                  ? { ...player, ready: !player.ready }
                  : player,
              ),
            },
      ),
    );
  }
  function start(id: string) {
    setRooms((current) =>
      current.map((room) =>
        room.id === id &&
        room.status === "waiting" &&
        room.players.length === room.capacity &&
        room.players.every((player) => player.ready)
          ? { ...room, status: "playing" }
          : room,
      ),
    );
  }
  const updateGameStatus = useCallback(
    (id: string, status: Exclude<RoomStatus, "waiting">) => {
      setRooms((current) => {
        const room = current.find((room) => room.id === id);
        if (!room || room.status === "waiting" || room.status === status)
          return current;
        return current.map((room) =>
          room.id === id ? { ...room, status } : room,
        );
      });
    },
    [],
  );
  function close(id: string) {
    setRooms((current) => current.filter((room) => room.id !== id));
  }
  return {
    rooms,
    createRoom,
    addGuest,
    removeGuest,
    toggleReady,
    start,
    updateGameStatus,
    close,
  };
}
export type LocalRooms = ReturnType<typeof useLocalRooms>;

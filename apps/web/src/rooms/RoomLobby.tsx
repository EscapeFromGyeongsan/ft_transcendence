import { useState } from "react";
import { roomStatusLabels, type Room, type RoomStatus } from "./types";

export function RoomLobby({
  rooms,
  onCreate,
}: {
  rooms: readonly Room[];
  onCreate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | RoomStatus>("all");
  const matching = rooms.filter(
    (room) =>
      (filter === "all" || room.status === filter) &&
      `${room.title} ${room.players[0]?.name ?? ""}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="room-lobby" aria-labelledby="rooms-title">
      <div className="lobby-heading">
        <div>
          <div className="eyebrow">FIND YOUR TABLE</div>
          <h1 id="rooms-title">
            한 화면 대전 로비<span className="tag">로컬</span>
          </h1>
          <p>자리를 만들고, 이름을 나누고, 한 판을 시작해요.</p>
        </div>
        <button className="button primary" onClick={onCreate}>
          ＋ 방 만들기
        </button>
      </div>
      <div className="lobby-notice">
        <span className="notice-mark">i</span>
        <p>
          이 탭에서 만든 방만 보여요. 친구와 같은 화면에서 플레이하며, 다른
          기기에서는 방을 볼 수 없어요.
        </p>
      </div>
      <div className="lobby-toolbar">
        <div className="room-filters" role="group" aria-label="방 상태 필터">
          {(
            [
              ["all", "전체"],
              ["waiting", "대기 중"],
              ["playing", "대국 중"],
              ["finished", "종료"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>
                {value === "all"
                  ? rooms.length
                  : rooms.filter((room) => room.status === value).length}
              </span>
            </button>
          ))}
        </div>
        <label className="room-search">
          <span className="sr-only">방 이름 또는 방장 검색</span>
          <input
            type="search"
            placeholder="방 이름 또는 방장 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {!matching.length ? (
        <div className="empty-rooms">
          <span className="empty-room-symbol" aria-hidden="true">
            ⊞
          </span>
          <h2>
            {rooms.length ? "찾는 테이블이 없어요" : "아직 비어 있는 카페예요"}
          </h2>
          <p>
            {rooms.length
              ? "검색어나 상태 필터를 바꿔보세요."
              : "첫 번째 방을 만들고 오늘의 한 판을 준비해 볼까요?"}
          </p>
          {rooms.length ? (
            <button
              className="button secondary"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              전체 방 보기
            </button>
          ) : (
            <button className="button primary" onClick={onCreate}>
              첫 방 만들기 ↗
            </button>
          )}
        </div>
      ) : (
        <div className="room-list">
          {matching.map((room) => (
            <article className="room-list-card" key={room.id}>
              <div className="room-card-top">
                <span className="room-game-icon" aria-hidden="true">
                  <i className="mini-stone black" />
                  <i className="mini-stone white" />
                </span>
                <span className={`room-state ${room.status}`}>
                  <i />
                  {roomStatusLabels[room.status]}
                </span>
              </div>
              <h2>{room.title}</h2>
              <p>
                오목 <span>·</span> 15×15 자유룰
              </p>
              <div className="room-card-host">
                <span>방장</span>
                <strong>{room.players[0]?.name}</strong>
                <span className="room-occupancy">
                  {room.players.length} / {room.capacity}명
                </span>
              </div>
              <a className="button secondary" href={`#/local-rooms/${room.id}`}>
                {room.status === "waiting"
                  ? "대기실 열기"
                  : room.status === "playing"
                    ? "대국 이어가기"
                    : "결과 보기"}
                <span>↗</span>
              </a>
            </article>
          ))}
        </div>
      )}
      <p className="room-lobby-footer">
        한 화면에서 함께하는 오목 <span>·</span> 계정 없이 바로 시작
      </p>
    </section>
  );
}

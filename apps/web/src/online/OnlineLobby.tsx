import { useEffect, useState } from "react";
import { CreateRoomDialog } from "../rooms/CreateRoomDialog";
import { request, type Membership, type OnlineRoom } from "./api";

export function OnlineLobby() {
  const [user, setUser] = useState<{ displayName: string } | null>(null);
  const [rooms, setRooms] = useState<OnlineRoom[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      request<OnlineRoom[]>("")
        .then((value) => {
          if (alive) {
            setRooms(value);
            setError("");
          }
        })
        .catch((reason: Error) => {
          if (alive) setError(reason.message);
        });
    void fetch("/api/auth/me")
      .then((response) => response.json())
      .then((value) => {
        if (alive) setUser(value.user);
      })
      .catch(() => {
        if (alive) setError("로그인 상태를 확인하지 못했어요.");
      });
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="room-lobby" aria-labelledby="online-title">
      <div className="lobby-heading">
        <div>
          <div className="eyebrow">PLAY TOGETHER ONLINE</div>
          <h1 id="online-title">
            온라인 오목 로비 <span className="tag">멀티플레이</span>
          </h1>
          <p>각자 다른 브라우저에서 같은 방에 접속해 대국해요.</p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            user ? setCreating(true) : (window.location.hash = "/account")
          }
        >
          ＋ 온라인 방 만들기
        </button>
      </div>
      <p className="lobby-notice">
        로그인한 계정으로 방을 만들고 참가해요. 다른 사람과 대국하려면 각각의
        계정으로 로그인해 주세요.
      </p>
      <p className="form-error" role="alert">
        {error}
      </p>
      {!rooms.length && !error && (
        <div className="empty-rooms">
          <h2>아직 온라인 방이 없어요</h2>
          <p>첫 번째 방을 만들어 보세요.</p>
        </div>
      )}
      <div className="room-list">
        {rooms.map((room) => (
          <article className="room-list-card" key={room.id}>
            <span className={`room-state ${room.status}`}>
              {room.status === "waiting"
                ? "대기 중"
                : room.status === "playing"
                  ? "대국 중"
                  : "종료"}
            </span>
            <h2>{room.title}</h2>
            <p>오목 · 15×15 자유룰</p>
            <div className="room-card-host">
              <span>방장</span>
              <strong>{room.players[0]?.name}</strong>
              <span className="room-occupancy">{room.players.length}/2명</span>
            </div>
            <a className="button secondary" href={`#/online/${room.id}`}>
              방 열기 ↗
            </a>
          </article>
        ))}
      </div>
      {creating && (
        <CreateRoomDialog
          mode="online"
          accountName={user?.displayName}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            try {
              const created = await request<Membership>("", "POST", input);
              setCreating(false);
              window.location.hash = `/online/${created.room.id}`;
            } catch (reason) {
              setCreating(false);
              setError((reason as Error).message);
            }
          }}
        />
      )}
    </section>
  );
}

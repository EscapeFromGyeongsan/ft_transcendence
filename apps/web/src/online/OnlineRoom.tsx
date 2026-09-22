import { useEffect, useId, useState, type FormEvent } from "react";
import { Board, coordinate } from "../games/omok/Board";
import {
  membership,
  forgetMembership,
  request,
  saveMembership,
  type ActionRequest,
  type Membership,
  type OnlineRoom as Room,
} from "./api";

export function OnlineRoom({ id }: { id: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [member, setMember] = useState(() => membership(id));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const helpId = useId();
  useEffect(() => {
    let alive = true;
    setRoom(null);
    setMember(membership(id));
    setError("");
    void request<Room>(`/${id}`)
      .then((value) => {
        if (alive) setRoom(value);
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message);
      });
    const events = new EventSource(`/api/rooms/${id}/events`);
    events.onmessage = (event) => {
      if (alive) {
        setRoom(JSON.parse(event.data) as Room);
        setConnected(true);
        setError("");
      }
    };
    events.addEventListener("closed", () => {
      events.close();
      if (alive) {
        setRoom(null);
        setError("방이 닫혔어요.");
      }
    });
    events.onerror = () => {
      if (alive) setConnected(false);
    };
    return () => {
      alive = false;
      events.close();
    };
  }, [id]);
  const self = room?.players.find((player) => player.id === member?.playerId);
  const myTurn = Boolean(
    self &&
    room?.status === "playing" &&
    room.game.currentTurn === (self.seat === 0 ? "black" : "white"),
  );
  const host = self?.seat === 0;
  async function perform<T>(
    method: string,
    suffix: string,
    data?: unknown,
    onDone?: (value: T) => void,
  ) {
    if (pending || !member) return;
    setPending(true);
    setError("");
    try {
      const value = await request<T>(
        `/${id}${suffix}`,
        method,
        data,
        member.token,
      );
      onDone?.(value);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function join(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const value = await request<Membership>(`/${id}/join`, "POST", { name });
      saveMembership(id, value);
      setMember({ token: value.token, playerId: value.playerId });
      setRoom(value.room);
      setName("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  function move(x: number, y: number) {
    if (!room || pending) return;
    if (!myTurn) {
      setError("상대의 차례예요.");
      return;
    }
    void perform<Room>(
      "POST",
      "/action",
      {
        action: { type: "PLACE_STONE", x, y },
        expectedVersion: room.game.stateVersion,
      } satisfies ActionRequest,
      setRoom,
    );
  }
  return (
    <section className="online-room">
      <a className="back-link" href="#/online">
        ← 온라인 로비
      </a>
      <div className="room-heading">
        <div>
          <div className="eyebrow">ONLINE TABLE</div>
          <h1>
            {room?.title ?? "온라인 오목"}{" "}
            <span className="tag">멀티플레이</span>
          </h1>
          <p>
            {connected
              ? "서버와 연결됐어요."
              : "서버에 연결 중이에요. 연결이 끊기면 자동으로 다시 시도합니다."}
          </p>
        </div>
        <span className="room-rule">15 × 15 · 자유룰</span>
      </div>
      <p className="form-error" role="alert">
        {error}
      </p>
      {!room ? (
        <div className="empty-rooms">
          <p>방 정보를 불러오는 중이에요.</p>
        </div>
      ) : (
        <>
          <div className="side-panel">
            <div className="section-label">초대 링크</div>
            <p>
              친구에게 이 주소를 보내세요: <code>{window.location.href}</code>
            </p>
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(window.location.href)
                  .catch(() => setError("주소를 복사하지 못했어요."))
              }
            >
              주소 복사
            </button>
          </div>
          {room.status === "waiting" && (
            <div className="waiting-layout">
              <div className="seating-panel">
                <div className="section-label">
                  플레이어 자리 <span>{room.players.length}/2명</span>
                </div>
                <div className="player-seats">
                  {[0, 1].map((seat) => {
                    const player = room.players.find(
                      (value) => value.seat === seat,
                    );
                    return (
                      <article className="seat" key={seat}>
                        <div className="seat-top">
                          <span>SEAT 0{seat + 1}</span>
                          <span>{seat === 0 ? "방장 · 흑돌" : "백돌"}</span>
                        </div>
                        <h2>
                          {player?.name ?? "빈자리"}
                          {player?.id === self?.id ? " (나)" : ""}
                        </h2>
                        <p>
                          {player
                            ? player.ready
                              ? "준비 완료"
                              : "준비 중"
                            : "친구를 기다리고 있어요."}
                        </p>
                        {player && player.id === self?.id && (
                          <button
                            className="button secondary"
                            disabled={pending}
                            onClick={() => void perform("POST", "/ready")}
                          >
                            {player.ready ? "준비 취소" : "준비하기"}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
                {!self && room.players.length < 2 && (
                  <form className="guest-form" onSubmit={join}>
                    <label htmlFor="online-name">참가할 이름</label>
                    <input
                      id="online-name"
                      required
                      maxLength={16}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="플레이어 이름"
                    />
                    <button className="button primary" disabled={pending}>
                      입장하기
                    </button>
                  </form>
                )}
                {!self && room.players.length === 2 && (
                  <p>방이 가득 찼어요. 관전할 수 있습니다.</p>
                )}
                {self?.seat === 1 && (
                  <button
                    className="button quiet"
                    disabled={pending}
                    onClick={() =>
                      void perform("POST", "/leave", undefined, () => {
                        forgetMembership(id);
                        setMember(null);
                      })
                    }
                  >
                    자리 비우기
                  </button>
                )}
              </div>
              <aside className="waiting-details">
                <div className="start-panel">
                  <p>두 사람 모두 준비하면 방장이 대국을 시작합니다.</p>
                  {host && (
                    <button
                      className="button primary"
                      disabled={
                        pending ||
                        room.players.length !== 2 ||
                        !room.players.every((player) => player.ready)
                      }
                      onClick={() => void perform("POST", "/start")}
                    >
                      대국 시작하기 ↗
                    </button>
                  )}
                </div>
              </aside>
            </div>
          )}
          {room.status !== "waiting" && (
            <div className="room-layout">
              <section className="table-panel" aria-label="온라인 대국 테이블">
                <div className="table-status">
                  <div className="status-copy" role="status" aria-live="polite">
                    <strong>
                      {room.game.result
                        ? room.game.result.kind === "draw"
                          ? "무승부"
                          : `${room.game.result.winner === "black" ? "흑" : "백"}돌 승리!`
                        : `${room.game.currentTurn === "black" ? "흑" : "백"}돌 차례${myTurn ? " · 내 차례" : ""}`}
                    </strong>
                  </div>
                  <span>{room.game.moves.length}수</span>
                </div>
                <Board game={room.game} onPlace={move} helpId={helpId} />
                <p id={helpId} className="board-caption">
                  {self
                    ? myTurn
                      ? "원하는 교차점을 선택하세요."
                      : "상대의 수를 기다려 주세요."
                    : "관전 중입니다."}
                </p>
              </section>
              <aside className="room-sidebar">
                <section className="side-panel">
                  <div className="section-label">PLAYERS</div>
                  {room.players.map((player) => (
                    <div className="player" key={player.id}>
                      <span
                        className={`player-avatar ${player.seat === 0 ? "black" : "white"}`}
                      >
                        <i
                          className={`mini-stone ${player.seat === 0 ? "black" : "white"}`}
                        />
                      </span>
                      <strong>
                        {player.name}
                        {player.id === self?.id ? " (나)" : ""}
                      </strong>
                    </div>
                  ))}
                </section>
                <section className="side-panel history-panel">
                  <div className="section-label">
                    착수 기록 <span>{room.game.moves.length}수</span>
                  </div>
                  <ol className="move-history">
                    {room.game.moves.map((move, index) => (
                      <li key={index}>
                        {index + 1}. {move.stone === "black" ? "흑" : "백"}{" "}
                        {coordinate(move.x, move.y)}
                      </li>
                    ))}
                  </ol>
                </section>
                {room.status === "playing" && self && (
                  <button
                    className="button quiet"
                    disabled={pending}
                    onClick={() => {
                      if (myTurn && window.confirm("정말 기권할까요?"))
                        void perform("POST", "/action", {
                          action: { type: "RESIGN" },
                          expectedVersion: room.game.stateVersion,
                        } satisfies ActionRequest);
                      else setError("자신의 차례에 기권할 수 있어요.");
                    }}
                  >
                    기권하기
                  </button>
                )}
                {room.status === "finished" && host && (
                  <button
                    className="button primary"
                    disabled={pending}
                    onClick={() => void perform("POST", "/rematch")}
                  >
                    재대국 준비하기
                  </button>
                )}
              </aside>
            </div>
          )}
          {host && (
            <button
              className="button quiet"
              disabled={pending}
              onClick={() => {
                if (window.confirm("이 방을 닫을까요?"))
                  void perform("DELETE", "", undefined, () => {
                    forgetMembership(id);
                    window.location.hash = "/online";
                  });
              }}
            >
              방 닫기
            </button>
          )}
        </>
      )}
    </section>
  );
}

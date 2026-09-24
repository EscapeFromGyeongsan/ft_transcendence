import { connectRoom } from "./connection";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getGamePresentation } from "../games/registry";
import {
  request,
  type ActionRequest,
  type Membership,
  type OnlineRoom as Room,
} from "./api";

export function OnlineRoom({ id }: { id: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [member, setMember] = useState<{ playerId: string } | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const connection = useRef<ReturnType<typeof connectRoom> | null>(null);
  const acceptRoom = (value: Room) =>
    setRoom((previous) =>
      !previous ||
      previous.id !== value.id ||
      value.revision >= previous.revision
        ? value
        : previous,
    );
  useEffect(() => {
    let alive = true;
    setRoom(null);
    setMember(null);
    setError("");
    setConnected(false);
    const client = connectRoom(id, {
      snapshot: (value, playerId) => {
        if (alive) {
          setMember(playerId ? { playerId } : null);
          acceptRoom(value);
          setError("");
        }
      },
      connected: (value) => {
        if (alive) setConnected(value);
      },
      closed: () => {
        if (alive) {
          setRoom(null);
          setError("방이 닫혔어요.");
          setMember(null);
        }
      },
    });
    connection.current = client;
    return () => {
      alive = false;
      client.dispose();
      connection.current = null;
    };
  }, [id]);
  const self = room?.players.find((player) => player.id === member?.playerId);
  const presentation = room ? getGamePresentation(room.gameType) : undefined;
  const host = self?.seat === 0;
  async function perform<T>(
    method: string,
    suffix: string,
    data?: unknown,
    onDone?: (value: T) => void,
  ) {
    if (pending || !self) return;
    setPending(true);
    setError("");
    try {
      const value = await connection.current!.command(
        method === "DELETE" ? "close" : suffix.slice(1),
        data,
      );
      onDone?.(value as T);
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
      const value = await request<Membership>(`/${id}/join`, "POST", {});
      setMember({ playerId: value.playerId });
      acceptRoom(value.room);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
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
            {room?.title ?? "온라인 게임"}{" "}
            <span className="tag">멀티플레이</span>
          </h1>
          <p>
            {connected
              ? "서버와 연결됐어요."
              : "서버에 연결 중이에요. 연결이 끊기면 자동으로 다시 시도합니다."}
          </p>
        </div>
        <span className="room-rule">{presentation?.ruleLabel}</span>
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
                  플레이어 자리{" "}
                  <span>
                    {room.players.length}/{room.capacity}명
                  </span>
                </div>
                <div className="player-seats">
                  {Array.from(
                    { length: room.capacity },
                    (_, index) => index,
                  ).map((seat) => {
                    const player = room.players.find(
                      (value) => value.seat === seat,
                    );
                    return (
                      <article className="seat" key={seat}>
                        <div className="seat-top">
                          <span>SEAT 0{seat + 1}</span>
                          <span>
                            {presentation?.seatLabel(seat) ??
                              (seat === 0 ? "방장" : `참가자 ${seat + 1}`)}
                          </span>
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
                            disabled={pending || !connected}
                            onClick={() => void perform("POST", "/ready")}
                          >
                            {player.ready ? "준비 취소" : "준비하기"}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
                {!self && room.players.length < room.capacity && (
                  <form className="guest-form" onSubmit={join}>
                    <p>로그인한 계정의 닉네임으로 입장해요.</p>
                    {!member && <a href="#/account">로그인 / 회원가입</a>}
                    <button
                      className="button primary"
                      disabled={pending || !connected}
                    >
                      입장하기
                    </button>
                  </form>
                )}
                {!self && room.players.length === room.capacity && (
                  <p>방이 가득 찼어요. 관전할 수 있습니다.</p>
                )}
                {self && self.seat !== 0 && (
                  <button
                    className="button quiet"
                    disabled={pending || !connected}
                    onClick={() => void perform("POST", "/leave")}
                  >
                    자리 비우기
                  </button>
                )}
              </div>
              <aside className="waiting-details">
                <div className="start-panel">
                  <p>
                    각자 자기 화면에서 준비해 주세요. 모든 참가자가 준비하면
                    방장이 대국을 시작합니다.
                  </p>
                  {host && (
                    <button
                      className="button primary"
                      disabled={
                        pending ||
                        !connected ||
                        room.players.length !== room.capacity ||
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
            <>
              {presentation ? (
                <presentation.OnlineGame
                  room={room}
                  self={self}
                  pending={pending}
                  connected={connected}
                  onError={setError}
                  onAction={(action) =>
                    void perform("POST", "/action", {
                      action,
                      expectedVersion: room.game.stateVersion,
                      matchId: room.matchId,
                    } satisfies ActionRequest)
                  }
                />
              ) : (
                <p role="alert">이 게임의 화면은 아직 지원하지 않아요.</p>
              )}
              {room.status === "finished" && host && (
                <button
                  className="button primary"
                  disabled={pending || !connected}
                  onClick={() => void perform("POST", "/rematch")}
                >
                  재대국 준비하기
                </button>
              )}
            </>
          )}
          {room.status === "finished" && self && (
            <a className="button secondary" href="#/history">
              내 전적 보기
            </a>
          )}
          {host && (
            <button
              className="button quiet"
              disabled={pending || !connected}
              onClick={() => {
                if (window.confirm("이 방을 닫을까요?"))
                  void perform("DELETE", "", undefined, () => {
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

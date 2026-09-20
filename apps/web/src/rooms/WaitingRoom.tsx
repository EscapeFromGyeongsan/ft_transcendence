import { useState, type FormEvent } from "react";
import { PLAYER_NAME_LIMIT, type Room } from "./types";
import type { LocalRooms } from "./useLocalRooms";

export function WaitingRoom({
  room,
  service,
}: {
  room: Room;
  service: LocalRooms;
}) {
  const [guest, setGuest] = useState("");
  const [error, setError] = useState("");
  const canStart =
    room.players.length === room.capacity &&
    room.players.every((player) => player.ready);
  function addGuest(event: FormEvent) {
    event.preventDefault();
    if (!guest.trim()) {
      setError("두 번째 플레이어 이름을 입력해 주세요.");
      return;
    }
    if (
      room.players.some(
        (player) =>
          player.name.toLocaleLowerCase() === guest.trim().toLocaleLowerCase(),
      )
    ) {
      setError("서로 구분할 수 있도록 다른 이름을 사용해 주세요.");
      return;
    }
    service.addGuest(room.id, guest);
    setGuest("");
    setError("");
  }
  return (
    <section className="waiting-room" aria-labelledby={`waiting-${room.id}`}>
      <div className="waiting-heading">
        <div>
          <div className="eyebrow">BEFORE THE FIRST MOVE</div>
          <h1 id={`waiting-${room.id}`}>{room.title}</h1>
          <p>두 사람의 자리를 정하고, 준비가 끝나면 시작해요.</p>
        </div>
        <span className="room-state waiting">
          <i />
          대기 중
        </span>
      </div>
      <div className="waiting-layout">
        <div className="seating-panel">
          <div className="section-label">
            플레이어 자리
            <span>
              {room.players.length} / {room.capacity}명
            </span>
          </div>
          <div className="player-seats">
            {Array.from({ length: room.capacity }, (_, seat) => {
              const player = room.players.find(
                (player) => player.seat === seat,
              );
              return (
                <article
                  className={`seat ${player?.ready ? "ready" : ""}`}
                  key={seat}
                  aria-label={`${seat + 1}번 자리`}
                >
                  <div className="seat-top">
                    <span>SEAT 0{seat + 1}</span>
                    <span>{seat === 0 ? "방장 · 흑돌" : "백돌"}</span>
                  </div>
                  <div
                    className={`seat-avatar ${seat === 0 ? "black" : "white"}`}
                    aria-hidden="true"
                  >
                    {player ? (
                      <i
                        className={`mini-stone ${seat === 0 ? "black" : "white"}`}
                      />
                    ) : (
                      "+"
                    )}
                  </div>
                  {player ? (
                    <>
                      <h2>{player.name}</h2>
                      <p>
                        {player.ready
                          ? "준비를 마쳤어요"
                          : "준비 버튼을 눌러 주세요"}
                      </p>
                      <button
                        className={`button ${player.ready ? "primary" : "secondary"}`}
                        aria-label={`${player.name} 준비`}
                        aria-pressed={player.ready}
                        onClick={() => service.toggleReady(room.id, player.id)}
                      >
                        {player.ready ? "✓ 준비 완료" : "준비하기"}
                      </button>
                      {seat !== 0 && (
                        <button
                          className="seat-remove"
                          onClick={() => service.removeGuest(room.id)}
                        >
                          자리 비우기
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <h2>함께 둘 친구의 자리</h2>
                      <p>같은 화면에서 플레이할 이름을 적어 주세요.</p>
                      <form className="guest-form" onSubmit={addGuest}>
                        <label className="sr-only" htmlFor={`guest-${room.id}`}>
                          두 번째 플레이어 이름
                        </label>
                        <input
                          id={`guest-${room.id}`}
                          required
                          maxLength={PLAYER_NAME_LIMIT}
                          placeholder="플레이어 이름"
                          value={guest}
                          onChange={(event) => {
                            setGuest(event.target.value);
                            setError("");
                          }}
                        />
                        <button className="button secondary" type="submit">
                          자리 추가
                        </button>
                        <p className="form-error" role="alert">
                          {error}
                        </p>
                      </form>
                    </>
                  )}
                </article>
              );
            })}
          </div>
          <div className="waiting-tip">
            <span>01</span>
            <p>이름을 정해요</p>
            <span>02</span>
            <p>각자 준비해요</p>
            <span>03</span>
            <p>한 판 시작!</p>
          </div>
        </div>
        <aside className="waiting-details">
          <section className="side-panel">
            <div className="section-label">
              오늘의 게임<span>OMOK</span>
            </div>
            <h2>오목</h2>
            <dl>
              <div>
                <dt>참가 인원</dt>
                <dd>2명</dd>
              </div>
              <div>
                <dt>보드 크기</dt>
                <dd>15 × 15</dd>
              </div>
              <div>
                <dt>규칙</dt>
                <dd>자유룰 · 흑 선공</dd>
              </div>
            </dl>
            <p>
              돌을 5개 이상 연속으로 연결하면 승리해요. 금수와 무르기는 없어요.
            </p>
          </section>
          <div className="start-panel">
            <p aria-live="polite">
              {canStart
                ? "모두 준비됐어요. 첫 수를 놓으러 갈까요?"
                : room.players.length < room.capacity
                  ? "두 번째 플레이어의 자리를 추가해 주세요."
                  : "두 사람 모두 준비하면 시작할 수 있어요."}
            </p>
            <button
              className="button primary"
              disabled={!canStart}
              onClick={() => service.start(room.id)}
            >
              대국 시작하기 ↗
            </button>
            <small>같은 화면에서 번갈아 두는 로컬 대국이에요.</small>
          </div>
        </aside>
      </div>
    </section>
  );
}

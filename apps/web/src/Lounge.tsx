import { games } from "./games/registry";

function MiniBoard({ large = false }: { large?: boolean }) {
  return (
    <div className={`mini-board ${large ? "large" : ""}`} aria-hidden="true">
      <div className="mini-grid" />
      {[
        [3, 3, "black"],
        [4, 3, "white"],
        [4, 4, "black"],
        [5, 4, "white"],
        [5, 5, "black"],
        [3, 5, "white"],
        [6, 6, "black"],
      ].map(([x, y, stone], i) => (
        <i
          key={i}
          className={`decor-stone ${stone}`}
          style={{ left: `${Number(x) * 10}%`, top: `${Number(y) * 10}%` }}
        />
      ))}
    </div>
  );
}

export function Lounge({ hasGame }: { hasGame: boolean }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> THE TABLE IS YOURS
          </div>
          <h1>
            잠깐 쉬어가요.
            <br />한 판의 여유와 함께.
          </h1>
          <p>
            각자의 화면에서, 친구와 같은 테이블에.
            <br />
            좋아하는 자리에 앉아 첫 수를 놓아보세요.
          </p>
          <a className="button primary" href="#/rooms">
            온라인 오목 시작하기 <span>↗</span>
          </a>
          <a className="lounge-room-link" href="#/rooms">
            게임 로비에서 방 만들기 →
          </a>
          <a className="lounge-room-link" href="#/omok">
            {hasGame ? "로컬 오목 이어하기" : "한 화면에서 둘이 · 로컬 오목"} →
          </a>
          <div className="hero-footnote">
            <span>회원가입 없이</span>
            <i />
            <span>각자 접속해 함께</span>
          </div>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="art-label top">
            A LITTLE BREAK.
            <br />A GOOD GAME.
          </span>
          <MiniBoard large />
          <span className="table-sticker">
            TABLE <strong>01</strong>
            <small>두 사람을 위한 자리</small>
          </span>
          <span className="art-label bottom">
            BLACK GOES FIRST — MAKE YOUR MOVE
          </span>
        </div>
      </section>
      <section className="lounge" aria-labelledby="lounge-title">
        <div className="lounge-heading">
          <div>
            <div className="eyebrow">PICK YOUR NEXT GAME</div>
            <h2 id="lounge-title">
              오늘의 게임 테이블<span>01</span>
            </h2>
          </div>
          <span className="available">
            <i /> 지금 플레이 가능
          </span>
        </div>
        <div className="game-shelf">
          {games.map((game) => (
            <a className="game-card" href="#/rooms" key={game.id}>
              <div className="card-art">
                <span className="card-tag">CLASSIC STRATEGY</span>
                <MiniBoard />
                <span className="card-number">01</span>
              </div>
              <div className="card-copy">
                <div className="game-title">
                  <h3>{game.title}</h3>
                  <span className="circle-arrow">↗</span>
                </div>
                <p>{game.subtitle}</p>
                <div className="game-meta">
                  <span>♙ {game.players}</span>
                  <span>◷ {game.duration}</span>
                  <span>{game.mode}</span>
                </div>
              </div>
            </a>
          ))}
          <div className="cafe-note">
            <span className="note-icon">✳</span>
            <div className="eyebrow">OUR LITTLE HOUSE RULES</div>
            <h3>
              승부는 진지하게,
              <br />
              시간은 느긋하게.
            </h3>
            <p>
              흑돌과 백돌을 나누고, 번갈아 한 수씩.
              <br />잘 둔 수에는 감탄을, 끝난 판에는 인사를.
              <br />
              여기는 함께 즐기는 보드게임 카페니까요.
            </p>
            <div className="note-bottom">
              좋은 한 판 되세요 <span>↗</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

import { useEffect, useState } from "react";
import { games } from "./games/registry";
import { useLocalOmok } from "./games/omok/useLocalOmok";
import { OmokRoom } from "./games/omok/OmokRoom";

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
export function App() {
  const [page, setPage] = useState(() =>
    window.location.hash === "#/omok" ? "omok" : "lobby",
  );
  const session = useLocalOmok();
  useEffect(() => {
    const change = () => {
      setPage(window.location.hash === "#/omok" ? "omok" : "lobby");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.title = `${page === "omok" ? "로컬 오목" : "사이버 보드게임 카페"} · 사이보드`;
  }, [page]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="사이보드 홈">
          <span className="brand-symbol">
            <i />
            <i />
          </span>
          <span>
            사이보드<small>CYBER BOARD CAFÉ</small>
          </span>
        </a>
        <nav aria-label="주 메뉴">
          <a className={page === "lobby" ? "selected" : ""} href="#/">
            게임 라운지
          </a>
          {page === "omok" && (
            <a className="selected" href="#/omok">
              오목 테이블
            </a>
          )}
        </nav>
        <span className="local-pill">
          <i /> LOCAL PLAY
        </span>
      </header>
      <main id="main" tabIndex={-1}>
        {page === "lobby" ? (
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
                  화면 너머의 카페, 오늘은 바로 옆의 친구와.
                  <br />
                  좋아하는 자리에 앉아 첫 수를 놓아보세요.
                </p>
                <a className="button primary" href="#/omok">
                  {session.game.moves.length || session.game.result
                    ? "오목 테이블로 돌아가기"
                    : "오목 한 판 시작하기"}{" "}
                  <span>↗</span>
                </a>
                <div className="hero-footnote">
                  <span>회원가입 없이</span>
                  <i />
                  <span>한 화면에서 둘이</span>
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
                  <a className="game-card" href={`#/${game.id}`} key={game.id}>
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
        ) : (
          <>
            <a className="back-link" href="#/">
              ← 게임 라운지
            </a>
            <OmokRoom session={session} />
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>
          사이보드 <span className="footer-divider">/</span> 작은 화면 속,
          우리들의 보드게임 카페
        </span>
        <span>
          LOCAL EDITION <i /> 2026
        </span>
      </footer>
    </div>
  );
}

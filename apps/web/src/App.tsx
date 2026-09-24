import { History } from "./auth/History";
import { Account } from "./auth/Account";
import { useEffect, useState } from "react";
import { useLocalOmok } from "./games/omok/useLocalOmok";
import { OmokRoom } from "./games/omok/OmokRoom";
import { Lounge } from "./Lounge";
import { RoomLobby } from "./rooms/RoomLobby";
import { WaitingRoom } from "./rooms/WaitingRoom";
import { CreateRoomDialog } from "./rooms/CreateRoomDialog";
import { LocalRoomGame } from "./rooms/LocalRoomGame";
import { useLocalRooms } from "./rooms/useLocalRooms";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { OnlineLobby } from "./online/OnlineLobby";
import { OnlineRoom } from "./online/OnlineRoom";

export function App() {
  const [route, setRoute] = useState(
    () => window.location.hash.slice(1) || "/",
  );
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const session = useLocalOmok();
  const service = useLocalRooms();
  const isQuickGame = route === "/omok";
  const isLobby = route === "/local-rooms";
  const isOnlineLobby = route === "/online" || route === "/rooms";
  const onlineId = route.startsWith("/online/")
    ? route.slice("/online/".length)
    : route.startsWith("/rooms/")
      ? route.slice("/rooms/".length)
      : null;
  const roomId = route.startsWith("/local-rooms/")
    ? route.slice("/local-rooms/".length)
    : null;
  const activeRoom = service.rooms.find((room) => room.id === roomId);
  const missing =
    route !== "/" &&
    route !== "/account" &&
    route !== "/history" &&
    !isQuickGame &&
    !isLobby &&
    !isOnlineLobby &&
    !onlineId &&
    !activeRoom;
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.title = `${activeRoom?.title ?? (route === "/history" ? "내 전적" : route === "/account" ? "내 계정" : isOnlineLobby || onlineId ? "온라인 오목" : isLobby ? "로컬 로비" : isQuickGame ? "로컬 오목" : "사이버 보드게임 카페")} · 사이보드`;
  }, [route, activeRoom?.title, isLobby, isQuickGame, isOnlineLobby, onlineId]);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
          document.getElementById("main")?.scrollIntoView();
        }}
      >
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
          <a className={route === "/" ? "selected" : ""} href="#/">
            게임 라운지
          </a>
          <a
            className={isLobby || roomId ? "selected" : ""}
            href="#/local-rooms"
          >
            로컬 · 한 화면 대전
          </a>
          <a
            className={isOnlineLobby || onlineId ? "selected" : ""}
            href="#/rooms"
          >
            게임 로비
          </a>
          <a
            href="#/account"
            className={route === "/account" ? "selected" : ""}
          >
            내 계정
          </a>
          <a
            href="#/history"
            className={route === "/history" ? "selected" : ""}
          >
            내 전적
          </a>
          {isQuickGame && (
            <a className="selected" href="#/omok">
              오목 테이블
            </a>
          )}
        </nav>
        <span className="local-pill">
          <i /> {isOnlineLobby || onlineId ? "ONLINE PLAY" : "LOCAL PLAY"}
        </span>
      </header>
      <main id="main" tabIndex={-1}>
        {route === "/" && (
          <Lounge
            hasGame={Boolean(session.game.moves.length || session.game.result)}
          />
        )}
        {isLobby && (
          <RoomLobby rooms={service.rooms} onCreate={() => setCreating(true)} />
        )}
        {route === "/account" && <Account />}
        {route === "/history" && <History />}
        {isOnlineLobby && <OnlineLobby />}
        {onlineId && <OnlineRoom key={onlineId} id={onlineId} />}
        {isQuickGame && (
          <>
            <a className="back-link" href="#/">
              ← 게임 라운지
            </a>
            <OmokRoom session={session} />
          </>
        )}
        {service.rooms.map((room) => (
          <div hidden={room.id !== roomId} key={room.id}>
            <div className="room-breadcrumb">
              <a className="back-link" href="#/local-rooms">
                ← 로컬 로비
              </a>
              <button
                className="text-button"
                onClick={() => setClosing(room.id)}
              >
                방 닫기
              </button>
            </div>
            {room.status === "waiting" ? (
              <WaitingRoom room={room} service={service} />
            ) : (
              <LocalRoomGame room={room} onStatus={service.updateGameStatus} />
            )}
          </div>
        ))}
        {missing && (
          <div className="empty-rooms">
            <span className="empty-room-symbol">⊞</span>
            <h1>테이블을 찾을 수 없어요</h1>
            <p>
              방이 닫혔거나 새로고침으로 초기화되었어요.
              <br />
              로컬 방은 만든 탭 안에서만 유지돼요.
            </p>
            <a className="button primary" href="#/local-rooms">
              로컬 로비로 돌아가기
            </a>
          </div>
        )}
      </main>
      <footer className="site-footer">
        <span>
          사이보드 <span className="footer-divider">/</span> 작은 화면 속,
          우리들의 보드게임 카페
        </span>
        <span>
          BOARD CAFÉ <i /> 2026
        </span>
      </footer>
      {creating && (
        <CreateRoomDialog
          onClose={() => setCreating(false)}
          onCreate={(input) => {
            const id = service.createRoom(input);
            if (id) {
              setCreating(false);
              window.location.hash = `/local-rooms/${id}`;
            }
          }}
        />
      )}
      {closing && (
        <ConfirmDialog
          title="이 방을 닫을까요?"
          description="방과 진행 중인 대국, 착수 기록이 함께 사라져요. 로비로만 이동하면 그대로 유지할 수 있어요."
          confirmLabel="방 닫기"
          cancelLabel="방 유지하기"
          onClose={() => setClosing(null)}
          onConfirm={() => {
            service.close(closing);
            setClosing(null);
            window.location.hash = "/local-rooms";
          }}
        />
      )}
    </div>
  );
}

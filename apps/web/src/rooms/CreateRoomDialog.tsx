import { games } from "../games/registry";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PLAYER_NAME_LIMIT,
  ROOM_TITLE_LIMIT,
  type CreateRoomInput,
} from "./types";

export function CreateRoomDialog({
  onCreate,
  onClose,
  mode = "local",
  accountName,
}: {
  onCreate: (input: CreateRoomInput) => void | Promise<void>;
  onClose: () => void;
  mode?: "local" | "online";
  accountName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [hostName, setHostName] = useState(accountName ?? "");
  const [gameType, setGameType] = useState<string>(games[0].id);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !hostName.trim()) {
      setError("방 이름과 방장 이름을 공백 없이 입력해 주세요.");
      return;
    }
    onCreate({
      title: title.trim(),
      hostName: hostName.trim(),
      ...(mode === "online" ? { gameType } : {}),
    });
  }
  return (
    <dialog
      ref={ref}
      className="confirm-dialog create-room-dialog"
      aria-labelledby="create-room-title"
      onCancel={onClose}
    >
      <div className="dialog-top">
        <span className="eyebrow">YOUR OWN TABLE</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="방 만들기 닫기"
        >
          ×
        </button>
      </div>
      <h2 id="create-room-title">새로운 한 판을 위한 자리</h2>
      <p>방 이름을 정하고, 함께 둘 친구의 자리를 준비해요.</p>
      <form onSubmit={submit}>
        <label className="field">
          방 이름{" "}
          <span>
            {title.length}/{ROOM_TITLE_LIMIT}
          </span>
          <input
            autoFocus
            required
            maxLength={ROOM_TITLE_LIMIT}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError("");
            }}
            placeholder="예: 커피 한 잔과 오목 한 판"
          />
        </label>
        <label className="field">
          방장 이름
          <input
            required
            readOnly={mode === "online"}
            maxLength={PLAYER_NAME_LIMIT}
            value={hostName}
            onChange={(event) => {
              setHostName(event.target.value);
              setError("");
            }}
            placeholder="이 테이블에서 사용할 이름"
          />
        </label>
        <label className="field">
          게임
          <select
            value={gameType}
            onChange={(event) => setGameType(event.target.value)}
          >
            {(mode === "online"
              ? games
              : games.filter((game) => game.id === "omok")
            ).map((game) => (
              <option key={game.id} value={game.id}>
                {game.title} · {game.players} · {game.ruleLabel}
              </option>
            ))}
          </select>
        </label>
        <div className="room-form-note">
          <i />{" "}
          {mode === "local"
            ? "같은 화면에서 두는 로컬 테이블이에요."
            : "링크를 공유해 서로 다른 브라우저에서 대국해요."}
          <br />
          {mode === "local"
            ? "방과 대국은 새로고침하면 초기화돼요."
            : "서버가 실행되는 동안 방과 대국이 유지돼요."}
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="button primary">
            방 만들기 <span>↗</span>
          </button>
        </div>
      </form>
    </dialog>
  );
}

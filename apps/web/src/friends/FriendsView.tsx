import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  friendsApi,
  type FriendUser,
  type FriendsApi,
} from "../api/friends-api.ts";
import { Avatar } from "../profile/Avatar.tsx";
import { createFriendsController, type FriendAction } from "./friends-state.ts";

interface FriendsViewProps {
  currentUserId: number;
  connected: boolean;
  initialQuery?: string;
  onOpenProfile: (userId: number) => void;
  onBack: () => void;
  api?: FriendsApi;
}

interface Confirmation {
  action: Extract<FriendAction, { kind: "remove" | "accept" | "decline" }>;
  nickname: string;
}

/** 친구 REST 화면입니다. 알림·검색 응답 계약의 실제 서버 통합은 #38·#69에서 확인합니다. */
export function FriendsView({
  currentUserId,
  connected,
  initialQuery = "",
  onOpenProfile,
  onBack,
  api = friendsApi,
}: FriendsViewProps) {
  const [controller] = useState(() =>
    createFriendsController(api, currentUserId),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const activeRef = useRef(false);
  const cannotAct =
    state.pending !== null || state.loading || state.stale || !state.data;

  useEffect(() => {
    activeRef.current = true;
    controller.start(connected, initialQuery);
    return () => {
      activeRef.current = false;
      controller.stop();
    };
    // The parent keys this view by account. Connection changes are handled below.
  }, [controller]);
  useEffect(() => {
    controller.setConnected(connected);
  }, [controller, connected]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!confirmation || !dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [confirmation]);

  function closeConfirmation() {
    if (state.pending) return;
    setConfirmation(null);
    queueMicrotask(() => {
      if (triggerRef.current?.isConnected && !triggerRef.current.disabled)
        triggerRef.current.focus();
      else headingRef.current?.focus();
    });
  }

  async function confirmAction() {
    if (!confirmation || cannotAct) return;
    await controller.perform(confirmation.action);
    if (activeRef.current) {
      setConfirmation(null);
      queueMicrotask(() => {
        if (triggerRef.current?.isConnected && !triggerRef.current.disabled)
          triggerRef.current.focus();
        else headingRef.current?.focus();
      });
    }
  }

  function confirm(
    action: Confirmation["action"],
    nickname: string,
    trigger: HTMLButtonElement,
  ) {
    triggerRef.current = trigger;
    setConfirmation({ action, nickname });
  }

  function userLink(person: FriendUser) {
    return (
      <button
        className="cbc-friends-person"
        type="button"
        onClick={() => onOpenProfile(person.userId)}
        aria-label={`${person.nickname} 프로필 보기`}
      >
        <Avatar
          nickname={person.nickname}
          avatarUrl={person.avatarUrl}
          size={40}
        />
        <span>{person.nickname}</span>
      </button>
    );
  }

  function searchAction(person: FriendUser) {
    if (state.data?.friends.some((entry) => entry.userId === person.userId))
      return <span className="cbc-chip">친구</span>;
    if (state.data?.outgoing.some((entry) => entry.userId === person.userId))
      return <span className="cbc-chip">요청 보냄</span>;
    const incoming = state.data?.incoming.find(
      (entry) => entry.userId === person.userId,
    );
    return (
      <button
        className="cbc-btn-secondary cbc-btn-compact"
        type="button"
        disabled={cannotAct}
        onClick={() =>
          void controller.perform(
            incoming
              ? {
                  kind: "accept",
                  userId: person.userId,
                  requestId: incoming.requestId,
                }
              : { kind: "request", userId: person.userId },
          )
        }
      >
        {incoming ? "요청 수락" : "친구 요청"}
      </button>
    );
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void controller.search();
  }
  const onlineLabel = (online: boolean) =>
    state.onlineFresh && !state.stale && state.connected
      ? online
        ? "온라인"
        : "오프라인"
      : state.loading
        ? "확인 중"
        : "확인 불가";

  return (
    <div
      className="cbc-profile-page cbc-friends-page"
      data-testid="friends-view"
    >
      <div className="cbc-profile-topbar">
        <button type="button" className="cbc-link" onClick={onBack}>
          ← 로비로
        </button>
        <button
          type="button"
          className="cbc-btn-secondary cbc-btn-compact"
          disabled={state.loading || state.pending !== null}
          onClick={() => void controller.refresh()}
        >
          목록 새로고침
        </button>
      </div>
      <header>
        <span className="cbc-eyebrow">함께하는 보드 카페</span>
        <h1 className="cbc-profile-title" ref={headingRef} tabIndex={-1}>
          친구 관리
        </h1>
        <p className="cbc-subheading">
          플레이어를 찾아 친구 요청을 보내고, 받은 요청을 관리하세요.
        </p>
      </header>
      {state.notice && (
        <p className="cbc-success-banner" role="status">
          {state.notice}
        </p>
      )}
      {state.actionError && (
        <p className="cbc-error-banner" role="alert">
          {state.actionError}
        </p>
      )}
      {state.listError && (
        <div className="cbc-error-banner" role="alert">
          <span>
            {state.notice
              ? "변경은 완료됐지만 최신 목록을 불러오지 못했습니다. "
              : ""}
            {state.listError} 위의 목록 새로고침으로 다시 확인해 주세요.
          </span>
        </div>
      )}
      {state.loading && (
        <p role="status" className="cbc-subheading">
          친구 목록을 불러오는 중입니다...
        </p>
      )}
      {state.data && state.stale && !state.loading && (
        <p className="cbc-profile-hint" role="status">
          마지막으로 확인한 목록입니다. 다시 불러온 뒤 요청을 처리할 수
          있습니다.
        </p>
      )}
      {!state.connected && (
        <p className="cbc-profile-hint">
          연결을 확인하는 동안 친구의 온라인 상태를 확인할 수 없습니다.
        </p>
      )}

      <section
        className="cbc-profile-card"
        aria-labelledby="friends-search-title"
      >
        <h2 className="cbc-profile-section-title" id="friends-search-title">
          플레이어 검색
        </h2>
        <form className="cbc-friends-search" onSubmit={search}>
          <div className="cbc-field">
            <label className="cbc-label" htmlFor="friends-nickname">
              닉네임으로 검색
            </label>
            <input
              className="cbc-input"
              id="friends-nickname"
              value={state.query}
              maxLength={32}
              onChange={(event) =>
                controller.setQuery(event.currentTarget.value)
              }
              aria-describedby="friends-search-help"
              autoComplete="off"
            />
          </div>
          <button
            className="cbc-btn-primary cbc-btn-compact"
            type="submit"
            disabled={state.searching || !state.query.trim()}
          >
            검색
          </button>
        </form>
        <p className="cbc-profile-hint" id="friends-search-help">
          닉네임의 앞부분으로 검색하며 최대 20명을 표시합니다.
        </p>
        {state.searching && <p role="status">검색 중입니다...</p>}
        {state.searchError && (
          <p className="cbc-error-banner" role="alert">
            {state.searchError}
          </p>
        )}
        {state.results?.length === 0 && (
          <p role="status">검색 결과가 없습니다.</p>
        )}
        {state.results && state.results.length > 0 && (
          <ul className="cbc-friends-list" aria-label="검색 결과">
            {state.results.map((person) => (
              <li key={person.userId}>
                {userLink(person)}
                <div className="cbc-friends-actions">
                  {searchAction(person)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!state.data && (
          <p className="cbc-profile-hint">
            친구 목록을 확인한 뒤 요청을 보낼 수 있습니다.
          </p>
        )}
      </section>

      <div className="cbc-friends-grid">
        <section
          className="cbc-profile-card"
          aria-labelledby="friends-list-title"
        >
          <h2 className="cbc-profile-section-title" id="friends-list-title">
            친구 목록
          </h2>
          {state.data ? (
            state.data.friends.length === 0 ? (
              <p>아직 친구가 없습니다.</p>
            ) : (
              <ul className="cbc-friends-list" aria-label="친구 목록">
                {state.data.friends.map((person) => (
                  <li key={person.userId}>
                    {userLink(person)}
                    <div className="cbc-friends-actions">
                      <span
                        className={`cbc-chip ${state.onlineFresh && !state.stale && person.online ? "is-online" : ""}`}
                      >
                        {onlineLabel(person.online)}
                      </span>
                      <button
                        type="button"
                        className="cbc-link cbc-link-danger"
                        disabled={cannotAct}
                        onClick={(event) =>
                          confirm(
                            { kind: "remove", userId: person.userId },
                            person.nickname,
                            event.currentTarget,
                          )
                        }
                      >
                        친구 삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            !state.loading && <p>친구 목록을 아직 확인하지 못했습니다.</p>
          )}
        </section>
        <section
          className="cbc-profile-card"
          aria-labelledby="friends-incoming-title"
        >
          <h2 className="cbc-profile-section-title" id="friends-incoming-title">
            받은 요청
          </h2>
          {state.data ? (
            state.data.incoming.length === 0 ? (
              <p>받은 요청이 없습니다.</p>
            ) : (
              <ul className="cbc-friends-list" aria-label="받은 요청">
                {state.data.incoming.map((person) => (
                  <li key={person.requestId}>
                    {userLink(person)}
                    <div className="cbc-friends-actions">
                      <button
                        type="button"
                        className="cbc-btn-secondary cbc-btn-compact"
                        disabled={cannotAct}
                        onClick={() =>
                          void controller.perform({
                            kind: "accept",
                            userId: person.userId,
                            requestId: person.requestId,
                          })
                        }
                      >
                        수락
                      </button>
                      <button
                        type="button"
                        className="cbc-link"
                        disabled={cannotAct}
                        onClick={(event) =>
                          confirm(
                            {
                              kind: "decline",
                              userId: person.userId,
                              requestId: person.requestId,
                            },
                            person.nickname,
                            event.currentTarget,
                          )
                        }
                      >
                        거절
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            !state.loading && <p>받은 요청을 아직 확인하지 못했습니다.</p>
          )}
        </section>
        <section
          className="cbc-profile-card"
          aria-labelledby="friends-outgoing-title"
        >
          <h2 className="cbc-profile-section-title" id="friends-outgoing-title">
            보낸 요청
          </h2>
          {state.data ? (
            state.data.outgoing.length === 0 ? (
              <p>보낸 요청이 없습니다.</p>
            ) : (
              <ul className="cbc-friends-list" aria-label="보낸 요청">
                {state.data.outgoing.map((person) => (
                  <li key={person.requestId}>
                    {userLink(person)}
                    <span className="cbc-chip">수락 대기</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            !state.loading && <p>보낸 요청을 아직 확인하지 못했습니다.</p>
          )}
        </section>
      </div>
      {confirmation && (
        <dialog
          className="cbc-modal-dialog cbc-friends-dialog"
          ref={dialogRef}
          aria-labelledby="friends-confirm-title"
          aria-describedby="friends-confirm-description"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              );
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (!first || !last) {
              event.preventDefault();
              return;
            }
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              first.focus();
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            closeConfirmation();
          }}
        >
          <h2 id="friends-confirm-title">
            {confirmation.action.kind === "decline"
              ? "친구 요청을 거절하시겠습니까?"
              : "친구 관계를 삭제하시겠습니까?"}
          </h2>
          <p>{confirmation.nickname} 님</p>
          <p id="friends-confirm-description">
            {confirmation.action.kind === "decline"
              ? "거절하면 상대는 다시 친구 요청을 보낼 수 없습니다. 마음이 바뀌면 내가 먼저 요청할 수 있습니다."
              : "친구 목록에서 서로 삭제됩니다. 이후에는 다시 친구 요청을 보낼 수 있습니다."}
          </p>
          <div className="cbc-modal-actions">
            <button
              type="button"
              className="cbc-btn-secondary"
              autoFocus
              disabled={state.pending !== null}
              onClick={closeConfirmation}
            >
              취소
            </button>
            <button
              type="button"
              className="cbc-btn-danger"
              disabled={cannotAct}
              onClick={() => void confirmAction()}
            >
              {state.pending
                ? "처리 중..."
                : confirmation.action.kind === "decline"
                  ? "거절하기"
                  : "삭제하기"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

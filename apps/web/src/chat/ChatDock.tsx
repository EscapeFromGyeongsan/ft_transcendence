import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { authApi } from "../api/auth-client.ts";
import { ApiError, getErrorMessage } from "../api/errors.ts";

type Conversation = {
  friendshipId: number;
  userId: number;
  nickname: string;
  lastMessageAt: string | null;
};
type Message = {
  id: number;
  senderId: number;
  text: string;
  createdAt: string;
};
type History = { messages: Message[]; nextBefore: number | null };

const time = new Intl.DateTimeFormat("ko-KR", {
  hour: "numeric",
  minute: "2-digit",
});

function messageError(error: unknown) {
  return error instanceof ApiError && error.status === 404
    ? "친구 관계가 변경되어 대화를 열 수 없습니다."
    : getErrorMessage(error);
}

function combine(messages: Message[], next: Message[]) {
  return [
    ...new Map([...messages, ...next].map((item) => [item.id, item])).values(),
  ].sort((a, b) => a.id - b.id);
}

/** 대국이나 로비에서 열고 접을 수 있는 친구 채팅입니다. */
export function ChatDock({
  userId,
  refreshVersion,
}: {
  userId: number;
  refreshVersion: number;
}) {
  const titleId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [peerId, setPeerId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>();
  const [listError, setListError] = useState("");
  const [retry, setRetry] = useState(0);
  const peer = conversations?.find((item) => item.userId === peerId);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    authApi
      .request<Conversation[]>("/api/chat/conversations", {
        signal: controller.signal,
      })
      .then((items) => {
        if (controller.signal.aborted) return;
        setConversations(items);
        setListError("");
        setPeerId((previous) =>
          items.some((item) => item.userId === previous) ? previous : null,
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListError(messageError(error));
      });
    return () => controller.abort();
  }, [open, refreshVersion, retry]);

  useLayoutEffect(() => {
    if (open) heading.current?.focus();
  }, [open, peer?.userId]);

  function minimize() {
    setOpen(false);
    launcher.current?.focus();
  }

  return (
    <aside
      aria-label="친구 채팅"
      className="pointer-events-none fixed right-3 bottom-3 z-30 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col items-end gap-2 sm:right-6 sm:bottom-5"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          minimize();
        }
      }}
    >
      <section
        hidden={!open}
        id={titleId}
        aria-label={peer ? peer.nickname + " 님과의 대화" : "대화 목록"}
        className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-xl"
      >
        <header className="flex items-center gap-2 border-0 border-b border-solid border-outline-variant px-3 py-2">
          {peer && (
            <button
              type="button"
              className="cbc-btn-secondary w-auto px-2 py-1 text-sm"
              onClick={() => setPeerId(null)}
              aria-label="대화 목록"
            >
              ←
            </button>
          )}
          <h2
            ref={heading}
            tabIndex={-1}
            className="m-0 min-w-0 flex-1 truncate text-base font-semibold"
          >
            {peer?.nickname ?? "친구 채팅"}
          </h2>
          <button
            type="button"
            className="cbc-btn-secondary w-auto px-2 py-1 text-sm"
            onClick={minimize}
            aria-label="채팅 최소화"
          >
            −
          </button>
        </header>

        {peer ? (
          <ChatConversation
            key={peer.friendshipId}
            peer={peer}
            userId={userId}
            open={open}
            refreshVersion={refreshVersion}
          />
        ) : (
          <div className="h-[min(18rem,44dvh)] overflow-y-auto overscroll-contain p-2">
            {listError ? (
              <div className="p-2 text-sm">
                <p role="alert">{listError}</p>
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  다시 불러오기
                </button>
              </div>
            ) : !conversations ? (
              <p role="status" className="px-2 text-sm">
                불러오는 중…
              </p>
            ) : conversations.length === 0 ? (
              <p className="px-2 text-sm">친구를 추가하면 채팅할 수 있어요.</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0">
                {conversations.map((item) => (
                  <li key={item.userId}>
                    <button
                      type="button"
                      className="cbc-btn-secondary flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      onClick={() => setPeerId(item.userId)}
                    >
                      <span className="truncate">{item.nickname}</span>
                      <span className="shrink-0 text-xs text-on-surface-variant">
                        {item.lastMessageAt
                          ? time.format(new Date(item.lastMessageAt))
                          : "새 대화"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <button
        ref={launcher}
        type="button"
        aria-expanded={open}
        aria-controls={titleId}
        className="pointer-events-auto cbc-btn-primary w-auto rounded-full px-4 py-2"
        onClick={() => (open ? minimize() : setOpen(true))}
      >
        채팅
      </button>
    </aside>
  );
}

function ChatConversation({
  peer,
  userId,
  open,
  refreshVersion,
}: {
  peer: Conversation;
  userId: number;
  open: boolean;
  refreshVersion: number;
}) {
  const [history, setHistory] = useState<History>();
  const [draft, setDraft] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sendVersion, setSendVersion] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const requestId = useRef<{ id: string; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const follow = useRef(true);
  const historyPath = `/api/chat/conversations/${peer.userId}/messages`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    authApi
      .request<History>(historyPath, {
        signal: controller.signal,
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        setLoadError("");
        setUnavailable(false);
        setHistory((current) => {
          if (!current) return page;
          // If more than one page arrived while offline, use the new cursor to
          // avoid silently leaving a gap in the visible conversation.
          const first = page.messages[0]?.id;
          if (
            page.nextBefore &&
            first !== undefined &&
            (current.messages.at(-1)?.id ?? 0) < first
          )
            return page;
          return {
            ...current,
            messages: combine(current.messages, page.messages),
          };
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setUnavailable(true);
          setHistory(undefined);
        }
        setLoadError(messageError(error));
      });
    return () => controller.abort();
  }, [historyPath, open, refreshVersion, retry, sendVersion]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!open || !node) return;
    if (prepend.current) {
      node.scrollTop =
        prepend.current.top + node.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (follow.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [history, open]);

  async function loadOlder() {
    const cursor = history?.nextBefore;
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    setLoadError("");
    try {
      const page = await authApi.request<History>(
        `${historyPath}?before=${cursor}`,
      );
      if (scroller.current) {
        prepend.current = {
          height: scroller.current.scrollHeight,
          top: scroller.current.scrollTop,
        };
      }
      setHistory((current) =>
        current && current.nextBefore === cursor
          ? {
              messages: combine(current.messages, page.messages),
              nextBefore: page.nextBefore,
            }
          : current,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setUnavailable(true);
        setHistory(undefined);
      }
      setLoadError(messageError(error));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || unavailable) return;
    const id =
      requestId.current?.text === text
        ? requestId.current.id
        : crypto.randomUUID();
    requestId.current = { id, text };
    setSending(true);
    setSendError("");
    try {
      const message = await authApi.request<Message>(historyPath, {
        method: "POST",
        body: { text, clientId: id },
      });
      follow.current = true;
      setHistory(
        (current) =>
          current && {
            ...current,
            messages: combine(current.messages, [message]),
          },
      );
      setSendVersion((value) => value + 1);
      setDraft("");
      requestId.current = null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setUnavailable(true);
        setHistory(undefined);
      }
      setSendError(messageError(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={scroller}
        role="log"
        aria-label="채팅 메시지"
        className="h-[min(16rem,36dvh)] space-y-2 overflow-y-auto overscroll-contain p-3"
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 32;
        }}
      >
        {history?.nextBefore && (
          <button
            type="button"
            className="cbc-btn-secondary w-full px-2 py-1 text-xs"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
          >
            {loadingOlder ? "불러오는 중…" : "이전 메시지 불러오기"}
          </button>
        )}
        {loadError ? (
          <div className="text-sm">
            <p role="alert">{loadError}</p>
            <button
              type="button"
              className="cbc-btn-secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              다시 불러오기
            </button>
          </div>
        ) : !history ? (
          <p className="m-0 text-sm">불러오는 중…</p>
        ) : history.messages.length === 0 ? (
          <p className="m-0 text-sm text-on-surface-variant">
            첫 메시지를 보내 보세요.
          </p>
        ) : null}
        {history?.messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.senderId === userId ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${message.senderId === userId ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface"}`}
            >
              <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {message.text}
              </p>
              <time
                dateTime={message.createdAt}
                className="block text-right text-[0.65rem]"
              >
                {time.format(new Date(message.createdAt))}
              </time>
            </div>
          </div>
        ))}
      </div>
      <form
        className="space-y-1 border-0 border-t border-solid border-outline-variant p-2"
        onSubmit={send}
      >
        {sendError && (
          <p role="alert" className="m-0 text-xs text-error">
            {sendError}
          </p>
        )}
        <div className="flex items-center gap-1.5">
          <input
            aria-label="메시지"
            autoComplete="off"
            className="cbc-input min-w-0 flex-1 px-2 py-1.5 text-sm"
            placeholder="메시지 입력"
            maxLength={1000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={sending || unavailable}
          />
          <button
            type="submit"
            className="cbc-btn-primary w-auto shrink-0 px-2 py-1.5 text-sm"
            disabled={sending || unavailable || !draft.trim()}
          >
            보내기
          </button>
        </div>
      </form>
    </div>
  );
}

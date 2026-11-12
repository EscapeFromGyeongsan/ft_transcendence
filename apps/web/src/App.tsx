import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GameType } from "@cafe/game-contracts";
import {
  authApi,
  isOAuthLinkedResult,
  isTokenPair,
  type AuthUser,
} from "./api/auth-client.ts";
import {
  getAuthFieldErrors,
  getErrorMessage,
  type AuthFieldErrors,
} from "./api/errors.ts";
import { GomokuMatchView } from "./game/GomokuMatchView.tsx";
import { MatchmakingView } from "./game/MatchmakingView.tsx";
import { OthelloMatchView } from "./game/OthelloMatchView.tsx";
import {
  applyConnectionPhase,
  applyGameAck,
  applyGameError,
  applyIncomingSnapshot,
  applyPlayerDisconnected,
  applyPlayerReconnected,
  applySessionReplaced,
  buildPlaceCommand,
  buildResignCommand,
  createInitialGomokuClientState,
  markCommandPending,
  type GomokuClientState,
} from "./game/gomoku-state.ts";
import {
  applyOthelloConnectionPhase,
  applyOthelloGameAck,
  applyOthelloGameError,
  applyOthelloIncomingSnapshot,
  applyOthelloPlayerDisconnected,
  applyOthelloPlayerReconnected,
  applyOthelloSessionReplaced,
  buildOthelloPlaceCommand,
  buildOthelloResignCommand,
  createInitialOthelloClientState,
  markOthelloCommandPending,
  type OthelloClientState,
} from "./game/othello-state.ts";
import {
  GAME_CATALOG_LIST,
  applyMatchmakingError,
  applyMatchmakingWsPhaseChange,
  applyQueueJoinRequested,
  applyQueueJoined,
  applyQueueLeaveRequested,
  applyQueueLeft,
  applyQueueMatched,
  clearMatchmakingError,
  createInitialMatchmakingState,
  getGameCatalogEntry,
  isMatchmakingBusy,
  selectMatchmakingGame,
  type MatchmakingClientState,
} from "./game/matchmaking-state.ts";
import { createGameWsClient, type GameWsClient } from "./game/ws-client.ts";
import { Avatar } from "./profile/Avatar.tsx";
import { LeaderboardView } from "./profile/LeaderboardView.tsx";
import { ProfileView } from "./profile/ProfileView.tsx";
import { FriendsView } from "./friends/FriendsView.tsx";
import { LegalDocumentView, NotFoundView } from "./legal/LegalDocumentView.tsx";
import {
  parseAppRoute,
  resolvePathForScreen,
  type LegalDocKind,
  type ParsedAppRoute,
} from "./legal/legal-routing.ts";

type ScreenView =
  | "login"
  | "register"
  | "twoFactor"
  | "oauthCallback"
  | "lobby"
  | "matchmaking"
  | "gomoku"
  | "othello"
  | "profile"
  | "leaderboard"
  | "friends"
  | "terms"
  | "privacy"
  | "notFound";

const ACTIVE_MATCH_STORAGE_KEY = "cyber_board_cafe.active_match_id";

/**
 * 현재 브라우저 주소창의 경로·쿼리·해시를 파싱합니다.
 */
function parseInitialAppRoute(): ParsedAppRoute {
  if (typeof globalThis.window === "undefined" || !globalThis.window.location) {
    return { kind: "lobby" };
  }
  return parseAppRoute(
    globalThis.window.location.pathname,
    globalThis.window.location.search,
    globalThis.window.location.hash,
  );
}

/**
 * 현재 URL 경로(/match/:matchId) 또는 쿼리(?matchId=...)에서 matchId를 추출합니다.
 */
function parseMatchIdFromLocation(): number | null {
  if (typeof globalThis.window === "undefined" || !globalThis.window.location) {
    return null;
  }
  const pathMatch = /^\/match\/(\d+)\/?$/.exec(
    globalThis.window.location.pathname,
  );
  if (pathMatch) {
    const parsed = Number.parseInt(pathMatch[1], 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  const searchParams = new URLSearchParams(globalThis.window.location.search);
  const queryVal = searchParams.get("matchId");
  if (queryVal) {
    const parsed = Number.parseInt(queryVal, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * 새로고침 시 로비 깜빡임을 방지하기 위해 sessionStorage에 저장된 진행 중 matchId를 함께 조회합니다.
 */
function parseInitialMatchId(): number | null {
  const fromLocation = parseMatchIdFromLocation();
  if (fromLocation !== null) {
    return fromLocation;
  }
  try {
    const raw = globalThis.sessionStorage?.getItem(ACTIVE_MATCH_STORAGE_KEY);
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch {
    // sessionStorage 접근 불가 환경 무시
  }
  return null;
}

function saveActiveMatchIdToStorage(matchId: number | null): void {
  try {
    if (matchId !== null && Number.isInteger(matchId) && matchId > 0) {
      globalThis.sessionStorage?.setItem(
        ACTIVE_MATCH_STORAGE_KEY,
        String(matchId),
      );
    } else {
      globalThis.sessionStorage?.removeItem(ACTIVE_MATCH_STORAGE_KEY);
    }
  } catch {
    // sessionStorage 접근 불가 환경 무시
  }
}

function BoardLogoSvg({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="8" fill="#4C822C" />
      <path
        d="M7 18H29M18 7V29"
        stroke="#F0EEE7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle
        cx="13"
        cy="13"
        r="4"
        fill="#1C1814"
        stroke="#4A3F33"
        strokeWidth="1"
      />
      <circle
        cx="23"
        cy="23"
        r="4"
        fill="#FFFFFF"
        stroke="#DCDAD4"
        strokeWidth="1"
      />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
      </svg>
    );
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.44-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
    </svg>
  );
}

/**
 * 사이버 보드게임 카페의 인증·화면 전환과 실시간 대국 상태를 관리하는 최상위 컴포넌트입니다.
 */
export function App() {
  const [notFoundPath, setNotFoundPath] = useState<string>(() => {
    const initial = parseInitialAppRoute();
    return initial.kind === "notFound" ? initial.pathname : "/";
  });
  const [view, setView] = useState<ScreenView>(() => {
    const initial = parseInitialAppRoute();
    if (initial.kind === "terms") return "terms";
    if (initial.kind === "privacy") return "privacy";
    if (initial.kind === "register") return "register";
    if (initial.kind === "oauthCallback") return "oauthCallback";
    if (initial.kind === "notFound") return "notFound";
    return "login";
  });
  const [previousViewBeforeLegal, setPreviousViewBeforeLegal] =
    useState<ScreenView | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const avatarTriggerBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastLogoutTriggerRef = useRef<HTMLButtonElement | null>(null);
  // 사용자 이동은 기록을 추가하고, 초기 복구·실시간 갱신·popstate는 현재 기록만 보정합니다.
  const navigationModeRef = useRef<"push" | "replace">("replace");

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Register form state
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regNickname, setRegNickname] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  // 2FA Challenge state
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  // Feedback & Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Lobby menus & modals
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);

  // 프로필 화면에서 조회 중인 사용자 (본인 또는 다른 사용자)
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const [friendsQuery, setFriendsQuery] = useState("");
  const [friendsRefreshVersion, setFriendsRefreshVersion] = useState(0);

  // Realtime Gomoku & Matchmaking state
  const wsClientRef = useRef<GameWsClient | null>(null);
  const fetchedPlayerIdsRef = useRef<Set<number>>(new Set());
  const [playerNicknames, setPlayerNicknames] = useState<
    Record<number, string>
  >({});
  const [matchmakingState, setMatchmakingState] =
    useState<MatchmakingClientState>(() =>
      createInitialMatchmakingState("gomoku"),
    );
  const [matchIdInput, setMatchIdInput] = useState("");
  const [gomokuState, setGomokuState] = useState<GomokuClientState>(() =>
    createInitialGomokuClientState(null, parseInitialMatchId()),
  );
  const [othelloState, setOthelloState] = useState<OthelloClientState>(() =>
    createInitialOthelloClientState(null, parseInitialMatchId()),
  );

  function resetMessages() {
    setErrorMessage(null);
    setFieldErrors({});
    setNoticeMessage(null);
  }

  function switchView(next: ScreenView) {
    if (next !== view) navigationModeRef.current = "push";
    resetMessages();
    setAccountMenuOpen(false);
    setLogoutModalOpen(false);
    // 매칭 대기 화면에서 다른 화면(로비·프로필·리더보드 등)으로 직접 이동할 때 대기열을 정리합니다.
    if (
      next !== "matchmaking" &&
      next !== "gomoku" &&
      next !== "othello" &&
      isMatchmakingBusy(matchmakingState)
    ) {
      wsClientRef.current?.leaveQueue();
      setMatchmakingState((prev) => applyQueueLeft(prev));
    }
    setView(next);
  }

  function openFriends(nickname = "") {
    setFriendsQuery(nickname);
    switchView("friends");
  }

  function openLegalDoc(doc: LegalDocKind) {
    if (doc !== view) navigationModeRef.current = "push";
    resetMessages();
    setAccountMenuOpen(false);
    setLogoutModalOpen(false);
    setView((current) => {
      if (
        current !== "terms" &&
        current !== "privacy" &&
        current !== "notFound"
      ) {
        setPreviousViewBeforeLegal(current);
      }
      return doc;
    });
  }

  function handleBackFromLegal() {
    navigationModeRef.current = "push";
    resetMessages();
    if (
      previousViewBeforeLegal &&
      previousViewBeforeLegal !== "terms" &&
      previousViewBeforeLegal !== "privacy" &&
      previousViewBeforeLegal !== "notFound"
    ) {
      const target = previousViewBeforeLegal;
      setPreviousViewBeforeLegal(null);
      setView(target);
      return;
    }
    setView(currentUser ? "lobby" : "login");
  }

  // 모달·드롭다운 메뉴가 열려 있을 때 Escape 키 입력 시 닫고 포커스를 트리거 버튼으로 복원합니다 (NFR-UX-02).
  useEffect(() => {
    if (!logoutModalOpen && !accountMenuOpen) {
      return;
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (logoutModalOpen) {
          if (!submitting) {
            setLogoutModalOpen(false);
            lastLogoutTriggerRef.current?.focus();
          }
          return;
        }
        if (accountMenuOpen) {
          setAccountMenuOpen(false);
          avatarTriggerBtnRef.current?.focus();
        }
      }
    }
    globalThis.window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.window.removeEventListener("keydown", handleKeyDown);
    };
  }, [logoutModalOpen, accountMenuOpen, submitting]);

  // 화면 전환 시 브라우저 주소창 경로(/, /terms, /privacy, /me, /leaderboard, /matching, /match/:matchId)를 동기화합니다.
  useEffect(() => {
    if (
      typeof globalThis.window === "undefined" ||
      !globalThis.window.history ||
      typeof globalThis.window.history.replaceState !== "function"
    ) {
      return;
    }
    if (initializing && view !== "terms" && view !== "privacy") {
      return;
    }
    const targetPath = resolvePathForScreen({
      view,
      matchId: view === "othello" ? othelloState.matchId : gomokuState.matchId,
      profileUserId,
      currentUserId: currentUser?.id ?? null,
    });
    const navigationMode = navigationModeRef.current;
    navigationModeRef.current = "replace";
    if (
      targetPath !== null &&
      globalThis.window.location?.pathname !== targetPath
    ) {
      try {
        if (navigationMode === "push") {
          globalThis.window.history.pushState(null, "", targetPath);
        } else {
          globalThis.window.history.replaceState(null, "", targetPath);
        }
      } catch {
        // 테스트·제한 환경에서 history 변경 예외 무시
      }
    }
  }, [
    initializing,
    view,
    gomokuState.matchId,
    othelloState.matchId,
    profileUserId,
    currentUser?.id,
  ]);

  // 브라우저 뒤로가기/앞으로가기(popstate) 시 라우트 상태를 동기화합니다.
  useEffect(() => {
    if (
      typeof globalThis.window === "undefined" ||
      typeof globalThis.window.addEventListener !== "function"
    ) {
      return;
    }
    function handlePopState() {
      navigationModeRef.current = "replace";
      const route = parseInitialAppRoute();
      switch (route.kind) {
        case "terms":
          setView("terms");
          break;
        case "privacy":
          setView("privacy");
          break;
        case "register":
          setView(currentUser ? "lobby" : "register");
          break;
        case "login":
          setView(currentUser ? "lobby" : "login");
          break;
        case "twoFactor":
          setView(
            challengeToken ? "twoFactor" : currentUser ? "lobby" : "login",
          );
          break;
        case "oauthCallback":
          setView("oauthCallback");
          break;
        case "lobby":
          setView(currentUser ? "lobby" : "login");
          break;
        case "matchmaking":
          setView(currentUser ? "matchmaking" : "login");
          break;
        case "match":
          if (currentUser) {
            openMatch(route.matchId);
          } else {
            setView("login");
          }
          break;
        case "myProfile":
          if (currentUser) {
            setProfileUserId(currentUser.id);
            setView("profile");
          } else {
            setView("login");
          }
          break;
        case "userProfile":
          if (currentUser) {
            setProfileUserId(route.userId);
            setView("profile");
          } else {
            setView("login");
          }
          break;
        case "leaderboard":
          setView(currentUser ? "leaderboard" : "login");
          break;
        case "friends":
          setFriendsQuery("");
          setView(currentUser ? "friends" : "login");
          break;
        case "notFound":
          setNotFoundPath(route.pathname);
          setView("notFound");
          break;
      }
    }
    globalThis.window.addEventListener("popstate", handlePopState);
    return () => {
      globalThis.window.removeEventListener("popstate", handlePopState);
    };
  }, [
    currentUser,
    challengeToken,
    gomokuState.snapshot?.matchId,
    othelloState.snapshot?.matchId,
  ]);

  // 로그인된 사용자의 viewerUserId를 gomokuState 및 othelloState와 동기화합니다.
  useEffect(() => {
    setGomokuState((prev) => ({
      ...prev,
      viewerUserId: currentUser?.id ?? null,
    }));
    setOthelloState((prev) => ({
      ...prev,
      viewerUserId: currentUser?.id ?? null,
    }));
  }, [currentUser?.id]);

  // 대국 참가자(흑·백) userId에 대해 GET /api/users/:userId로 공개 닉네임을 조회합니다.
  useEffect(() => {
    const gomokuBlackId = gomokuState.snapshot?.players.black ?? null;
    const gomokuWhiteId = gomokuState.snapshot?.players.white ?? null;
    const othelloBlackId = othelloState.snapshot?.players.black ?? null;
    const othelloWhiteId = othelloState.snapshot?.players.white ?? null;
    const candidateIds = [
      gomokuBlackId,
      gomokuWhiteId,
      othelloBlackId,
      othelloWhiteId,
    ].filter(
      (id): id is number => id !== null && Number.isInteger(id) && id > 0,
    );

    for (const playerId of candidateIds) {
      if (currentUser && playerId === currentUser.id) {
        if (playerNicknames[playerId] !== currentUser.nickname) {
          setPlayerNicknames((prev) => ({
            ...prev,
            [playerId]: currentUser.nickname,
          }));
        }
        continue;
      }

      if (fetchedPlayerIdsRef.current.has(playerId)) {
        continue;
      }
      fetchedPlayerIdsRef.current.add(playerId);

      void authApi
        .request<{ id: number; nickname: string; avatarUrl: string | null }>(
          `/api/users/${playerId}`,
          { method: "GET", requiresAuth: true },
        )
        .then((profile) => {
          if (profile && typeof profile.nickname === "string") {
            setPlayerNicknames((prev) => ({
              ...prev,
              [playerId]: profile.nickname,
            }));
          }
        })
        .catch(() => {
          fetchedPlayerIdsRef.current.delete(playerId);
        });
    }
  }, [
    currentUser,
    gomokuState.snapshot?.players.black,
    gomokuState.snapshot?.players.white,
    othelloState.snapshot?.players.black,
    othelloState.snapshot?.players.white,
    playerNicknames,
  ]);

  // 닉네임·아바타 변경으로 currentUser 객체가 바뀌어도 WebSocket이 재연결되지 않도록 id만 의존합니다.
  const currentUserId = currentUser?.id ?? null;

  // 인증된 사용자 세션 동안 실시간 WebSocket(/api/ws) 연결을 유지합니다.
  useEffect(() => {
    if (currentUserId === null) {
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
      setMatchmakingState(createInitialMatchmakingState("gomoku"));
      saveActiveMatchIdToStorage(null);
      return;
    }

    const initialMatchId = parseInitialMatchId();
    const client = createGameWsClient({
      getAccessToken: () => authApi.storage.getTokens()?.accessToken ?? null,
      refreshAccessToken: async () => {
        const pair = await authApi.refresh();
        return pair.accessToken;
      },
      handlers: {
        onPresence() {
          setFriendsRefreshVersion((version) => version + 1);
        },
        onFriendsChanged() {
          setFriendsRefreshVersion((version) => version + 1);
        },
        onPhaseChange(phase, reconnectAttempt) {
          setGomokuState((prev) =>
            applyConnectionPhase(prev, phase, reconnectAttempt),
          );
          setOthelloState((prev) =>
            applyOthelloConnectionPhase(prev, phase, reconnectAttempt),
          );
          setMatchmakingState((prev) =>
            applyMatchmakingWsPhaseChange(prev, phase),
          );
          if (
            phase === "reconnecting" ||
            phase === "disconnected" ||
            phase === "session_replaced"
          ) {
            setView((current) =>
              current === "matchmaking" ? "lobby" : current,
            );
          }
        },
        onAuthOk({ userId, activeMatchId }) {
          const urlMatchId = parseMatchIdFromLocation();
          const targetMatchId =
            activeMatchId ?? urlMatchId ?? client.getSubscribedMatchId();
          setGomokuState((prev) => ({
            ...prev,
            viewerUserId: userId,
            matchId: targetMatchId ?? prev.matchId,
          }));
          setOthelloState((prev) => ({
            ...prev,
            viewerUserId: userId,
            matchId: targetMatchId ?? prev.matchId,
          }));
          if (targetMatchId !== null) {
            saveActiveMatchIdToStorage(targetMatchId);
            client.setSubscribedMatchId(targetMatchId);
            setMatchmakingState((prev) => applyQueueLeft(prev));
            setView((current) =>
              current === "terms" ||
              current === "privacy" ||
              current === "oauthCallback" ||
              current === "notFound" ||
              current === "othello"
                ? current
                : "gomoku",
            );
          } else {
            saveActiveMatchIdToStorage(null);
          }
        },
        onQueueJoined({ gameType }) {
          setMatchmakingState((prev) => applyQueueJoined(prev, { gameType }));
          setView((current) =>
            current === "gomoku" || current === "othello"
              ? current
              : "matchmaking",
          );
        },
        onQueueLeft() {
          setMatchmakingState((prev) => applyQueueLeft(prev));
          setView((current) => (current === "matchmaking" ? "lobby" : current));
          setNoticeMessage("매칭 대기열 등록이 취소되었습니다.");
        },
        onQueueMatched({ matchId, gameType }) {
          saveActiveMatchIdToStorage(matchId);
          setMatchmakingState((prev) =>
            applyQueueMatched(prev, { matchId, gameType }),
          );
          if (gameType === "othello") {
            setOthelloState((prev) => ({
              ...createInitialOthelloClientState(
                prev.viewerUserId ?? currentUserId,
                matchId,
              ),
              connectionPhase: "connected",
            }));
            setView("othello");
          } else {
            setGomokuState((prev) => ({
              ...createInitialGomokuClientState(
                prev.viewerUserId ?? currentUserId,
                matchId,
              ),
              connectionPhase: "connected",
            }));
            setView("gomoku");
          }
        },
        onMatchSnapshot(snapshot) {
          saveActiveMatchIdToStorage(
            snapshot.status === "finished" ? null : snapshot.matchId,
          );
          if (snapshot.gameType === "othello") {
            setOthelloState((prev) =>
              applyOthelloIncomingSnapshot(prev, snapshot, "match.snapshot"),
            );
          } else {
            setGomokuState((prev) =>
              applyIncomingSnapshot(prev, snapshot, "match.snapshot"),
            );
          }
          // 약관·개인정보 화면을 열람 중이면 스냅샷은 반영하되 화면은 유지합니다.
          setView((current) =>
            current === "terms" ||
            current === "privacy" ||
            current === "oauthCallback" ||
            current === "notFound"
              ? current
              : snapshot.gameType,
          );
        },
        onGameUpdated(snapshot) {
          saveActiveMatchIdToStorage(
            snapshot.status === "finished" ? null : snapshot.matchId,
          );
          if (snapshot.gameType === "othello") {
            setOthelloState((prev) =>
              applyOthelloIncomingSnapshot(prev, snapshot, "game.updated"),
            );
          } else {
            setGomokuState((prev) =>
              applyIncomingSnapshot(prev, snapshot, "game.updated"),
            );
          }
        },
        onGameAck(payload) {
          setGomokuState((prev) => applyGameAck(prev, payload));
          setOthelloState((prev) => applyOthelloGameAck(prev, payload));
        },
        onGameError(payload) {
          setGomokuState((prev) => applyGameError(prev, payload));
          setOthelloState((prev) => applyOthelloGameError(prev, payload));
        },
        onError(payload) {
          setGomokuState((prev) => applyGameError(prev, payload));
          setOthelloState((prev) => applyOthelloGameError(prev, payload));
          setMatchmakingState((prev) => applyMatchmakingError(prev, payload));
          if (payload.code !== "ALREADY_MATCHED") {
            setView((current) =>
              current === "matchmaking" ? "lobby" : current,
            );
          }
        },
        onPlayerDisconnected(payload) {
          setGomokuState((prev) => applyPlayerDisconnected(prev, payload));
          setOthelloState((prev) =>
            applyOthelloPlayerDisconnected(prev, payload),
          );
        },
        onPlayerReconnected(payload) {
          setGomokuState((prev) => applyPlayerReconnected(prev, payload));
          setOthelloState((prev) =>
            applyOthelloPlayerReconnected(prev, payload),
          );
        },
        onSessionReplaced({ matchId }) {
          setGomokuState((prev) => applySessionReplaced(prev, matchId));
          setOthelloState((prev) => applyOthelloSessionReplaced(prev, matchId));
        },
      },
    });

    if (initialMatchId !== null) {
      client.setSubscribedMatchId(initialMatchId);
    }

    wsClientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      if (wsClientRef.current === client) {
        wsClientRef.current = null;
      }
    };
  }, [currentUserId]);

  function openProfile(userId: number) {
    if (userId !== profileUserId) navigationModeRef.current = "push";
    setProfileUserId(userId);
    switchView("profile");
  }

  function handleSelectGame(gameType: GameType) {
    resetMessages();
    setMatchmakingState((prev) => selectMatchmakingGame(prev, gameType));
  }

  function handleStartMatchmaking(
    gameType: GameType = matchmakingState.selectedGameType,
  ) {
    resetMessages();
    const catalog = getGameCatalogEntry(gameType);
    if (!catalog.playable) {
      setErrorMessage(
        `${catalog.shortTitle} 실시간 매칭은 현재 준비 중입니다. 오목(15×15)을 선택해 대국을 시작해 주세요.`,
      );
      return;
    }

    const client = wsClientRef.current;
    if (!client || client.getPhase() !== "connected") {
      setErrorMessage(
        "실시간 게임 서버에 연결하는 중입니다. 잠시 후 다시 시도해 주세요.",
      );
      client?.reconnectNow();
      return;
    }

    setMatchmakingState((prev) => applyQueueJoinRequested(prev, gameType));
    setView("matchmaking");
    client.joinQueue(gameType);
  }

  function handleCancelMatchmaking() {
    resetMessages();
    setMatchmakingState((prev) => applyQueueLeaveRequested(prev));
    const sent = wsClientRef.current?.leaveQueue() ?? false;
    if (!sent) {
      setMatchmakingState((prev) => applyQueueLeft(prev));
      setView("lobby");
      setNoticeMessage("매칭 대기열 등록이 취소되었습니다.");
    }
  }

  function handleDismissMatchmakingError() {
    setMatchmakingState((prev) => clearMatchmakingError(prev));
  }

  function handleSubscribeByMatchId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    const parsedId = Number.parseInt(matchIdInput.trim(), 10);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      setErrorMessage("유효한 대국 번호(양의 정수 matchId)를 입력해 주세요.");
      return;
    }

    navigationModeRef.current = "push";
    openMatch(parsedId);
  }

  function openMatch(matchId: number) {
    const client = wsClientRef.current;
    const subscribedMatchId = client?.getSubscribedMatchId() ?? null;
    if (subscribedMatchId !== null && subscribedMatchId !== matchId) {
      client?.unsubscribeMatch(subscribedMatchId);
    }
    saveActiveMatchIdToStorage(matchId);
    setGomokuState((prev) =>
      prev.matchId === matchId &&
      (!prev.snapshot || prev.snapshot.matchId === matchId)
        ? prev
        : {
            ...createInitialGomokuClientState(
              prev.viewerUserId ?? currentUser?.id ?? null,
              matchId,
            ),
            connectionPhase: client?.getPhase() ?? "connecting",
          },
    );
    setOthelloState((prev) =>
      prev.matchId === matchId &&
      (!prev.snapshot || prev.snapshot.matchId === matchId)
        ? prev
        : {
            ...createInitialOthelloClientState(
              prev.viewerUserId ?? currentUser?.id ?? null,
              matchId,
            ),
            connectionPhase: client?.getPhase() ?? "connecting",
          },
    );
    setView(othelloState.snapshot?.matchId === matchId ? "othello" : "gomoku");
    if (client && subscribedMatchId !== matchId) {
      if (!client.subscribeMatch(matchId)) {
        client.reconnectNow();
      }
    }
  }

  function handlePlaceGomokuStone(row: number, col: number) {
    const snapshot = gomokuState.snapshot;
    if (!snapshot) return;
    const command = buildPlaceCommand(
      snapshot.matchId,
      snapshot.stateVersion,
      row,
      col,
    );
    setGomokuState((prev) => markCommandPending(prev, command));
    wsClientRef.current?.sendGameCommand(command);
  }

  function handleResignGomoku() {
    const snapshot = gomokuState.snapshot;
    if (!snapshot) return;
    const command = buildResignCommand(snapshot.matchId, snapshot.stateVersion);
    setGomokuState((prev) => markCommandPending(prev, command));
    wsClientRef.current?.sendGameCommand(command);
  }

  function handleReconnectGomoku() {
    wsClientRef.current?.reconnectNow();
  }

  function handleDismissGomokuError() {
    setGomokuState((prev) => ({
      ...prev,
      gameError: null,
    }));
  }

  function handleBackToLobbyFromGomoku() {
    const activeMatchId = gomokuState.matchId;
    if (activeMatchId !== null && gomokuState.snapshot?.status === "finished") {
      saveActiveMatchIdToStorage(null);
      wsClientRef.current?.unsubscribeMatch(activeMatchId);
      wsClientRef.current?.setSubscribedMatchId(null);
    }
    switchView("lobby");
  }

  function handlePlayAgainGomoku() {
    const activeMatchId = gomokuState.matchId;
    if (activeMatchId !== null) {
      saveActiveMatchIdToStorage(null);
      wsClientRef.current?.unsubscribeMatch(activeMatchId);
      wsClientRef.current?.setSubscribedMatchId(null);
    }
    handleStartMatchmaking("gomoku");
  }

  function handlePlaceOthelloDisc(row: number, col: number) {
    const snapshot = othelloState.snapshot;
    if (!snapshot) return;
    const command = buildOthelloPlaceCommand(
      snapshot.matchId,
      snapshot.stateVersion,
      row,
      col,
    );
    setOthelloState((prev) => markOthelloCommandPending(prev, command));
    wsClientRef.current?.sendGameCommand(command);
  }

  function handleResignOthello() {
    const snapshot = othelloState.snapshot;
    if (!snapshot) return;
    const command = buildOthelloResignCommand(
      snapshot.matchId,
      snapshot.stateVersion,
    );
    setOthelloState((prev) => markOthelloCommandPending(prev, command));
    wsClientRef.current?.sendGameCommand(command);
  }

  function handleDismissOthelloError() {
    setOthelloState((prev) => ({
      ...prev,
      gameError: null,
    }));
  }

  function handleBackToLobbyFromOthello() {
    const activeMatchId = othelloState.matchId;
    if (
      activeMatchId !== null &&
      othelloState.snapshot?.status === "finished"
    ) {
      saveActiveMatchIdToStorage(null);
      wsClientRef.current?.unsubscribeMatch(activeMatchId);
      wsClientRef.current?.setSubscribedMatchId(null);
    }
    switchView("lobby");
  }

  function handlePlayAgainOthello() {
    const activeMatchId = othelloState.matchId;
    if (activeMatchId !== null) {
      saveActiveMatchIdToStorage(null);
      wsClientRef.current?.unsubscribeMatch(activeMatchId);
      wsClientRef.current?.setSubscribedMatchId(null);
    }
    handleStartMatchmaking("othello");
  }

  useEffect(() => {
    let active = true;
    const initialRoute = parseInitialAppRoute();

    if (initialRoute.kind === "oauthCallback") {
      setView("oauthCallback");
      setInitializing(false);
      if (initialRoute.error || !initialRoute.code || !initialRoute.state) {
        setErrorMessage(
          initialRoute.error
            ? `42 인증이 취소되었거나 실패했습니다 (${initialRoute.error}).`
            : "42 인증 응답 파라미터(code, state)가 누락되었습니다.",
        );
        return;
      }

      setSubmitting(true);
      authApi
        .completeOAuth42Callback(
          { code: initialRoute.code, state: initialRoute.state },
          true,
        )
        .then(async (result) => {
          if (!active) return;
          if (isOAuthLinkedResult(result)) {
            const me = await authApi.getMe();
            if (!active) return;
            setCurrentUser(me);
            setProfileUserId(me.id);
            setView("profile");
            setNoticeMessage(
              "42 Intra 계정이 현재 계정에 성공적으로 연결되었습니다.",
            );
            return;
          }
          if (!isTokenPair(result)) {
            setChallengeToken(result.challengeToken);
            setTwoFactorCode("");
            setView("twoFactor");
            setNoticeMessage(
              "42 Intra 인증이 확인되었습니다. 2단계 인증 코드를 입력해 주세요.",
            );
            return;
          }
          const me = await authApi.getMe();
          if (!active) return;
          setCurrentUser(me);
          setView("lobby");
          setNoticeMessage("42 Intra 계정으로 로그인되었습니다.");
        })
        .catch((error) => {
          if (!active) return;
          setErrorMessage(getErrorMessage(error));
        })
        .finally(() => {
          if (active) setSubmitting(false);
        });
      return () => {
        active = false;
      };
    }

    const savedTokens = authApi.storage.getTokens();
    if (!savedTokens) {
      if (initialRoute.kind === "terms") {
        setView("terms");
      } else if (initialRoute.kind === "privacy") {
        setView("privacy");
      } else if (initialRoute.kind === "register") {
        setView("register");
      } else if (initialRoute.kind === "notFound") {
        setNotFoundPath(initialRoute.pathname);
        setView("notFound");
      }
      setInitializing(false);
      return;
    }

    const resumedMatchId = parseInitialMatchId();

    authApi
      .getMe()
      .then((user) => {
        if (!active) return;
        setCurrentUser(user);
        setView((current) => {
          if (
            current === "terms" ||
            current === "privacy" ||
            current === "notFound"
          ) {
            return current;
          }
          if (initialRoute.kind === "terms") return "terms";
          if (initialRoute.kind === "privacy") return "privacy";
          if (initialRoute.kind === "notFound") {
            setNotFoundPath(initialRoute.pathname);
            return "notFound";
          }
          if (initialRoute.kind === "myProfile") {
            setProfileUserId(user.id);
            return "profile";
          }
          if (initialRoute.kind === "userProfile") {
            setProfileUserId(initialRoute.userId);
            return "profile";
          }
          if (initialRoute.kind === "leaderboard") {
            return "leaderboard";
          }
          if (initialRoute.kind === "friends") {
            return "friends";
          }
          if (initialRoute.kind === "matchmaking") {
            return "matchmaking";
          }
          return resumedMatchId !== null ? "gomoku" : "lobby";
        });
      })
      .catch(() => {
        if (!active) return;
        authApi.storage.clearTokens();
        saveActiveMatchIdToStorage(null);
        setCurrentUser(null);
        setView((current) =>
          current === "terms" || current === "privacy" || current === "notFound"
            ? current
            : "login",
        );
      })
      .finally(() => {
        if (active) setInitializing(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleOAuth42Login() {
    resetMessages();
    setSubmitting(true);
    try {
      const { authorizeUrl } = await authApi.startOAuth42Login();
      if (
        typeof globalThis.window !== "undefined" &&
        globalThis.window.location
      ) {
        globalThis.window.location.assign(authorizeUrl);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setSubmitting(true);

    try {
      const result = await authApi.login(
        {
          email: loginEmail.trim(),
          password: loginPassword,
        },
        rememberMe,
      );

      if (!isTokenPair(result)) {
        setChallengeToken(result.challengeToken);
        setTwoFactorCode("");
        setView("twoFactor");
        return;
      }

      const me = await authApi.getMe();
      setCurrentUser(me);
      setLoginPassword("");
      setView("lobby");
    } catch (error) {
      setFieldErrors(getAuthFieldErrors(error));
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    if (!agreeTerms) {
      setErrorMessage("이용약관 및 개인정보처리방침에 동의해 주세요.");
      return;
    }

    setSubmitting(true);
    const trimmedEmail = regEmail.trim();
    const trimmedNickname = regNickname.trim();

    try {
      const registeredUser = await authApi.register({
        email: trimmedEmail,
        password: regPassword,
        nickname: trimmedNickname,
      });

      // 가입 직후 로그인 연동을 시도하고, 성공하면 로비로 전환합니다.
      try {
        const loginResult = await authApi.login(
          {
            email: trimmedEmail,
            password: regPassword,
          },
          true,
        );
        if (isTokenPair(loginResult)) {
          const me = await authApi.getMe().catch(() => registeredUser);
          setCurrentUser(me);
          setRegPassword("");
          setView("lobby");
          setNoticeMessage(`${me.nickname} 님, 회원가입이 완료되었습니다.`);
          return;
        }
      } catch {
        // 자동 로그인 실패 시 로그인 화면으로 안내
      }

      setLoginEmail(trimmedEmail);
      setLoginPassword("");
      setRegPassword("");
      setView("login");
      setNoticeMessage(
        "회원가입이 완료되었습니다. 가입한 계정으로 로그인해 주세요.",
      );
    } catch (error) {
      const extractedFields = getAuthFieldErrors(error);
      setFieldErrors(extractedFields);
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTwoFactorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeToken) {
      switchView("login");
      return;
    }

    resetMessages();
    setSubmitting(true);

    try {
      await authApi.verifyTwoFactorLogin(
        {
          challengeToken,
          code: twoFactorCode.trim(),
        },
        rememberMe,
      );
      const me = await authApi.getMe();
      setCurrentUser(me);
      setChallengeToken(null);
      setTwoFactorCode("");
      setView("lobby");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualRefresh() {
    resetMessages();
    setSubmitting(true);
    try {
      await authApi.refresh();
      const me = await authApi.getMe();
      setCurrentUser(me);
      setAccountMenuOpen(false);
      setNoticeMessage("세션 토큰이 성공적으로 갱신되었습니다.");
    } catch (error) {
      setCurrentUser(null);
      setAccountMenuOpen(false);
      setLogoutModalOpen(false);
      setView("login");
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmLogout() {
    resetMessages();
    setSubmitting(true);
    try {
      await authApi.logout();
    } catch (error) {
      // 로그아웃 요청 중 오류가 발생하더라도 로컬 세션은 종료하고 안내만 남깁니다.
      setErrorMessage(getErrorMessage(error));
    } finally {
      setCurrentUser(null);
      setAccountMenuOpen(false);
      setLogoutModalOpen(false);
      setSubmitting(false);
      setView("login");
      setNoticeMessage("안전하게 로그아웃되었습니다.");
    }
  }

  return (
    <div className="cbc-shell">
      {/* Top Fixed Header */}
      <header className="cbc-header">
        <div className="cbc-header-inner">
          <button
            type="button"
            className="cbc-brand"
            onClick={() => switchView(currentUser ? "lobby" : "login")}
          >
            <div className="cbc-brand-icon-wrap">
              <BoardLogoSvg size={30} />
            </div>
            <span className="cbc-brand-title">Cyber Board Cafe</span>
          </button>

          {currentUser &&
          (view === "lobby" ||
            view === "matchmaking" ||
            view === "gomoku" ||
            view === "othello" ||
            view === "profile" ||
            view === "leaderboard" ||
            view === "friends" ||
            view === "terms" ||
            view === "privacy" ||
            view === "notFound") ? (
            <div className="cbc-account-area">
              <span className="cbc-security-pill">
                <span className="cbc-pulse-dot" />
                {gomokuState.connectionPhase === "connected"
                  ? "온라인"
                  : gomokuState.connectionPhase === "reconnecting"
                    ? "재접속 중"
                    : gomokuState.connectionPhase === "disconnected"
                      ? "연결 끊김"
                      : "동기화 중"}
              </span>
              <button
                ref={avatarTriggerBtnRef}
                type="button"
                className="cbc-avatar-trigger"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
              >
                <Avatar
                  nickname={currentUser.nickname}
                  avatarUrl={currentUser.avatarUrl}
                />
                <span>{currentUser.nickname}</span>
              </button>

              {accountMenuOpen && (
                <div
                  className="cbc-account-dropdown"
                  role="menu"
                  aria-label="계정 메뉴"
                >
                  <div className="cbc-dropdown-profile">
                    <Avatar
                      nickname={currentUser.nickname}
                      avatarUrl={currentUser.avatarUrl}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "14px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {currentUser.nickname}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--on-surface-variant)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {currentUser.email}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="menu-my-profile"
                    className="cbc-dropdown-btn"
                    role="menuitem"
                    onClick={() => openProfile(currentUser.id)}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px" }}>
                        내 프로필
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--on-surface-variant)",
                        }}
                      >
                        닉네임·프로필 이미지·전적 관리
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="menu-leaderboard"
                    className="cbc-dropdown-btn"
                    role="menuitem"
                    onClick={() => switchView("leaderboard")}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px" }}>
                        리더보드
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--on-surface-variant)",
                        }}
                      >
                        게임별 승수 순위
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="menu-friends"
                    className="cbc-dropdown-btn"
                    role="menuitem"
                    onClick={() => openFriends()}
                  >
                    친구 관리
                  </button>

                  <button
                    type="button"
                    className="cbc-dropdown-btn"
                    role="menuitem"
                    disabled={submitting}
                    onClick={handleManualRefresh}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px" }}>
                        세션 토큰 갱신
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "var(--on-surface-variant)",
                        }}
                      >
                        POST /api/auth/refresh 호출
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="trigger-logout-modal"
                    className="cbc-dropdown-btn is-danger"
                    role="menuitem"
                    onClick={() => {
                      lastLogoutTriggerRef.current =
                        avatarTriggerBtnRef.current;
                      setAccountMenuOpen(false);
                      setLogoutModalOpen(true);
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px" }}>
                        로그아웃
                      </div>
                      <div style={{ fontSize: "11px", opacity: 0.85 }}>
                        현재 기기에서 안전하게 접속 종료
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="cbc-security-pill">
              <span className="cbc-pulse-dot" />
              보안 인증 채널
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="cbc-main">
        {view === "terms" || view === "privacy" ? (
          <LegalDocumentView
            activeDoc={view}
            onSelectDoc={(doc) => openLegalDoc(doc)}
            onBack={handleBackFromLegal}
            backLabel={
              previousViewBeforeLegal === "register"
                ? "회원가입 화면으로 돌아가기"
                : previousViewBeforeLegal === "login"
                  ? "로그인 화면으로 돌아가기"
                  : currentUser
                    ? "이전 화면으로 돌아가기"
                    : "로그인 화면으로 돌아가기"
            }
          />
        ) : view === "notFound" ? (
          <NotFoundView
            pathname={notFoundPath}
            isAuthenticated={Boolean(currentUser)}
            onNavigateHome={() => switchView(currentUser ? "lobby" : "login")}
          />
        ) : view === "oauthCallback" ? (
          <div className="cbc-stage" data-testid="oauth-callback-view">
            <div className="cbc-login-card" style={{ textAlign: "center" }}>
              <span className="cbc-eyebrow">42 INTRA OAUTH 2.0</span>
              <h1
                className="cbc-heading-login"
                style={{ marginTop: "0.375rem" }}
              >
                {errorMessage
                  ? "42 계정 인증을 완료하지 못했습니다"
                  : "42 Intra 인증 처리 중..."}
              </h1>
              {errorMessage ? (
                <>
                  <div
                    className="cbc-error-banner"
                    role="alert"
                    style={{ marginTop: "1rem", textAlign: "left" }}
                  >
                    <span>{errorMessage}</span>
                  </div>
                  <div style={{ marginTop: "1.25rem" }}>
                    <button
                      type="button"
                      className="cbc-btn-primary"
                      data-testid="oauth-callback-return-btn"
                      onClick={() =>
                        switchView(currentUser ? "profile" : "login")
                      }
                    >
                      {currentUser
                        ? "내 프로필로 돌아가기"
                        : "로그인 화면으로 돌아가기"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="cbc-subheading" style={{ marginTop: "0.5rem" }}>
                  보안 상태 토큰(state·flowToken)을 검증하고 세션을 연결하는
                  중입니다...
                </p>
              )}
            </div>
          </div>
        ) : initializing ? (
          <div className="cbc-login-card" style={{ textAlign: "center" }}>
            <h1 className="cbc-heading-login">사이버 보드게임 카페</h1>
            <p className="cbc-subheading">인증 세션을 확인하는 중입니다...</p>
          </div>
        ) : view === "login" ? (
          <div className="cbc-stage">
            <div className="cbc-glow-left" />
            <div className="cbc-glow-right" />

            <div className="cbc-login-card">
              <div className="cbc-card-header-center">
                <div className="cbc-meeple-avatar" aria-hidden="true">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm3 7h-6a4 4 0 0 0-4 4v7a2 2 0 0 0 2 2h2l1-4h4l1 4h2a2 2 0 0 0 2-2v-7a4 4 0 0 0-4-4z" />
                  </svg>
                </div>
                <h1 className="cbc-heading-login">로그인</h1>
                <p className="cbc-subheading">
                  Cyber Board Cafe에 오신 것을 환영합니다.
                  <br />
                  계정에 로그인해 대국을 시작하세요.
                </p>
              </div>

              {noticeMessage && (
                <div
                  className="cbc-success-banner"
                  role="status"
                  style={{ marginBottom: "1rem" }}
                >
                  <span>{noticeMessage}</span>
                </div>
              )}

              <form
                id="loginForm"
                className="cbc-form"
                onSubmit={handleLoginSubmit}
                noValidate
              >
                <div className="cbc-field">
                  <div className="cbc-label-row">
                    <label className="cbc-label" htmlFor="emailInput">
                      이메일
                      <span aria-hidden="true" className="cbc-required">
                        *
                      </span>
                      <span className="sr-only">(필수 입력 항목)</span>
                    </label>
                  </div>
                  <div className="cbc-input-wrap">
                    <input
                      id="emailInput"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="example@boardcafe.kr"
                      value={loginEmail}
                      onChange={(e) => {
                        setLoginEmail(e.target.value);
                        if (errorMessage) resetMessages();
                      }}
                      aria-invalid={Boolean(errorMessage || fieldErrors.email)}
                      aria-describedby={
                        errorMessage ? "loginErrorMessage" : undefined
                      }
                      className={`cbc-input ${
                        errorMessage || fieldErrors.email ? "is-error" : ""
                      }`}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="cbc-field-error">{fieldErrors.email}</p>
                  )}
                </div>

                <div className="cbc-field">
                  <div className="cbc-label-row">
                    <label className="cbc-label" htmlFor="passwordInput">
                      비밀번호
                      <span aria-hidden="true" className="cbc-required">
                        *
                      </span>
                      <span className="sr-only">(필수 입력 항목)</span>
                    </label>
                  </div>
                  <div className="cbc-input-wrap">
                    <input
                      id="passwordInput"
                      name="password"
                      type={showLoginPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      placeholder="비밀번호를 입력하세요"
                      value={loginPassword}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                        if (errorMessage) resetMessages();
                      }}
                      aria-invalid={Boolean(
                        errorMessage || fieldErrors.password,
                      )}
                      aria-describedby={
                        errorMessage ? "loginErrorMessage" : undefined
                      }
                      className={`cbc-input ${
                        errorMessage || fieldErrors.password ? "is-error" : ""
                      }`}
                    />
                    <button
                      type="button"
                      className="cbc-input-action-right"
                      aria-label="비밀번호 표시 전환"
                      onClick={() => setShowLoginPassword((prev) => !prev)}
                    >
                      <EyeIcon visible={showLoginPassword} />
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="cbc-field-error">{fieldErrors.password}</p>
                  )}
                </div>

                {errorMessage && (
                  <div
                    id="loginErrorMessage"
                    className="cbc-error-banner"
                    role="alert"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                      style={{ flexShrink: 0, color: "var(--error)" }}
                    >
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                    <span>{errorMessage}</span>
                  </div>
                )}

                <div className="cbc-form-row-between">
                  <label className="cbc-checkbox-label" htmlFor="rememberMe">
                    <input
                      id="rememberMe"
                      name="remember"
                      type="checkbox"
                      className="cbc-checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    <span>로그인 상태 유지</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="cbc-btn-primary"
                  disabled={submitting}
                >
                  <span>{submitting ? "로그인 중..." : "로그인"}</span>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10 17l5-5-5-5v10zM19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" />
                  </svg>
                </button>
              </form>

              <div className="cbc-oauth-divider">
                <span>또는 외부 인증으로 로그인</span>
              </div>

              <button
                type="button"
                className="cbc-btn-secondary cbc-btn-oauth42"
                disabled={submitting}
                data-testid="oauth-42-login-btn"
                onClick={handleOAuth42Login}
              >
                <span className="cbc-oauth42-badge" aria-hidden="true">
                  42
                </span>
                <span>42 Intra 계정으로 계속하기</span>
              </button>

              <div className="cbc-card-footer-switch">
                <span>아직 계정이 없으신가요?</span>{" "}
                <button
                  type="button"
                  className="cbc-link"
                  onClick={() => switchView("register")}
                >
                  회원가입
                </button>
              </div>
            </div>

            <div className="cbc-safety-caption">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
              </svg>
              <span>개인정보 암호화 및 2단계 보안 인증 채널 가동 중</span>
            </div>
          </div>
        ) : view === "register" ? (
          <div className="cbc-stage">
            <div className="cbc-glow-left" />
            <div className="cbc-glow-right" />

            <div className="cbc-signup-wrapper">
              {/* Left Hero / Atmosphere Panel (02_signup) */}
              <div className="cbc-signup-hero">
                <div className="cbc-signup-hero-pattern" aria-hidden="true">
                  <svg width="100%" height="100%" viewBox="0 0 400 600">
                    <defs>
                      <pattern
                        id="go-grid"
                        width="40"
                        height="40"
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d="M 40 0 L 0 0 0 40"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1"
                        />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#go-grid)" />
                  </svg>
                </div>

                <div style={{ position: "relative", zIndex: 10 }}>
                  <div className="cbc-hero-badge">
                    <span className="cbc-pulse-dot" />
                    <span>오목 · 클래식 테이블탑</span>
                  </div>
                  <h2 className="cbc-hero-title">
                    차분한 원두 향과
                    <br />
                    돌을 놓는 즐거움
                  </h2>
                  <p className="cbc-hero-desc">
                    온라인 오목 대국실과 따뜻한 아날로그 감성이 머무는 공간,
                    Cyber Board Cafe의 정식 멤버가 되어보세요.
                  </p>
                </div>

                <div className="cbc-board-illustration" aria-hidden="true">
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 400 300"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect width="400" height="300" fill="#dec8b0" />
                    <g stroke="#806a54" strokeOpacity="0.6" strokeWidth="1.5">
                      <line x1="60" x2="340" y1="65" y2="65" />
                      <line x1="60" x2="340" y1="100" y2="100" />
                      <line x1="60" x2="340" y1="135" y2="135" />
                      <line x1="60" x2="340" y1="170" y2="170" />
                      <line x1="60" x2="340" y1="205" y2="205" />
                      <line x1="60" x2="340" y1="240" y2="240" />
                      <line x1="100" x2="100" y1="30" y2="275" />
                      <line x1="140" x2="140" y1="30" y2="275" />
                      <line x1="180" x2="180" y1="30" y2="275" />
                      <line x1="220" x2="220" y1="30" y2="275" />
                      <line x1="260" x2="260" y1="30" y2="275" />
                      <line x1="300" x2="300" y1="30" y2="275" />
                    </g>
                    <circle cx="180" cy="135" r="14" fill="#2e2924" />
                    <circle cx="220" cy="135" r="14" fill="#f3ede5" />
                    <circle cx="220" cy="170" r="14" fill="#2e2924" />
                    <circle cx="180" cy="170" r="14" fill="#f3ede5" />
                    <circle cx="140" cy="135" r="14" fill="#f3ede5" />
                    <circle cx="260" cy="135" r="14" fill="#2e2924" />
                  </svg>
                  <div className="cbc-board-overlay">
                    <span>실시간 대국 매칭 준비 완료</span>
                  </div>
                </div>

                <div className="cbc-active-players-card">
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--on-surface-variant)",
                        fontWeight: 600,
                      }}
                    >
                      현재 접속 플레이어
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-headline)",
                        fontSize: "18px",
                        fontWeight: 700,
                      }}
                    >
                      실시간 대국 대기 중
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "0.25rem 0.625rem",
                      borderRadius: "0.375rem",
                      backgroundColor: "var(--secondary-container)",
                      color: "var(--on-secondary-container)",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    쾌적함
                  </span>
                </div>
              </div>

              {/* Right Registration Form Panel (02_signup) */}
              <div className="cbc-signup-form-panel">
                <header style={{ marginBottom: "1.75rem" }}>
                  <h1 className="cbc-heading-signup">회원가입</h1>
                  <p
                    className="cbc-subheading"
                    style={{ marginTop: "0.5rem", fontSize: "15px" }}
                  >
                    새로운 계정을 생성하고 온라인 오목과 보드게임을 즐겨보세요.
                  </p>
                </header>

                <form
                  id="signup-form"
                  className="cbc-form"
                  onSubmit={handleRegisterSubmit}
                  noValidate
                >
                  {/* Email Input Group */}
                  <div className="cbc-field">
                    <div className="cbc-label-row">
                      <label className="cbc-label" htmlFor="user-email">
                        이메일
                      </label>
                      {fieldErrors.email ? (
                        <span className="cbc-label-error-badge">확인 필요</span>
                      ) : (
                        <span className="cbc-label-hint">로그인 계정용</span>
                      )}
                    </div>
                    <div className="cbc-input-wrap">
                      <input
                        id="user-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder="user@example.com"
                        value={regEmail}
                        onChange={(e) => {
                          setRegEmail(e.target.value);
                          if (fieldErrors.email || errorMessage) {
                            resetMessages();
                          }
                        }}
                        aria-invalid={Boolean(fieldErrors.email)}
                        aria-describedby={
                          fieldErrors.email ? "email-error-msg" : undefined
                        }
                        className={`cbc-input ${
                          fieldErrors.email ? "is-error" : ""
                        }`}
                      />
                    </div>
                    {fieldErrors.email && (
                      <p id="email-error-msg" className="cbc-field-error">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>

                  {/* Password Input Group */}
                  <div className="cbc-field">
                    <div className="cbc-label-row">
                      <label className="cbc-label" htmlFor="user-password">
                        비밀번호
                      </label>
                      {fieldErrors.password && (
                        <span className="cbc-label-error-badge">확인 필요</span>
                      )}
                    </div>
                    <div className="cbc-input-wrap">
                      <input
                        id="user-password"
                        name="password"
                        type={showRegPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        placeholder="비밀번호를 입력하세요"
                        value={regPassword}
                        onChange={(e) => {
                          setRegPassword(e.target.value);
                          if (fieldErrors.password || errorMessage) {
                            resetMessages();
                          }
                        }}
                        aria-invalid={Boolean(fieldErrors.password)}
                        aria-describedby={
                          fieldErrors.password
                            ? "password-error-msg"
                            : undefined
                        }
                        className={`cbc-input ${
                          fieldErrors.password ? "is-error" : ""
                        }`}
                      />
                      <button
                        type="button"
                        id="toggle-pwd-btn"
                        className="cbc-input-action-right"
                        aria-label="비밀번호 표시 전환"
                        onClick={() => setShowRegPassword((prev) => !prev)}
                      >
                        <EyeIcon visible={showRegPassword} />
                      </button>
                    </div>
                    {fieldErrors.password ? (
                      <p id="password-error-msg" className="cbc-field-error">
                        {fieldErrors.password}
                      </p>
                    ) : (
                      <p className="cbc-field-helper">
                        <span>8자 이상 입력해 주세요</span>
                      </p>
                    )}
                  </div>

                  {/* Nickname Input Group */}
                  <div className="cbc-field">
                    <div className="cbc-label-row">
                      <label className="cbc-label" htmlFor="user-nickname">
                        닉네임
                      </label>
                      {fieldErrors.nickname ? (
                        <span className="cbc-label-error-badge">확인 필요</span>
                      ) : (
                        <span className="cbc-label-hint">
                          2~32자 (문자·숫자·_·-)
                        </span>
                      )}
                    </div>
                    <div className="cbc-input-wrap">
                      <input
                        id="user-nickname"
                        name="nickname"
                        type="text"
                        required
                        placeholder="닉네임을 입력하세요"
                        value={regNickname}
                        onChange={(e) => {
                          setRegNickname(e.target.value);
                          if (fieldErrors.nickname || errorMessage) {
                            resetMessages();
                          }
                        }}
                        aria-invalid={Boolean(fieldErrors.nickname)}
                        aria-describedby={
                          fieldErrors.nickname
                            ? "nickname-error-msg"
                            : undefined
                        }
                        className={`cbc-input ${
                          fieldErrors.nickname ? "is-error" : ""
                        }`}
                      />
                    </div>
                    {fieldErrors.nickname && (
                      <p id="nickname-error-msg" className="cbc-field-error">
                        {fieldErrors.nickname}
                      </p>
                    )}
                  </div>

                  {/* Terms Agreement Checkbox */}
                  <div className="cbc-terms-box">
                    <input
                      id="agree-terms"
                      name="agree-terms"
                      type="checkbox"
                      className="cbc-checkbox"
                      checked={agreeTerms}
                      onChange={(e) => {
                        setAgreeTerms(e.target.checked);
                        if (errorMessage) resetMessages();
                      }}
                    />
                    <div className="cbc-terms-copy-wrap">
                      <label
                        htmlFor="agree-terms"
                        style={{
                          fontSize: "14px",
                          lineHeight: "20px",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <span>이용약관 및 개인정보처리방침에 동의합니다</span>
                      </label>
                      <div className="cbc-terms-inline-links">
                        <button
                          type="button"
                          className="cbc-link cbc-terms-inline-btn"
                          data-testid="signup-open-terms"
                          onClick={() => openLegalDoc("terms")}
                        >
                          이용약관 전문 보기
                        </button>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          className="cbc-link cbc-terms-inline-btn"
                          data-testid="signup-open-privacy"
                          onClick={() => openLegalDoc("privacy")}
                        >
                          개인정보처리방침 전문 보기
                        </button>
                      </div>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="cbc-error-banner" role="alert">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                        style={{ flexShrink: 0, color: "var(--error)" }}
                      >
                        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                      </svg>
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="cbc-btn-primary"
                    disabled={submitting}
                  >
                    <span>{submitting ? "가입 처리 중..." : "가입하기"}</span>
                  </button>

                  <div className="cbc-card-footer-switch">
                    <span>이미 계정이 있으신가요?</span>{" "}
                    <button
                      type="button"
                      className="cbc-link"
                      onClick={() => switchView("login")}
                    >
                      로그인
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : view === "twoFactor" ? (
          <div className="cbc-stage">
            <div className="cbc-login-card">
              <div className="cbc-card-header-center">
                <h1 className="cbc-heading-login">2단계 인증</h1>
                <p className="cbc-subheading">
                  인증 앱의 6자리 코드 또는 복구 코드를 입력해 주세요.
                </p>
              </div>

              <form
                id="otp-form"
                className="cbc-form"
                onSubmit={handleTwoFactorSubmit}
              >
                <div className="cbc-field">
                  <label className="cbc-label" htmlFor="twoFactorCodeInput">
                    인증 코드
                  </label>
                  <input
                    id="twoFactorCodeInput"
                    type="text"
                    required
                    placeholder="6자리 숫자 또는 복구 코드"
                    value={twoFactorCode}
                    onChange={(e) => {
                      setTwoFactorCode(e.target.value);
                      if (errorMessage) resetMessages();
                    }}
                    className={`cbc-input ${errorMessage ? "is-error" : ""}`}
                  />
                </div>

                {errorMessage && (
                  <div className="cbc-error-banner" role="alert">
                    <span>{errorMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="cbc-btn-primary"
                  disabled={submitting}
                >
                  <span>{submitting ? "확인 중..." : "확인"}</span>
                </button>
              </form>

              <div className="cbc-card-footer-switch">
                <button
                  type="button"
                  className="cbc-link"
                  onClick={() => {
                    setChallengeToken(null);
                    switchView("login");
                  }}
                >
                  다른 계정으로 로그인
                </button>
              </div>
            </div>
          </div>
        ) : view === "profile" && currentUser ? (
          <ProfileView
            key={profileUserId ?? currentUser.id}
            userId={profileUserId ?? currentUser.id}
            currentUser={currentUser}
            onCurrentUserUpdated={setCurrentUser}
            onOpenProfile={openProfile}
            onOpenLeaderboard={() => switchView("leaderboard")}
            onOpenFriends={openFriends}
            onBack={() => switchView("lobby")}
          />
        ) : view === "friends" && currentUser ? (
          <FriendsView
            key={currentUser.id}
            currentUserId={currentUser.id}
            connected={gomokuState.connectionPhase === "connected"}
            refreshVersion={friendsRefreshVersion}
            initialQuery={friendsQuery}
            onOpenProfile={openProfile}
            onBack={() => switchView("lobby")}
          />
        ) : view === "leaderboard" && currentUser ? (
          <LeaderboardView
            currentUserId={currentUser.id}
            onOpenProfile={openProfile}
          />
        ) : view === "matchmaking" ? (
          <MatchmakingView
            state={matchmakingState}
            connectionPhase={gomokuState.connectionPhase}
            userId={currentUser?.id ?? null}
            onCancelQueue={handleCancelMatchmaking}
            onDismissError={handleDismissMatchmakingError}
          />
        ) : view === "gomoku" ? (
          <GomokuMatchView
            state={gomokuState}
            viewerNickname={currentUser?.nickname}
            playerNicknames={playerNicknames}
            onPlaceStone={handlePlaceGomokuStone}
            onResign={handleResignGomoku}
            onReconnect={handleReconnectGomoku}
            onDismissError={handleDismissGomokuError}
            onPlayAgain={handlePlayAgainGomoku}
            onBackToLobby={handleBackToLobbyFromGomoku}
          />
        ) : view === "othello" ? (
          <OthelloMatchView
            state={othelloState}
            viewerNickname={currentUser?.nickname}
            playerNicknames={playerNicknames}
            onPlaceDisc={handlePlaceOthelloDisc}
            onResign={handleResignOthello}
            onReconnect={handleReconnectGomoku}
            onDismissError={handleDismissOthelloError}
            onPlayAgain={handlePlayAgainOthello}
            onBackToLobby={handleBackToLobbyFromOthello}
          />
        ) : (
          /* Authenticated Lobby View (04_home_lobby + 20_logout_modal) */
          <div className="cbc-lobby-container" data-testid="lobby-view">
            {noticeMessage && (
              <div className="cbc-success-banner" role="status">
                <span>{noticeMessage}</span>
              </div>
            )}

            {errorMessage && (
              <div className="cbc-error-banner" role="alert">
                <span>{errorMessage}</span>
              </div>
            )}

            {matchmakingState.error && (
              <div
                className="cbc-error-banner"
                role="alert"
                data-testid="lobby-matchmaking-error"
                data-error-code={matchmakingState.error.code}
                style={{ justifyContent: "space-between" }}
              >
                <span>
                  [{matchmakingState.error.code}]{" "}
                  {matchmakingState.error.message}
                </span>
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  style={{ width: "auto", padding: "0.25rem 0.625rem" }}
                  onClick={handleDismissMatchmakingError}
                >
                  닫기
                </button>
              </div>
            )}

            {gomokuState.gameError && (
              <div className="cbc-error-banner" role="alert">
                <span>
                  [{gomokuState.gameError.code}] {gomokuState.gameError.message}
                </span>
              </div>
            )}

            <section className="cbc-welcome-banner">
              <div>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--primary)",
                    letterSpacing: "0.04em",
                  }}
                >
                  CYBER BOARD CAFE MEMBER
                </span>
                <h1 className="cbc-welcome-title">
                  환영합니다, {currentUser?.nickname} 님
                </h1>
                <p className="cbc-subheading">
                  오늘도 차분한 원목 테이블에서 명승부를 펼쳐보세요. (계정:{" "}
                  {currentUser?.email})
                </p>
              </div>

              <div className="cbc-stats-tray">
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--on-surface-variant)",
                      fontWeight: 600,
                    }}
                  >
                    회원 번호
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-headline)",
                      fontSize: "20px",
                      fontWeight: 700,
                    }}
                  >
                    #{currentUser?.id}
                  </div>
                </div>
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  style={{ width: "auto" }}
                  onClick={() => currentUser && openProfile(currentUser.id)}
                >
                  내 프로필
                </button>
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  style={{ width: "auto" }}
                  onClick={() => switchView("leaderboard")}
                >
                  리더보드
                </button>
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  style={{ width: "auto" }}
                  onClick={() => openFriends()}
                >
                  친구 관리
                </button>
                <button
                  type="button"
                  className="cbc-btn-secondary"
                  style={{ width: "auto" }}
                  onClick={(e) => {
                    lastLogoutTriggerRef.current = e.currentTarget;
                    setLogoutModalOpen(true);
                  }}
                >
                  로그아웃
                </button>
              </div>
            </section>

            {/* 게임 선택 카탈로그 및 매칭 시작 (FR-CAT-01, FR-CAT-02, FR-MATCH-01) */}
            <section className="cbc-lobby-grid" aria-label="추천 게임">
              {GAME_CATALOG_LIST.map((entry) => {
                const isSelected =
                  matchmakingState.selectedGameType === entry.gameType;
                return (
                  <article
                    key={entry.gameType}
                    className={`cbc-game-card ${isSelected ? "is-selected" : ""}`}
                    data-testid={`game-card-${entry.gameType}`}
                    data-selected={isSelected ? "true" : "false"}
                  >
                    <div>
                      <div className="cbc-game-card-top">
                        <div>
                          <span className="cbc-game-card-subtitle">
                            {entry.subtitle}
                          </span>
                          <h2 className="cbc-game-card-title">{entry.title}</h2>
                        </div>
                        <span
                          className={`cbc-security-pill ${
                            entry.playable ? "" : "is-muted"
                          }`}
                        >
                          {entry.playable && <span className="cbc-pulse-dot" />}
                          {entry.statusBadge}
                        </span>
                      </div>

                      <p className="cbc-subheading">{entry.description}</p>

                      {/* 사전 대국 규칙 요약 리스트 (FR-CAT-02) */}
                      <dl className="cbc-lobby-rule-list">
                        <div className="cbc-lobby-rule-row">
                          <dt>보드 크기</dt>
                          <dd>
                            {entry.boardSizeLabel} ({entry.boardSubLabel})
                          </dd>
                        </div>
                        {entry.rules.slice(0, 3).map((rule) => (
                          <div key={rule.label} className="cbc-lobby-rule-row">
                            <dt>{rule.label}</dt>
                            <dd>{rule.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>

                    <div className="cbc-lobby-gomoku-actions">
                      <div className="cbc-game-select-row">
                        <button
                          type="button"
                          className={`cbc-btn-secondary cbc-game-select-btn ${
                            isSelected ? "is-selected" : ""
                          }`}
                          aria-pressed={isSelected}
                          data-testid={`select-game-${entry.gameType}`}
                          onClick={() => handleSelectGame(entry.gameType)}
                        >
                          {isSelected
                            ? `${entry.shortTitle} 선택됨`
                            : `${entry.shortTitle} 선택`}
                        </button>

                        {entry.playable ? (
                          <button
                            type="button"
                            className="cbc-btn-primary cbc-game-match-btn"
                            data-testid={`start-matchmaking-${entry.gameType}`}
                            onClick={() =>
                              handleStartMatchmaking(entry.gameType)
                            }
                          >
                            {entry.shortTitle} 빠른 매칭 시작
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="cbc-btn-secondary cbc-game-match-btn"
                            data-testid={`start-matchmaking-${entry.gameType}`}
                            disabled
                          >
                            {entry.shortTitle} 매칭 준비 중
                          </button>
                        )}
                      </div>

                      {entry.gameType === "othello" &&
                        othelloState.matchId !== null &&
                        othelloState.snapshot?.gameType === "othello" &&
                        othelloState.snapshot.status !== "finished" && (
                          <button
                            type="button"
                            className="cbc-btn-primary"
                            data-testid="return-active-othello-match-btn"
                            onClick={() => switchView("othello")}
                          >
                            진행 중인 오델로 대국(#{othelloState.matchId}) 복귀
                          </button>
                        )}

                      {entry.gameType === "gomoku" && (
                        <>
                          {gomokuState.matchId !== null &&
                            gomokuState.snapshot?.status !== "finished" && (
                              <button
                                type="button"
                                className="cbc-btn-primary"
                                data-testid="return-active-match-btn"
                                onClick={() => switchView("gomoku")}
                              >
                                진행 중인 오목 대국(#{gomokuState.matchId}) 복귀
                              </button>
                            )}

                          <form
                            className="cbc-match-join-form"
                            onSubmit={handleSubscribeByMatchId}
                          >
                            <label htmlFor="matchIdInput" className="sr-only">
                              대국 번호(matchId) 입력
                            </label>
                            <input
                              id="matchIdInput"
                              type="number"
                              min={1}
                              placeholder="대국 번호 (matchId) 입력"
                              value={matchIdInput}
                              onChange={(e) => setMatchIdInput(e.target.value)}
                              className="cbc-input cbc-match-join-input"
                            />
                            <button
                              type="submit"
                              className="cbc-btn-secondary cbc-match-join-btn"
                            >
                              대국실 입장
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </div>
        )}
      </main>

      {/* Logout Confirmation Dialog (20_logout_modal) */}
      {logoutModalOpen && (
        <div
          id="modalOverlay"
          className="cbc-modal-backdrop"
          onClick={() => {
            setLogoutModalOpen(false);
            lastLogoutTriggerRef.current?.focus();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-title"
            aria-describedby="logout-desc"
            className="cbc-modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cbc-modal-alert-icon" aria-hidden="true">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
            </div>
            <h3
              id="logout-title"
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "22px",
                margin: "0 0 0.5rem",
              }}
            >
              정말 로그아웃하시겠습니까?
            </h3>
            <p
              id="logout-desc"
              className="cbc-subheading"
              style={{ maxWidth: "320px" }}
            >
              로그아웃하면 현재 세션이 종료되며, 다시 로그인해야 게임을 이용할
              수 있습니다.
            </p>
            <div className="cbc-modal-actions">
              <button
                type="button"
                id="cancelLogoutBtn"
                className="cbc-btn-secondary"
                disabled={submitting}
                onClick={() => {
                  setLogoutModalOpen(false);
                  lastLogoutTriggerRef.current?.focus();
                }}
              >
                취소
              </button>
              <button
                type="button"
                id="confirmLogoutBtn"
                className="cbc-btn-danger"
                disabled={submitting}
                onClick={handleConfirmLogout}
              >
                <span>{submitting ? "종료 중..." : "로그아웃"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="cbc-footer">
        <div className="cbc-footer-inner">
          <nav className="cbc-footer-nav" aria-label="정책 안내">
            <a
              className="cbc-footer-link"
              href="/terms"
              data-testid="footer-link-terms"
              onClick={(e) => {
                e.preventDefault();
                openLegalDoc("terms");
              }}
            >
              이용약관
            </a>
            <a
              className="cbc-footer-link"
              href="/privacy"
              data-testid="footer-link-privacy"
              onClick={(e) => {
                e.preventDefault();
                openLegalDoc("privacy");
              }}
            >
              개인정보처리방침
            </a>
          </nav>
          <p className="cbc-footer-copy">
            <BoardLogoSvg size={20} />
            <span>© 2026 Cyber Board Cafe. 모든 권리 보유.</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * 브라우저 URL 경로(pathname, search, hash) 파싱 및 화면 전환 경로 동기화 순수 함수와
 * 이용약관(/terms)·개인정보처리방침(/privacy) 정적 고지 문안 데이터를 정의합니다.
 * (SRS NFR-PRIV-01, NFR-UX-01~02, SDS 2.2)
 */

/** 약관·개인정보처리방침 문서 탭 종류 */
export type LegalDocKind = "terms" | "privacy";

/** 약관·개인정보처리방침 개별 조항 구조 */
export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

/** URL 경로 파싱 결과 타입 */
export type ParsedAppRoute =
  | { readonly kind: "lobby" }
  | { readonly kind: "login" }
  | { readonly kind: "register" }
  | { readonly kind: "twoFactor" }
  | {
      readonly kind: "oauthCallback";
      readonly code: string | null;
      readonly state: string | null;
      readonly error: string | null;
    }
  | { readonly kind: "matchmaking" }
  | { readonly kind: "match"; readonly matchId: number }
  | { readonly kind: "myProfile" }
  | { readonly kind: "userProfile"; readonly userId: number }
  | { readonly kind: "leaderboard" }
  | { readonly kind: "friends" }
  | { readonly kind: "terms" }
  | { readonly kind: "privacy" }
  | { readonly kind: "notFound"; readonly pathname: string };

/**
 * 양의 안전 정수 ID 문자열을 파싱합니다.
 */
function parsePositiveSafeInt(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return parsed;
}

/**
 * 브라우저의 `pathname`, `search`, `hash`를 분석하여 앱 라우트 상태를 반환합니다.
 * 정의되지 않은 경로는 `{ kind: "notFound", pathname }`으로 분류합니다 (SDS 2.2 `21_error_404`).
 */
export function parseAppRoute(
  pathname: string,
  search = "",
  hash = "",
): ParsedAppRoute {
  const normalizedHash = hash.trim().replace(/^#/, "").toLowerCase();
  if (normalizedHash === "terms") {
    return { kind: "terms" };
  }
  if (normalizedHash === "privacy") {
    return { kind: "privacy" };
  }

  const normalizedPath = pathname.trim() || "/";
  const searchParams = new URLSearchParams(search);
  const oauthCode = searchParams.get("code")?.trim() || null;
  const oauthState = searchParams.get("state")?.trim() || null;
  const oauthError =
    searchParams.get("error_description")?.trim() ||
    searchParams.get("error")?.trim() ||
    null;

  if (
    normalizedPath === "/oauth/42/callback" ||
    normalizedPath === "/oauth/42/callback/" ||
    normalizedPath === "/auth/oauth/42/callback" ||
    normalizedPath === "/auth/oauth/42/callback/" ||
    (oauthCode !== null && oauthState !== null)
  ) {
    return {
      kind: "oauthCallback",
      code: oauthCode,
      state: oauthState,
      error: oauthError,
    };
  }

  if (normalizedPath === "/terms" || normalizedPath === "/terms/") {
    return { kind: "terms" };
  }
  if (normalizedPath === "/privacy" || normalizedPath === "/privacy/") {
    return { kind: "privacy" };
  }
  if (normalizedPath === "/login" || normalizedPath === "/login/") {
    return { kind: "login" };
  }
  if (
    normalizedPath === "/signup" ||
    normalizedPath === "/signup/" ||
    normalizedPath === "/register" ||
    normalizedPath === "/register/"
  ) {
    return { kind: "register" };
  }
  if (normalizedPath === "/login/2fa" || normalizedPath === "/login/2fa/") {
    return { kind: "twoFactor" };
  }
  if (normalizedPath === "/matching" || normalizedPath === "/matching/") {
    return { kind: "matchmaking" };
  }
  if (normalizedPath === "/me" || normalizedPath === "/me/") {
    return { kind: "myProfile" };
  }
  if (normalizedPath === "/leaderboard" || normalizedPath === "/leaderboard/") {
    return { kind: "leaderboard" };
  }
  if (normalizedPath === "/friends" || normalizedPath === "/friends/") {
    return { kind: "friends" };
  }

  const matchPath = /^\/match\/(\d+)\/?$/.exec(normalizedPath);
  if (matchPath) {
    const matchId = parsePositiveSafeInt(matchPath[1]);
    if (matchId !== null) {
      return { kind: "match", matchId };
    }
    return { kind: "notFound", pathname: normalizedPath };
  }

  const userPath = /^\/users\/(\d+)\/?$/.exec(normalizedPath);
  if (userPath) {
    const userId = parsePositiveSafeInt(userPath[1]);
    if (userId !== null) {
      return { kind: "userProfile", userId };
    }
    return { kind: "notFound", pathname: normalizedPath };
  }

  if (normalizedPath === "/" || normalizedPath === "/index.html") {
    const queryMatchId = parsePositiveSafeInt(searchParams.get("matchId"));
    if (queryMatchId !== null) {
      return { kind: "match", matchId: queryMatchId };
    }
    return { kind: "lobby" };
  }

  return { kind: "notFound", pathname: normalizedPath };
}

/**
 * 화면 상태에 대응하는 표준 브라우저 URL 경로를 반환합니다.
 */
export function resolvePathForScreen(options: {
  view:
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
  matchId?: number | null;
  profileUserId?: number | null;
  currentUserId?: number | null;
}): string | null {
  switch (options.view) {
    case "terms":
      return "/terms";
    case "privacy":
      return "/privacy";
    case "login":
      return "/login";
    case "register":
      return "/signup";
    case "twoFactor":
      return "/login/2fa";
    case "oauthCallback":
      return null;
    case "lobby":
      return "/";
    case "matchmaking":
      return "/matching";
    case "gomoku":
    case "othello":
      return options.matchId !== null && options.matchId !== undefined
        ? `/match/${options.matchId}`
        : "/";
    case "profile": {
      const targetId = options.profileUserId ?? options.currentUserId ?? null;
      if (
        targetId !== null &&
        options.currentUserId !== null &&
        options.currentUserId !== undefined &&
        targetId !== options.currentUserId
      ) {
        return `/users/${targetId}`;
      }
      return "/me";
    }
    case "leaderboard":
      return "/leaderboard";
    case "friends":
      return "/friends";
    case "notFound":
      return null;
  }
}

/** 이용약관(/terms) 최종 시행일 */
export const TERMS_EFFECTIVE_DATE = "2026-10-13";

/** 개인정보처리방침(/privacy) 최종 시행일 */
export const PRIVACY_EFFECTIVE_DATE = "2026-10-13";

/**
 * 사이버 보드게임 카페 서비스 이용약관 전문 (NFR-PRIV-01, 실제 제공 기능 및 서버 권위 규칙 반영)
 */
export const TERMS_OF_SERVICE_SECTIONS: readonly LegalSection[] = [
  {
    id: "terms-purpose",
    title: "제1조 (목적 및 서비스 범위)",
    paragraphs: [
      "본 약관은 사이버 보드게임 카페(Cyber Board Cafe, 이하 '서비스')가 제공하는 턴제 온라인 보드게임 플랫폼 및 관련 계정·프로필·매칭·전적 서비스의 이용 조건과 절차를 규정합니다.",
      "서비스는 15×15 자유룰 오목(gomoku-freestyle-v1)과 8×8 표준 오델로(othello-standard-v1) 실시간 1:1 온라인 대국, 자동 매칭 대기열, 프로필·아바타 관리, 게임별 전적·통계·업적·리더보드 조회 기능을 제공합니다.",
    ],
  },
  {
    id: "terms-account",
    title: "제2조 (계정 생성 및 인증 보안)",
    paragraphs: [
      "이용자는 유효한 이메일 주소, 비밀번호(8~128자), 고유한 닉네임(2~32자)을 입력하여 회원가입할 수 있으며, 승인된 외부 인증(42 Intra OAuth 2.0) 또는 TOTP 기반 2단계 인증(2FA)을 계정에 설정할 수 있습니다.",
    ],
    bullets: [
      "동일한 이메일 주소 또는 이미 사용 중인 닉네임으로는 중복 가입할 수 없습니다.",
      "로그아웃 시 해당 기기 세션의 인증 및 실시간 WebSocket 연결 권한은 즉시 만료됩니다.",
      "타인의 계정 정보를 도용하거나 비정상적인 자동화 요청(분당 허용 한도 초과 등)을 전송하는 행위는 제한됩니다.",
    ],
  },
  {
    id: "terms-fairplay",
    title: "제3조 (서버 권위 대국 판정 및 재접속 정책)",
    paragraphs: [
      "모든 대국의 차례, 합법 착수 여부, 상태 버전(stateVersion), 승패 및 종료 사유는 클라이언트가 아닌 서버가 단독으로 검증하고 확정합니다(Server-Authoritative).",
    ],
    bullets: [
      "이미 돌이 놓인 위치, 보드 범위 밖 좌표, 내 차례가 아닌 시점의 착수 또는 오래된 상태 버전의 명령은 서버에서 거절됩니다.",
      "대국 중 네트워크 단절이 발생하면 경기는 일시정지(paused) 상태로 전환되며, 플레이어별 경기당 누적 60초의 복귀 유예 시간이 부여됩니다.",
      "누적 60초 이내에 재접속하면 최신 보드 스냅샷으로 대국이 재개되며, 60초를 초과하면 단독 미복귀자는 시간패(disconnect_timeout), 양쪽 모두 미복귀 시 무효(void)로 1회 확정됩니다.",
      "서버 재시작 시 진행 중이던 미완료 대국은 데이터 정합성을 위해 무효(server_restart, void)로 일괄 정리되며 승패 통계에 반영되지 않습니다.",
    ],
  },
  {
    id: "terms-records",
    title: "제4조 (전적·통계·리더보드 산정)",
    paragraphs: [
      "정상 종료(five_in_row, disc_count, draw, resign, disconnect_timeout)된 대국은 데이터베이스에 영속 기록되며, 게임별 승·패·무·승률, 첫 승리 업적, 10경기 참여 진행도 및 리더보드 순위 산출에 사용됩니다.",
      "무효(void) 처리된 대국은 완료 경기 수, 승률, 진행도 및 리더보드 집계에서 제외됩니다.",
    ],
  },
];

/**
 * 사이버 보드게임 카페 개인정보처리방침 전문 (NFR-PRIV-01, DATA-04~05, SDS 1.1·2.10.25·2.10.27 기준)
 */
export const PRIVACY_POLICY_SECTIONS: readonly LegalSection[] = [
  {
    id: "privacy-collected",
    title: "1. 수집 및 생성되는 정보 항목",
    paragraphs: [
      "서비스는 회원가입, 본인 인증, 프로필 관리 및 실시간 대국 제공을 위해 필요한 최소한의 정보만 수집·처리합니다.",
    ],
    bullets: [
      "계정 필수 정보: 이메일 주소(로그인 식별용, 타 사용자에게 비공개), 비밀번호 해시(평문은 절대 저장하지 않으며 Argon2id 해시로만 저장), 닉네임(2~32자 공개 표시명)",
      "42 OAuth 로그인·연동 정보: 42에서 받은 외부 계정 고유 식별자(providerUserId)와 OAuth 상태 토큰 해시(SHA-256, 10분 유효 1회용)를 저장합니다. 42로 처음 가입할 때는 42 계정의 이메일 주소를 계정 이메일로 저장하고, 42 로그인 아이디는 닉네임을 정하는 데만 사용합니다(이미 쓰이는 닉네임이면 무작위 접미사를 붙임). 42 액세스 토큰은 프로필 조회에만 쓰고 저장하지 않습니다.",
      "선택 보안 정보: TOTP 2단계 인증 설정 시 암호화된 시크릿(AES-256-GCM) 및 복구 코드 해시(SHA-256)",
      "선택 프로필 미디어: 사용자가 직접 업로드한 아바타 이미지 파일(PNG 또는 JPEG, 최대 2 MiB, 최대 1024×1024px, 매직 바이트 검증 후 서버 전용 저장소에 무작위 파일명으로 보관)",
      "서비스 이용·세션 정보: 서버 세션 식별자(UUID), 리프레시 토큰 해시(SHA-256, 1회용 회전, 로그인 시점부터 7일 뒤 만료), 대국 참가·착수 기록(games, game_players, moves, game_commands)",
    ],
  },
  {
    id: "privacy-purpose",
    title: "2. 개인정보의 이용 목적",
    paragraphs: [
      "수집된 정보는 다음의 목적 범위 내에서만 이용되며, 광고·마케팅 또는 제3자 판매 목적으로 이용되지 않습니다.",
    ],
    bullets: [
      "회원 식별, 로그인·로그아웃 세션 관리, 2단계 인증(2FA) 및 42 OAuth 계정 연동 처리",
      "무차별 대입 공격 방지를 위한 요청 빈도 제한(Rate Limit, 분당 10회) 및 부정 행위 차단",
      "실시간 WebSocket 대국 진행, 연결 끊김 후 재접속 시 활성 대국 복구, 다중 탭 제어권 관리",
      "게임별 전적·승률·업적(첫 승)·진행도(10판)·리더보드 산출 및 공개 프로필 제공",
      "전적 공개는 기본적으로 켜져 있으며 내 프로필에서 변경할 수 있습니다. 비공개로 설정하면 본인 외 사용자는 프로필의 통계·업적·대국 기록을 조회할 수 없습니다. 닉네임·아바타, 리더보드, 상대방이 자신의 전적에서 보는 대국 상대 정보는 계속 표시됩니다.",
    ],
  },
  {
    id: "privacy-security",
    title: "3. 개인정보의 안전성 확보 조치 (DATA-05)",
    paragraphs: [
      "서비스는 설계 단계부터 개인정보와 인증 비밀값이 외부에 노출되지 않도록 다음과 같은 기술적 보호 조치를 적용합니다.",
    ],
    bullets: [
      "비밀번호는 Argon2id(19 MiB 메모리, 2회 반복, 고유 솔트) 알고리즘으로 해시하여 저장합니다.",
      "액세스 토큰(JWT, 30분 유효)은 브라우저 메모리에만 보관하며, 리프레시 토큰은 사용할 때마다 새 토큰으로 회전하고 재사용 감지 시 해당 세션을 즉시 전체 폐기합니다.",
      "공개 프로필 API(/api/users/:userId) 및 리더보드 응답에는 이메일 주소, 비밀번호 해시, 2FA 시크릿 등 민감 정보를 절대 포함하지 않습니다.",
      "서버 로그 및 오류 응답에는 비밀번호, 토큰 원문, 데이터베이스 연결 문자열, 내부 스택 트레이스를 기록하거나 노출하지 않습니다.",
    ],
  },
  {
    id: "privacy-retention",
    title: "4. 보유 기간 및 파기 정책 (DATA-04)",
    paragraphs: [
      "이용자의 개인정보는 계정 유지 기간 동안 보유하며, 세션·아바타·계정 삭제 시 다음과 같이 처리됩니다.",
    ],
    bullets: [
      "인증 세션 및 토큰: 로그아웃 시 해당 세션을 즉시 폐기하여 액세스 토큰과 리프레시 토큰을 더 이상 사용할 수 없게 합니다. 세션 행과 리프레시 토큰 해시는 로그아웃만으로 삭제되지 않습니다. 세션은 로그인한 시점부터 7일 뒤 만료되며, 리프레시 토큰을 회전해도 이 만료 시각은 연장되지 않습니다.",
      "아바타 이미지: 사용자가 새 아바타로 교체하거나 기본 이미지로 삭제(DELETE /api/users/me/avatar)할 때, 그리고 회원 탈퇴 시 서버 저장소에서 이전 이미지 파일의 삭제를 시도합니다. 파일 삭제는 계정 정보 변경이 확정된 직후 수행되며, 삭제에 실패하더라도 교체·삭제·탈퇴 처리 자체는 완료됩니다. 파일 삭제에 실패하면 이전 이미지 파일이 저장소에 남아 기존 URL로 조회될 수 있습니다.",
      "회원 탈퇴(DELETE /api/users/me) 요청 조건: 내 프로필에서 본인 확인 후 요청합니다. 비밀번호 계정은 비밀번호, 비밀번호가 없는 42 계정은 2단계 인증 코드(복구 코드 포함)로 확인하며, 2단계 인증도 쓰지 않으면 최근 10분 안에 로그인한 경우에만 가능합니다. 진행 중이거나 대기 중인 경기가 있으면 탈퇴할 수 없으며, 경기를 마친 뒤 다시 요청해야 합니다.",
      "회원 탈퇴 시 즉시 처리: 모든 기기의 로그인 세션이 폐기되고 리프레시 토큰이 삭제되며, 비밀번호 해시, 42 OAuth 연동 정보와 인증 상태 토큰, 2FA 비밀키·복구 코드·로그인 확인 정보, 친구 관계가 삭제됩니다. 이메일과 닉네임은 비식별 값으로 교체되고 아바타 이미지 참조가 지워지므로 기존 이메일·닉네임을 다시 사용할 수 있습니다. 탈퇴한 계정은 리더보드에서 제외되고 프로필·통계·전적 조회가 불가능합니다. 폐기된 세션은 사용자 번호와 세션 식별자, 생성·만료·폐기 시각을 가진 행으로 남습니다.",
      '탈퇴 후 보존되는 정보: 상대방의 전적·통계 무결성을 위해 대국 기록(경기 결과, 착수·명령 기록)과 경기 당시 닉네임은 보존되며 삭제 기한을 두지 않습니다. 대국 기록은 탈퇴 처리된 사용자 행을 계속 참조합니다. 상대방의 전적에는 경기 당시 닉네임 뒤에 "(탈퇴한 사용자)"가 붙어 표시되며 프로필 링크는 제공되지 않습니다.',
    ],
  },
  {
    id: "privacy-contact",
    title: "5. 개인정보 문의",
    paragraphs: [
      "개인정보 처리에 관한 문의는 yunhpark@student.42gyeongsan.kr 로 메일을 보내 주세요.",
    ],
  },
];

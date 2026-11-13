import { describe, expect, it } from "vitest";
import {
  PRIVACY_POLICY_SECTIONS,
  TERMS_OF_SERVICE_SECTIONS,
  parseAppRoute,
  resolvePathForScreen,
} from "./legal-routing.ts";

describe("legal-routing and policy content (Issue #64)", () => {
  it("parses public legal routes (/terms, /privacy) and hash links (#terms, #privacy)", () => {
    expect(parseAppRoute("/terms")).toEqual({ kind: "terms" });
    expect(parseAppRoute("/terms/")).toEqual({ kind: "terms" });
    expect(parseAppRoute("/privacy")).toEqual({ kind: "privacy" });
    expect(parseAppRoute("/privacy/")).toEqual({ kind: "privacy" });
    expect(parseAppRoute("/login", "", "#terms")).toEqual({ kind: "terms" });
    expect(parseAppRoute("/signup", "", "#privacy")).toEqual({
      kind: "privacy",
    });
  });

  it("parses auth, lobby, matchmaking, match, profile, and leaderboard routes", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "lobby" });
    expect(parseAppRoute("/login")).toEqual({ kind: "login" });
    expect(parseAppRoute("/signup")).toEqual({ kind: "register" });
    expect(parseAppRoute("/register")).toEqual({ kind: "register" });
    expect(parseAppRoute("/login/2fa")).toEqual({ kind: "twoFactor" });
    expect(parseAppRoute("/oauth/42/callback", "?code=abc&state=xyz")).toEqual({
      kind: "oauthCallback",
      code: "abc",
      state: "xyz",
      error: null,
    });
    expect(parseAppRoute("/matching")).toEqual({ kind: "matchmaking" });
    expect(parseAppRoute("/match/42")).toEqual({ kind: "match", matchId: 42 });
    expect(parseAppRoute("/", "?matchId=7")).toEqual({
      kind: "match",
      matchId: 7,
    });
    expect(parseAppRoute("/me")).toEqual({ kind: "myProfile" });
    expect(parseAppRoute("/users/15")).toEqual({
      kind: "userProfile",
      userId: 15,
    });
    expect(parseAppRoute("/leaderboard")).toEqual({ kind: "leaderboard" });
    expect(parseAppRoute("/friends")).toEqual({ kind: "friends" });
    expect(parseAppRoute("/friends/")).toEqual({ kind: "friends" });
  });

  it("returns notFound route for unknown paths or invalid IDs", () => {
    expect(parseAppRoute("/unknown-route")).toEqual({
      kind: "notFound",
      pathname: "/unknown-route",
    });
    expect(parseAppRoute("/match/0")).toEqual({
      kind: "notFound",
      pathname: "/match/0",
    });
    expect(parseAppRoute("/users/0")).toEqual({
      kind: "notFound",
      pathname: "/users/0",
    });
  });

  it("resolves canonical paths for each ScreenView", () => {
    expect(resolvePathForScreen({ view: "terms" })).toBe("/terms");
    expect(resolvePathForScreen({ view: "privacy" })).toBe("/privacy");
    expect(resolvePathForScreen({ view: "login" })).toBe("/login");
    expect(resolvePathForScreen({ view: "register" })).toBe("/signup");
    expect(resolvePathForScreen({ view: "twoFactor" })).toBe("/login/2fa");
    expect(resolvePathForScreen({ view: "lobby" })).toBe("/");
    expect(resolvePathForScreen({ view: "matchmaking" })).toBe("/matching");
    expect(resolvePathForScreen({ view: "gomoku", matchId: 12 })).toBe(
      "/match/12",
    );
    expect(
      resolvePathForScreen({
        view: "profile",
        profileUserId: 5,
        currentUserId: 5,
      }),
    ).toBe("/me");
    expect(
      resolvePathForScreen({
        view: "profile",
        profileUserId: 9,
        currentUserId: 5,
      }),
    ).toBe("/users/9");
    expect(resolvePathForScreen({ view: "leaderboard" })).toBe("/leaderboard");
    expect(resolvePathForScreen({ view: "friends" })).toBe("/friends");
    expect(resolvePathForScreen({ view: "notFound" })).toBeNull();
  });

  it("includes required actual collection, security, and retention disclosures in privacy and terms", () => {
    const termsText = JSON.stringify(TERMS_OF_SERVICE_SECTIONS);
    const privacyText = JSON.stringify(PRIVACY_POLICY_SECTIONS);

    expect(termsText).toContain("15×15");
    expect(termsText).toContain("60초");
    expect(termsText).toContain("Server-Authoritative");

    expect(privacyText).toContain("Argon2id");
    expect(privacyText).toContain("AES-256-GCM");
    expect(privacyText).toContain("2 MiB");
    expect(privacyText).toContain("1024×1024px");
    expect(privacyText).toContain("회원 탈퇴");
  });

  it("describes account withdrawal the way DELETE /api/users/me behaves (#89, #85)", () => {
    const retention = PRIVACY_POLICY_SECTIONS.find(
      (section) => section.id === "privacy-retention",
    );
    const text = (retention?.bullets ?? []).join("\n");

    // 요청 조건: 본인 확인 방법 3가지와 진행 중 경기 거절 (account-service.deleteAccount)
    expect(text).toContain("비밀번호 계정은 비밀번호");
    expect(text).toContain("복구 코드 포함");
    expect(text).toContain("최근 10분 안에 로그인");
    expect(text).toContain(
      "진행 중이거나 대기 중인 경기가 있으면 탈퇴할 수 없으며",
    );
    // 삭제: 한 트랜잭션에서 지우는 항목 (account-repository.anonymizeUser)
    for (const deleted of [
      "리프레시 토큰이 삭제",
      "비밀번호 해시",
      "42 OAuth 연동 정보",
      "2FA 비밀키·복구 코드",
      "비식별 값으로 교체",
      "아바타 이미지 참조",
    ]) {
      expect(text).toContain(deleted);
    }
    expect(text).toContain("리더보드에서 제외");
    // 보존: games·game_players·moves(·game_commands)와 경기 당시 닉네임
    expect(text).toContain("대국 기록(경기 결과, 착수·명령 기록)");
    expect(text).toContain("경기 당시 닉네임");
    expect(text).toContain('"(탈퇴한 사용자)"');
    // 서버는 탈퇴한 사용자 기록에 보존 기한을 두지 않으므로 기한을 약속하지 않는다.
    expect(text).not.toMatch(/\d+\s*(일|개월|년)\s*(후|뒤|동안)\s*(삭제|파기)/);
  });

  it("gives a real contact address in the privacy policy", () => {
    const contact = PRIVACY_POLICY_SECTIONS.find(
      (section) => section.id === "privacy-contact",
    );
    expect(JSON.stringify(contact)).toContain(
      "yunhpark@student.42gyeongsan.kr",
    );
  });
});

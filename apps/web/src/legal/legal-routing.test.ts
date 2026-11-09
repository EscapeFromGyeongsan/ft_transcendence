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
});

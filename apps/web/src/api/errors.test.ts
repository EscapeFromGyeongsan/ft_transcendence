import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi, setAuthFailureHandler } from "./auth-client.ts";
import {
  ApiError,
  getErrorMessage,
  getOAuthStartErrorMessage,
  isTransientError,
} from "./errors.ts";

describe("isTransientError", () => {
  it("429·5xx와 네트워크 실패는 세션을 유지하는 오류로 본다", () => {
    expect(isTransientError(new ApiError(429, "RATE_LIMITED", ""))).toBe(true);
    expect(isTransientError(new ApiError(503, "SERVICE_UNAVAILABLE", ""))).toBe(
      true,
    );
    expect(isTransientError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("401 같은 거절은 세션을 끝내는 오류로 본다", () => {
    expect(isTransientError(new ApiError(401, "UNAUTHENTICATED", ""))).toBe(
      false,
    );
    expect(isTransientError(new Error("other"))).toBe(false);
  });
});

describe("getOAuthStartErrorMessage", () => {
  it("42 로그인 시작의 503은 DB 장애가 아니라 42 로그인 문구로 보여 준다", () => {
    const error = new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "42 login is not configured.",
    );
    expect(getOAuthStartErrorMessage(error)).toMatch(
      /42 로그인을 사용할 수 없/,
    );
    expect(getOAuthStartErrorMessage(error)).not.toBe(getErrorMessage(error));
  });

  it("그 밖의 오류는 공통 문구와 같다", () => {
    const error = new ApiError(429, "RATE_LIMITED", "");
    expect(getOAuthStartErrorMessage(error)).toBe(getErrorMessage(error));
  });
});

describe("setAuthFailureHandler", () => {
  afterEach(() => {
    setAuthFailureHandler(undefined);
    vi.unstubAllGlobals();
  });

  it("기본 authApi의 refresh가 거절되면 등록한 함수를 부른다", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { code: "UNAUTHENTICATED", message: "Revoked" } },
            { status: 401 },
          ),
        ),
    );
    const handler = vi.fn();
    setAuthFailureHandler(handler);
    await expect(authApi.refresh("stale-refresh-token")).rejects.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("네트워크 실패에서는 부르지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const handler = vi.fn();
    setAuthFailureHandler(handler);
    await expect(authApi.refresh("refresh-token")).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

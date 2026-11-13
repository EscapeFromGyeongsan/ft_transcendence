import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("AT-17: 탈퇴한 사용자는 친구 목록과 새 요청 대상에서 제외된다", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "서버 결합 계약 검증");
  const accounts = [];
  for (const prefix of ["depart88", "remain88"]) {
    const nickname = `${prefix}_${randomUUID().slice(0, 8)}`;
    const credentials = {
      nickname,
      email: `${nickname}@example.test`,
      password: `Test-${randomUUID()}`,
    };
    const registered = await request.post("/api/auth/register", {
      data: credentials,
    });
    expect(registered.status()).toBe(201);
    const { id } = await registered.json();
    const login = await request.post("/api/auth/login", {
      data: { email: credentials.email, password: credentials.password },
    });
    expect(login.status()).toBe(200);
    const { accessToken } = await login.json();
    accounts.push({
      id,
      password: credentials.password,
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }
  const [departing, remaining] = accounts;
  const created = await request.post("/api/friends/requests", {
    headers: departing.headers,
    data: { userId: remaining.id },
  });
  expect(created.status()).toBe(201);
  const { requestId } = await created.json();
  const accepted = await request.post(
    `/api/friends/requests/${requestId}/accept`,
    { headers: remaining.headers },
  );
  expect(accepted.status()).toBe(200);
  const deleted = await request.delete("/api/users/me", {
    headers: departing.headers,
    data: { password: departing.password },
  });
  expect(deleted.status()).toBe(204);
  const friendsResponse = await request.get("/api/friends", {
    headers: remaining.headers,
  });
  expect(friendsResponse.status()).toBe(200);
  const friends = await friendsResponse.json();
  const newRequest = await request.post("/api/friends/requests", {
    headers: remaining.headers,
    data: { userId: departing.id },
  });
  const newRequestBody = await newRequest.json();
  const removed = await request.delete(`/api/friends/${departing.id}`, {
    headers: remaining.headers,
  });
  expect(removed.status()).toBe(404);
  const freshRequest = await request.post("/api/friends/requests", {
    headers: remaining.headers,
    data: { userId: departing.id },
  });
  const freshRequestBody = await freshRequest.json();
  await testInfo.attach("deleted-friend-contract.json", {
    body: JSON.stringify({
      departingUserId: departing.id,
      remainingUserId: remaining.id,
      deletionStatus: deleted.status(),
      friends,
      newRequestStatus: newRequest.status(),
      newRequestCode: newRequestBody.error?.code,
      removeFriendStatus: removed.status(),
      freshRequestStatus: freshRequest.status(),
      freshRequestCode: freshRequestBody.error?.code ?? null,
    }),
    contentType: "application/json",
  });
  expect
    .soft(friends.friends.map((friend: { userId: number }) => friend.userId))
    .not.toContain(departing.id);
  expect.soft(newRequest.status()).toBe(404);
  expect.soft(newRequestBody.error?.code).toBe("USER_NOT_FOUND");
  expect.soft(freshRequest.status()).toBe(404);
  expect.soft(freshRequestBody.error?.code).toBe("USER_NOT_FOUND");
});

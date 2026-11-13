import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import type { FriendError, FriendService } from "../services/friend-service.ts";
import {
  bodyErrorResponses,
  errorBody,
  errorSchema,
  parseErrorResponses,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import { createRequireAuth } from "./auth-routes.ts";

const safeId = {
  type: "integer",
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
};
const params = (field: string) => ({
  type: "object",
  properties: { [field]: safeId },
  required: [field],
  additionalProperties: false,
});
const person = {
  type: "object",
  properties: {
    userId: safeId,
    nickname: { type: "string" },
    avatarUrl: { type: ["string", "null"] },
  },
  required: ["userId", "nickname", "avatarUrl"],
};
const searched = {
  type: "object",
  properties: {
    id: safeId,
    nickname: { type: "string" },
    avatarUrl: { type: ["string", "null"] },
  },
  required: ["id", "nickname", "avatarUrl"],
};
const pendingItem = {
  ...person,
  properties: {
    ...person.properties,
    requestId: safeId,
    createdAt: { type: "string", format: "date-time" },
  },
  required: [...person.required, "requestId", "createdAt"],
};
const acceptedItem = {
  ...person,
  properties: { ...person.properties, online: { type: "boolean" } },
  required: [...person.required, "online"],
};
const resultSchema = {
  ...person,
  properties: {
    ...person.properties,
    requestId: safeId,
    status: { type: "string", enum: ["pending", "accepted"] },
  },
  required: [...person.required, "requestId", "status"],
};
const noBody = { description: "성공 (본문 없음)", type: "null" };
const requiresAuth = {
  tags: ["friends"],
  security: [{ bearerAuth: [] }],
};
const mutationErrors = {
  ...bodyErrorResponses,
  401: unauthenticatedResponse,
  429: rateLimitResponse,
  ...serverErrorResponses,
};
const readErrors = {
  401: unauthenticatedResponse,
  429: rateLimitResponse,
  ...serverErrorResponses,
};
const friendRateLimit = { rateLimit: { max: 30, timeWindow: "1 minute" } };

const friendError = (code: FriendError) => {
  const status =
    code === "USER_NOT_FOUND" || code === "NOT_FOUND"
      ? 404
      : code === "FORBIDDEN"
        ? 403
        : 409;
  const message: Record<FriendError, string> = {
    USER_NOT_FOUND: "User not found.",
    NOT_FOUND: "Friend request or friendship not found.",
    FORBIDDEN: "Only the recipient can respond to this request.",
    REQUEST_NOT_PENDING: "Friend request is no longer pending.",
    ALREADY_FRIENDS: "Users are already friends.",
    REQUEST_PENDING: "Friend request is already pending.",
    REQUEST_DECLINED: "You cannot resend a declined friend request.",
    FRIEND_REQUEST_CONFLICT: "Friend relationship changed concurrently.",
  };
  return { status, body: errorBody(code, message[code]) };
};

/**
 * 인증된 사용자만 친구 목록·검색·요청 변경에 접근하는 REST 경로를 등록합니다.
 *
 * @remarks
 * 변경 API는 PostgreSQL 커밋 후 응답합니다. 친구 관계 변경 WebSocket 알림과
 * 인증 연결 기준 온라인 상태는 D의 #82 통합 이후 연결합니다.
 */
export function registerFriendRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getFriends: () => FriendService,
) {
  const onRequest = createRequireAuth(getAuth);

  app.get<{ Querystring: { nickname: string } }>(
    "/api/users",
    {
      onRequest,
      config: friendRateLimit,
      schema: {
        ...requiresAuth,
        summary: "닉네임 접두사 사용자 검색",
        querystring: {
          type: "object",
          properties: {
            nickname: { type: "string", minLength: 1, maxLength: 32 },
          },
          required: ["nickname"],
          additionalProperties: false,
        },
        response: {
          200: {
            description: "검색 결과 최대 20명",
            type: "array",
            items: searched,
          },
          ...readErrors,
          422: bodyErrorResponses[422],
        },
      },
    },
    async (request) =>
      getFriends().searchUsers(request.auth!.userId, request.query.nickname),
  );

  app.get(
    "/api/friends",
    {
      onRequest,
      schema: {
        ...requiresAuth,
        summary: "친구·받은 요청·보낸 요청 조회",
        response: {
          200: {
            description: "친구와 받은 요청·보낸 요청 목록",
            type: "object",
            properties: {
              friends: { type: "array", items: acceptedItem },
              incoming: { type: "array", items: pendingItem },
              outgoing: { type: "array", items: pendingItem },
            },
            required: ["friends", "incoming", "outgoing"],
          },
          401: unauthenticatedResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request) => getFriends().getFriends(request.auth!.userId),
  );

  app.post<{ Body: { userId: number } }>(
    "/api/friends/requests",
    {
      onRequest,
      config: friendRateLimit,
      schema: {
        ...requiresAuth,
        summary: "친구 요청 또는 상대 요청 수락",
        body: {
          type: "object",
          properties: { userId: safeId },
          required: ["userId"],
          additionalProperties: false,
        },
        response: {
          200: { description: "맞요청 수락", ...resultSchema },
          201: { description: "새 친구 요청", ...resultSchema },
          ...mutationErrors,
          404: errorSchema("요청 대상 없음", ["USER_NOT_FOUND"]),
          409: errorSchema("이미 친구·요청 중·거절·경합", [
            "ALREADY_FRIENDS",
            "REQUEST_PENDING",
            "REQUEST_DECLINED",
            "FRIEND_REQUEST_CONFLICT",
          ]),
        },
      },
    },
    async (request, reply) => {
      if (request.body.userId === request.auth!.userId)
        return reply
          .code(422)
          .send(errorBody("VALIDATION_ERROR", "Cannot add yourself."));
      const result = await getFriends().requestFriend(
        request.auth!.userId,
        request.body.userId,
      );
      if (result.ok) return reply.code(result.status).send(result.result);
      const error = friendError(result.code);
      return reply.code(error.status).send(error.body);
    },
  );

  app.post<{ Params: { requestId: number } }>(
    "/api/friends/requests/:requestId/accept",
    {
      onRequest,
      config: friendRateLimit,
      schema: {
        ...requiresAuth,
        summary: "받은 친구 요청 수락",
        params: params("requestId"),
        response: {
          200: { description: "수락 완료", ...resultSchema },
          ...mutationErrors,
          403: errorSchema("발신자는 자신의 요청을 수락할 수 없음", [
            "FORBIDDEN",
          ]),
          404: errorSchema("요청 없음", ["NOT_FOUND"]),
          409: errorSchema("이미 처리된 요청", ["REQUEST_NOT_PENDING"]),
        },
      },
    },
    async (request, reply) => {
      const result = await getFriends().decide(
        request.auth!.userId,
        request.params.requestId,
        "accept",
      );
      if (result.ok) return result.result;
      const error = friendError(result.code);
      return reply.code(error.status).send(error.body);
    },
  );

  app.post<{ Params: { requestId: number } }>(
    "/api/friends/requests/:requestId/decline",
    {
      onRequest,
      config: friendRateLimit,
      schema: {
        ...requiresAuth,
        summary: "받은 친구 요청 거절",
        params: params("requestId"),
        response: {
          204: noBody,
          ...mutationErrors,
          403: errorSchema("발신자는 자신의 요청을 거절할 수 없음", [
            "FORBIDDEN",
          ]),
          404: errorSchema("요청 없음", ["NOT_FOUND"]),
          409: errorSchema("이미 처리된 요청", ["REQUEST_NOT_PENDING"]),
        },
      },
    },
    async (request, reply) => {
      const result = await getFriends().decide(
        request.auth!.userId,
        request.params.requestId,
        "decline",
      );
      if (result.ok) return reply.code(204).send();
      const error = friendError(result.code);
      return reply.code(error.status).send(error.body);
    },
  );

  app.delete<{ Params: { userId: number } }>(
    "/api/friends/:userId",
    {
      onRequest,
      config: friendRateLimit,
      schema: {
        ...requiresAuth,
        summary: "수락된 친구 관계 삭제",
        params: params("userId"),
        response: {
          204: noBody,
          ...parseErrorResponses,
          401: unauthenticatedResponse,
          404: errorSchema("수락된 친구 관계 없음", ["NOT_FOUND"]),
          422: bodyErrorResponses[422],
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await getFriends().removeFriend(
        request.auth!.userId,
        request.params.userId,
      );
      if (result.ok) return reply.code(204).send();
      return reply
        .code(404)
        .send(errorBody("NOT_FOUND", "Friendship not found."));
    },
  );
}

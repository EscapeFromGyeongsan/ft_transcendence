import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import type { ChatService } from "../services/chat-service.ts";
import {
  bodyErrorResponses,
  errorBody,
  errorSchema,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import { createRequireAuth } from "./auth-routes.ts";

const id = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const date = { type: "string", format: "date-time" };
const message = {
  type: "object",
  properties: { id, senderId: id, text: { type: "string" }, createdAt: date },
  required: ["id", "senderId", "text", "createdAt"],
};
const params = {
  type: "object",
  properties: { peerId: id },
  required: ["peerId"],
};
const unavailable = errorSchema("수락된 친구 대화 없음", ["NOT_FOUND"]);
const authErrors = { 401: unauthenticatedResponse, ...serverErrorResponses };
const options = { tags: ["chat"], security: [{ bearerAuth: [] }] };

function noConversation() {
  return errorBody("NOT_FOUND", "Conversation not found.");
}

/** 인증된 친구 채팅 REST 경로를 등록합니다. 새 메시지 알림은 저장 후 보냅니다. */
export function registerChatRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getChat: () => ChatService,
  notify: (userId: number, peerId: number) => void,
) {
  const onRequest = createRequireAuth(getAuth);

  app.get(
    "/api/chat/conversations",
    {
      onRequest,
      schema: {
        ...options,
        summary: "친구 대화 목록 조회",
        response: {
          200: {
            description: "최근 메시지 순으로 정렬된 친구 목록",
            type: "array",
            items: {
              type: "object",
              properties: {
                friendshipId: id,
                userId: id,
                nickname: { type: "string" },
                lastMessageAt: { anyOf: [date, { type: "null" }] },
              },
              required: ["friendshipId", "userId", "nickname", "lastMessageAt"],
            },
          },
          ...authErrors,
        },
      },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      return getChat().list(request.auth!.userId);
    },
  );

  app.get<{ Params: { peerId: number }; Querystring: { before?: number } }>(
    "/api/chat/conversations/:peerId/messages",
    {
      onRequest,
      schema: {
        ...options,
        summary: "친구 대화 메시지 조회",
        params,
        querystring: {
          type: "object",
          properties: { before: id },
          additionalProperties: false,
        },
        response: {
          200: {
            description: "대화 메시지와 이전 페이지 커서",
            type: "object",
            properties: {
              messages: { type: "array", items: message },
              nextBefore: { type: ["integer", "null"] },
            },
            required: ["messages", "nextBefore"],
          },
          404: unavailable,
          422: bodyErrorResponses[422],
          ...authErrors,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const history = await getChat().history(
        request.auth!.userId,
        request.params.peerId,
        request.query.before,
      );
      return history ?? reply.code(404).send(noConversation());
    },
  );

  app.post<{
    Params: { peerId: number };
    Body: { text: string; clientId: string };
  }>(
    "/api/chat/conversations/:peerId/messages",
    {
      onRequest,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) =>
            request.auth?.userId.toString() ?? request.ip,
        },
      },
      schema: {
        ...options,
        summary: "친구에게 채팅 메시지 전송",
        params,
        body: {
          type: "object",
          properties: {
            text: { type: "string", minLength: 1, maxLength: 1000 },
            clientId: { type: "string", format: "uuid" },
          },
          required: ["text", "clientId"],
          additionalProperties: false,
        },
        response: {
          200: { ...message, description: "이미 저장된 메시지" },
          201: { ...message, description: "새로 저장된 메시지" },
          404: unavailable,
          429: rateLimitResponse,
          ...bodyErrorResponses,
          ...authErrors,
        },
      },
    },
    async (request, reply) => {
      const userId = request.auth!.userId;
      const { peerId } = request.params;
      const text = request.body.text.trim();
      if (!text || text.includes("\0")) {
        return reply
          .code(422)
          .send(errorBody("VALIDATION_ERROR", "Enter valid message text."));
      }
      const result = await getChat().send(
        userId,
        peerId,
        text,
        request.body.clientId,
      );
      if (!result) return reply.code(404).send(noConversation());
      if (result.created) notify(userId, peerId);
      return reply.code(result.created ? 201 : 200).send(result.message);
    },
  );
}

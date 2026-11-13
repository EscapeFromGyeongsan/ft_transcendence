import type { FastifyInstance } from "fastify";
import type { AuthService } from "../services/auth-service.ts";
import {
  avatarMaxBytes,
  avatarMaxSide,
  type AvatarService,
} from "../services/avatar-service.ts";
import {
  errorBody,
  errorSchema,
  rateLimitResponse,
  serverErrorResponses,
  unauthenticatedResponse,
} from "../schemas/errors.ts";
import { createRequireAuth, userSchema } from "./auth-routes.ts";

const uploadRateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

const signedOut = () =>
  errorBody("UNAUTHENTICATED", "Authentication required.");

/**
 * 아바타 업로드·삭제·파일 제공 route를 등록합니다.
 *
 * @remarks 서비스 getter가 설정 없음으로 {@link ServiceUnavailableError}를 던지면 503이 됩니다.
 */
export function registerAvatarRoutes(
  app: FastifyInstance,
  getAuth: () => AuthService,
  getAvatars: () => AvatarService,
) {
  const requireAuth = createRequireAuth(getAuth);

  app.put(
    "/api/users/me/avatar",
    {
      onRequest: requireAuth,
      config: uploadRateLimit,
      schema: {
        tags: ["users"],
        summary: "내 아바타 업로드·교체",
        description: `multipart/form-data의 \`file\` 필드 하나. PNG 또는 JPEG, ${avatarMaxBytes / 1024 / 1024} MiB 이하, 가로·세로 ${avatarMaxSide}px 이하. 형식은 파일 내용으로 확인합니다. 실패하면 기존 아바타가 유지됩니다.`,
        consumes: ["multipart/form-data"],
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: "업로드 성공, 갱신된 내 정보", ...userSchema },
          400: errorSchema("multipart 본문을 해석할 수 없음", ["BAD_REQUEST"]),
          401: unauthenticatedResponse,
          413: errorSchema(
            `파일 크기 ${avatarMaxBytes / 1024 / 1024} MiB 초과`,
            ["PAYLOAD_TOO_LARGE"],
          ),
          415: errorSchema("multipart가 아니거나 PNG·JPEG 파일이 아님", [
            "UNSUPPORTED_MEDIA_TYPE",
          ]),
          422: errorSchema(
            `file 필드 없음, 또는 이미지가 ${avatarMaxSide}px 초과`,
            ["VALIDATION_ERROR", "IMAGE_TOO_BIG"],
          ),
          429: rateLimitResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply
          .code(415)
          .send(
            errorBody(
              "UNSUPPORTED_MEDIA_TYPE",
              "Use multipart/form-data with a PNG or JPEG file.",
            ),
          );
      }
      let data: Buffer | undefined;
      try {
        const file = await request.file();
        if (file?.fieldname === "file") data = await file.toBuffer();
      } catch (error) {
        // Size limit goes to the shared 413 handler; other parse errors are 400.
        if ((error as { statusCode?: unknown }).statusCode === 413) throw error;
        return reply
          .code(400)
          .send(errorBody("BAD_REQUEST", "Malformed multipart body."));
      }
      if (!data) {
        return reply
          .code(422)
          .send(
            errorBody("VALIDATION_ERROR", "Send one file in field 'file'."),
          );
      }

      const result = await getAvatars().save(request.auth!.userId, data);
      if (result.ok) return result.user;
      if (result.code === "NOT_FOUND") return reply.code(401).send(signedOut());
      if (result.code === "UNSUPPORTED_IMAGE") {
        return reply
          .code(415)
          .send(
            errorBody(
              "UNSUPPORTED_MEDIA_TYPE",
              "The file is not a PNG or JPEG.",
            ),
          );
      }
      return reply
        .code(422)
        .send(
          errorBody(
            "IMAGE_TOO_BIG",
            `Image must be at most ${avatarMaxSide}x${avatarMaxSide} pixels.`,
          ),
        );
    },
  );

  app.delete(
    "/api/users/me/avatar",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["users"],
        summary: "내 아바타 삭제 (기본 이미지로)",
        security: [{ bearerAuth: [] }],
        response: {
          204: { description: "삭제 성공. 아바타가 없어도 204", type: "null" },
          401: unauthenticatedResponse,
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      if (!(await getAvatars().remove(request.auth!.userId))) {
        return reply.code(401).send(signedOut());
      }
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { name: string } }>(
    "/api/media/avatars/:name",
    {
      schema: {
        tags: ["users"],
        summary: "아바타 이미지 파일",
        description:
          "`avatarUrl`이 가리키는 파일. 인증 없이 `<img>`로 읽습니다. 파일 이름은 매번 새로 만들어지므로 오래 캐시합니다.",
        response: {
          200: {
            description: "image/png 또는 image/jpeg",
            type: "string",
            format: "binary",
          },
          404: errorSchema("없는 파일", ["NOT_FOUND"]),
          422: errorSchema("100자 초과·잘못된 % 인코딩 파일 이름", [
            "VALIDATION_ERROR",
          ]),
          ...serverErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const file = await getAvatars().read(request.params.name);
      if (!file) {
        return reply.code(404).send(errorBody("NOT_FOUND", "File not found."));
      }
      return reply
        .header("content-type", file.contentType)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(file.data);
    },
  );
}

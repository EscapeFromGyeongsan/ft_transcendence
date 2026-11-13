import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { jpegHeader, pngHeader } from "../core/image.test.ts";
import {
  openTestDatabase,
  resetTestDatabase,
  testDatabaseUrl,
} from "../test-support/database.ts";

const jwtSecret = "test-secret-test-secret-test-secret";
const boundary = "avatar-test-boundary";

function multipart(data: Buffer, field = "file", filename = "a.png") {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

test("avatar routes declare every status code in Swagger", async () => {
  const app = await buildApp();
  const paths = (await app.inject({ method: "GET", url: "/docs/json" })).json()
    .paths;
  await app.close();
  const codes = (route: { responses: object }) =>
    Object.keys(route.responses).sort();
  expect(codes(paths["/api/users/me/avatar"].put)).toEqual([
    "200",
    "400",
    "401",
    "413",
    "415",
    "422",
    "429",
    "500",
    "503",
  ]);
  expect(codes(paths["/api/users/me/avatar"].delete)).toEqual([
    "204",
    "400",
    "401",
    "413",
    "415",
    "500",
    "503",
  ]);
  expect(codes(paths["/api/media/avatars/{name}"].get)).toEqual([
    "200",
    "404",
    "500",
    "503",
  ]);
});

describe.skipIf(!testDatabaseUrl)("avatar upload with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof openTestDatabase>>;
  let app: FastifyInstance;
  let token: string;
  let avatarDir: string;

  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await app?.close();
    await database?.close();
    if (avatarDir) await rm(avatarDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await resetTestDatabase(database);
    await app?.close();
    if (avatarDir) await rm(avatarDir, { recursive: true, force: true });
    avatarDir = await mkdtemp(join(tmpdir(), "avatars-"));
    app = await buildApp({}, testDatabaseUrl, { jwtSecret }, avatarDir);
    await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "p1@example.com",
        password: "password-123",
        nickname: "p1",
      },
    });
    token = (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "p1@example.com", password: "password-123" },
      })
    ).json().accessToken;
  });

  const upload = (body: Buffer, auth = true) =>
    app.inject({
      method: "PUT",
      url: "/api/users/me/avatar",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      payload: body,
    });
  const me = async () =>
    (
      await app.inject({
        method: "GET",
        url: "/api/users/me",
        headers: { authorization: `Bearer ${token}` },
      })
    ).json();
  const fetchFile = (url: string) => app.inject({ method: "GET", url });

  test("upload stores the file, serves it, and replaces the previous one", async () => {
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/users/me",
          headers: { authorization: `Bearer ${token}` },
          payload: { recordsPublic: false },
        })
      ).statusCode,
    ).toBe(200);
    const png = pngHeader(64, 64);
    const first = await upload(multipart(png));
    expect(first.statusCode).toBe(200);
    expect(first.json().recordsPublic).toBe(false);
    const firstUrl: string = first.json().avatarUrl;
    expect(firstUrl).toMatch(/^\/api\/media\/avatars\/1-[0-9a-f]{16}\.png$/);
    expect((await me()).avatarUrl).toBe(firstUrl);

    const served = await fetchFile(firstUrl);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.rawPayload.equals(png)).toBe(true);

    const second = await upload(
      multipart(jpegHeader(100, 80), "file", "b.jpg"),
    );
    expect(second.statusCode).toBe(200);
    expect(second.json().recordsPublic).toBe(false);
    const secondUrl: string = second.json().avatarUrl;
    expect(secondUrl).toMatch(/\.jpg$/);
    expect((await fetchFile(secondUrl)).headers["content-type"]).toBe(
      "image/jpeg",
    );
    expect((await fetchFile(firstUrl)).statusCode).toBe(404);
    expect(await readdir(avatarDir)).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/users/me/avatar",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(204);
    expect((await me()).recordsPublic).toBe(false);
  });

  test("format, size and field problems keep the current avatar", async () => {
    const current = (await upload(multipart(pngHeader(10, 10)))).json()
      .avatarUrl;

    const fake = await upload(multipart(Buffer.from("<svg onload=x>")));
    expect(fake.statusCode).toBe(415);
    expect(fake.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const huge = await upload(multipart(pngHeader(1025, 10)));
    expect(huge.statusCode).toBe(422);
    expect(huge.json().error.code).toBe("IMAGE_TOO_BIG");

    const heavy = Buffer.concat([
      pngHeader(10, 10),
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    const tooLarge = await upload(multipart(heavy));
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe("PAYLOAD_TOO_LARGE");

    const wrongField = await upload(multipart(pngHeader(10, 10), "image"));
    expect(wrongField.statusCode).toBe(422);
    expect(wrongField.json().error.code).toBe("VALIDATION_ERROR");

    const json = await app.inject({
      method: "PUT",
      url: "/api/users/me/avatar",
      headers: { authorization: `Bearer ${token}` },
      payload: { file: "x" },
    });
    expect(json.statusCode).toBe(415);

    expect((await me()).avatarUrl).toBe(current);
    expect(await readdir(avatarDir)).toHaveLength(1);
  });

  test("authentication is checked before the upload is read", async () => {
    const response = await upload(multipart(pngHeader(10, 10)), false);
    expect(response.statusCode).toBe(401);
    expect(await readdir(avatarDir)).toHaveLength(0);
  });

  test("delete clears the avatar and its file; repeating is still 204", async () => {
    const url = (await upload(multipart(pngHeader(10, 10)))).json().avatarUrl;
    const remove = () =>
      app.inject({
        method: "DELETE",
        url: "/api/users/me/avatar",
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await remove()).statusCode).toBe(204);
    expect((await me()).avatarUrl).toBeNull();
    expect((await fetchFile(url)).statusCode).toBe(404);
    expect((await remove()).statusCode).toBe(204);
  });

  test("only generated file names are served", async () => {
    for (const name of ["..%2F..%2Fetc%2Fpasswd", "x.png", "1-zz.png"]) {
      expect((await fetchFile(`/api/media/avatars/${name}`)).statusCode).toBe(
        404,
      );
    }
  });
});

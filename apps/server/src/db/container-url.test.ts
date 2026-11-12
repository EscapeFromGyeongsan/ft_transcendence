import { expect, test } from "vitest";
import { createContainerDatabaseUrl } from "./container-url.ts";

test("container connection uses the DB service and internal port", () => {
  expect(createContainerDatabaseUrl("cafe", "cafe_full", "test-password")).toBe(
    "postgresql://cafe:test-password@db:5432/cafe_full",
  );
});

test("URL-reserved characters and dollar signs survive password-file loading", () => {
  expect(
    createContainerDatabaseUrl("user@name", "db/name", "p@ss:/?#%$ word\r\n"),
  ).toBe(
    "postgresql://user%40name:p%40ss%3A%2F%3F%23%25%24%20word@db:5432/db%2Fname",
  );
});

test("one trailing newline is removed without removing password spaces", () => {
  expect(createContainerDatabaseUrl("cafe", "db", " password \n")).toBe(
    "postgresql://cafe:%20password%20@db:5432/db",
  );
});

test.each(["", "\n", "line1\nline2", "line1\rline2", "password\n\n", "\0"])(
  "empty or multiline password file %j is rejected",
  (contents) => {
    expect(() => createContainerDatabaseUrl("cafe", "db", contents)).toThrow(
      /password file/,
    );
  },
);

test.each([
  ["", "db"],
  ["cafe", ""],
])("missing database initialization setting is rejected", (user, database) => {
  expect(() => createContainerDatabaseUrl(user, database, "test-password")).toThrow(
    /POSTGRES_USER and POSTGRES_DB/,
  );
});

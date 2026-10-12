# Issue #7 validation record

- Date: 2026-10-12 (Asia/Seoul)
- Branch: `codex/full-app-containers`
- Base: `d4a939fea197d78f066e20e66cb6279cc3520c9e`
- Plan commit: `d3652320b870806ee4540bd9dcad78f788b427ff`
- Tester: Codex in this chat; no non-author runtime tester yet
- Implementation revision: the commit containing this record; obtain its exact SHA with `git log --format=%H -- Document/runtime-validation.md`
- Status: source implementation draft; execution acceptance is incomplete
- PR: none; no merge, issue closure, reviewer request or external message

## Actual checks

| Check | Actual result | Boundary |
|---|---|---|
| Remote baseline/rules | Read master source tree and CONTRIBUTING.md; no AGENTS.md present in the remote baseline | Local-only files/rules could not be read |
| Local shell | Failed to start: No such file or directory (os error 2) | No shell command ran |
| Node file tool | Rejected Linux workspace URI as non-local | No Node/file command ran |
| Pure listen/DB URL helpers | 23 assertions passed in the tool's V8 isolate | Controlled removal of TypeScript annotations; not Node/Vitest/tsc |
| Limited JS syntax | Three prepared script/test bodies compiled after removing module imports and replacing import.meta.url | Not ESM loading, TypeScript compilation or dependency execution |
| Prepared file formatting | Final newline and no trailing whitespace | Source-string inspection; not git diff --check |
| Compose source review | Only web has a ports block; migration success dependency present; internal DB URL generated at runtime | Docker Compose parser and daemon not run |
| Nginx source review | URI prefixes preserved; only public port substituted; upgrade headers and dynamic DNS configured | nginx -t, HTTPS and proxy requests not run |
| Scope review | Existing development Compose, shared migrations, package/lock files and game/auth/social code excluded from changes | Connector source/diff inspection |
| Remote save | Commit/ref creation checked through GitHub connector | Does not validate a running application |

The 23 assertions cover local defaults, a PORT override, the container listen address, invalid ports/empty or padded hosts, the db:5432 URI, URI-reserved characters/dollar signs, LF/CRLF handling, significant spaces, invalid password-file formats, and missing DB settings. Test passwords are illustrative values only.

Vitest files were added for these regressions and an actual wildcard listen/HTTP request. Those files have not run. Do not report the V8 assertions as passed Vitest tests.

## Pending executed verification

- Docker Compose config parsing and first image builds with an empty host node_modules.
- npm ci, TypeScript/web build, Vitest (including actual Fastify socket test), E2E and PORT/dev/preview regressions.
- Password-file permissions under the target engine; actual PostgreSQL connection with reserved characters.
- Empty isolated DB -> migration -> ready API -> ready Nginx startup.
- HTTPS trust, HTTP redirect, web page, API health, Swagger UI/assets/JSON and browser console.
- API container replacement and DNS recovery.
- Probe-table persistence across down/up with the same volume.
- Migration conflict and startup failure on an isolated empty failure project.
- Runtime DB failure -> generic 503 -> recovery; SIGTERM and Ctrl+C behavior.
- Image/file review for actual secret exclusion.
- Non-author reproduction with recorded commands, environments, image IDs and commit.
- Actual WSS endpoint/message/close/reconnect validation after endpoint handoff.

[The execution guide](runtime.md) provides preparation and isolated verification commands. No acceptance checkbox on issue #7 is marked complete. No account/game persistence, complete real-time integration, deployment readiness or school-evaluation claim is made.

## Scope outcome

The fixed plan was followed for implementation preparation, proxy/config review and reporting.
Its runtime verification remains pending because both local execution tools failed before a process could start.
Work was saved on the existing remote work branch as the available fallback; the local checkout was not switched or modified by these tools.

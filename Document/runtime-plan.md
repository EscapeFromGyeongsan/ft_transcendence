# Issue #7 execution plan

- Date: 2026-10-12 (Asia/Seoul)
- Branch: `codex/full-app-containers`
- Base: `d4a939fea197d78f066e20e66cb6279cc3520c9e` (master)
- Scope: full application containers and HTTPS; issue #7.
- Publication constraint: no pull request, merge, issue closure, or reviewer messaging.

## Fixed sequence

1. Add a separate full-app Compose entry point and reproducible workspace images.
2. Connect DB readiness, existing migrations, and API readiness; keep local defaults.
3. Serve built web files, API and Swagger over HTTPS; prepare WebSocket upgrade forwarding.
4. Document certificate/password preparation, environment precedence, lifecycle and isolated verification.
5. Review the diff, record actual checks and outstanding validation, and report to the requester.

## Guardrails

- Do not implement game, authentication, social or WebSocket application endpoints.
- Do not change shared migrations, dependency versions or existing development Compose data.
- Use a separate full-app project/volume; first-start and failure verification must use another isolated project.
- Never commit actual passwords, private keys or certificates.
- Do not treat proxy configuration as actual WSS validation.
- Do not mark acceptance criteria complete without executed evidence and non-author reproduction.

## Environment limitation

The local shell fails to start with "No such file or directory (os error 2)".
The Node file tool rejects the Linux workspace URI as a non-local URI.
Implementation will be committed on the existing remote working branch through the GitHub connector.
Docker, Node/npm, OpenSSL, browser and OS-level tests cannot be run in this session.
Only specifically recorded source-level checks can be claimed; runtime validation remains pending.

## Progress for this pass

- Steps 1–4: source/configuration and documentation drafted.
- Step 5: source-level review completed; validation record added.
- Runtime validation: pending due to the recorded local-tool failures.
- Save location: remote working branch. No PR created.

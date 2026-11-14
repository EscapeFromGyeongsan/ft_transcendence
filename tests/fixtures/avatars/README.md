# Test avatars

Images for trying the avatar upload limits by hand (profile → avatar, or
`PUT /api/users/me/avatar` with a multipart `file` field). The server accepts
PNG or JPEG up to 2 MiB and at most 1024 px per side.

| File | Format and size | Expected result |
|---|---|---|
| `avatar-gomoku-1024.png` | PNG, 1024 × 1024, 8 KB | 200, avatar replaced |
| `avatar-othello-1024.jpg` | JPEG, 1024 × 1024, 62 KB | 200, avatar replaced |
| `avatar-neon-1024x768.png` | PNG, 1024 × 768, 11 KB | 200, avatar replaced |
| `reject-1025px.png` | PNG, 1025 × 1025, 17 KB | 422 `IMAGE_TOO_BIG`; the previous avatar stays |
| `reject-over-2mib.png` | PNG, 1024 × 768, 2.25 MiB | 413 `PAYLOAD_TOO_LARGE`; the previous avatar stays |

`reject-over-2mib.png` stays below the 3 MiB Nginx limit of `make`, so the API
itself answers the 413. The web page checks the size before uploading and shows
"이미지 크기는 2MB 이하여야 합니다." without sending the file; use the API (for
example Swagger UI at `/docs/`) to see the server's 413.

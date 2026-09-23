import { useEffect, useState, type FormEvent } from "react";

type User = { id: string; email: string; displayName: string };
const errors: Record<string, string> = {
  EMAIL_IN_USE: "이미 가입한 이메일이에요. 로그인해 주세요.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 일치하지 않아요.",
  INVALID_EMAIL: "올바른 이메일 주소를 입력해 주세요.",
  INVALID_NAME: "닉네임을 확인해 주세요.",
  INVALID_ORIGIN:
    "접속 주소가 서버 설정과 달라요. 설정된 사이트 주소로 접속해 주세요.",
};
async function authRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
        : (errors[result.error] ??
            "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요."),
    );
  return result as { user?: User | null };
}

export function Account() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void authRequest("me")
        .then((result) => {
          if (alive) {
            setUser(result.user ?? null);
            setError("");
          }
        })
        .catch((reason) => {
          if (alive) setError(reason.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (signup && !displayName.trim()) {
      setError("닉네임을 입력해 주세요.");
      return;
    }
    if (signup && password !== confirmation) {
      setError("비밀번호 확인이 일치하지 않아요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await authRequest(signup ? "register" : "login", {
        email: email.trim(),
        password,
        ...(signup ? { displayName: displayName.trim() } : {}),
      });
      setUser(result.user ?? null);
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function logout() {
    setPending(true);
    setError("");
    try {
      await authRequest("logout", {});
      setUser(null);
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="account-panel side-panel"
      aria-labelledby="account-title"
    >
      <div className="eyebrow">YOUR CAFÉ ACCOUNT</div>
      <h1 id="account-title">
        {user ? "내 계정" : signup ? "회원가입" : "로그인"}
      </h1>
      <p role="alert" className="form-error">
        {error}
      </p>
      {loading ? (
        <p role="status">로그인 상태를 확인하고 있어요.</p>
      ) : user ? (
        <>
          <h2>{user.displayName}님, 반가워요.</h2>
          <dl>
            <dt>이메일</dt>
            <dd>{user.email}</dd>
            <dt>닉네임</dt>
            <dd>{user.displayName}</dd>
          </dl>
          <p>
            계정은 저장되어 다음 방문에도 로그인할 수 있어요. 현재 대국은 임시
            참가자로 진행되며, 계정별 전적은 아직 제공하지 않아요.
          </p>
          <a className="button primary" href="#/rooms">
            게임 로비로 이동
          </a>
          <button
            className="button secondary"
            disabled={pending}
            onClick={() => void logout()}
          >
            로그아웃
          </button>
        </>
      ) : (
        <>
          <p>이메일과 비밀번호로 계정을 만들고 로그인하세요.</p>
          <form onSubmit={submit}>
            {signup && (
              <label className="field">
                닉네임
                <input
                  required
                  maxLength={16}
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            )}
            <label className="field">
              이메일
              <input
                type="email"
                required
                maxLength={254}
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              비밀번호
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby="password-help"
              />
            </label>
            <p id="password-help">비밀번호는 12~128자로 입력해 주세요.</p>
            {signup && (
              <label className="field">
                비밀번호 확인
                <input
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            )}
            <button className="button primary" disabled={pending}>
              {pending ? "처리 중…" : signup ? "가입하기" : "로그인하기"}
            </button>
          </form>
          <button
            className="button quiet"
            disabled={pending}
            onClick={() => {
              setSignup(!signup);
              setError("");
              setPassword("");
              setConfirmation("");
            }}
          >
            {signup ? "이미 계정이 있어요 · 로그인" : "처음 오셨나요? 회원가입"}
          </button>
        </>
      )}
    </section>
  );
}

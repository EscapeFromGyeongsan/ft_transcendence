import type { KeyboardEvent } from "react";
import {
  PRIVACY_EFFECTIVE_DATE,
  PRIVACY_POLICY_SECTIONS,
  TERMS_EFFECTIVE_DATE,
  TERMS_OF_SERVICE_SECTIONS,
  type LegalDocKind,
} from "./legal-routing.ts";

/** 이용약관·개인정보처리방침 화면 Props */
export interface LegalDocumentViewProps {
  /** 현재 선택된 문서 탭 ("terms" | "privacy") */
  activeDoc: LegalDocKind;
  /** 문서 탭 전환 콜백 */
  onSelectDoc: (doc: LegalDocKind) => void;
  /** 이전 화면 또는 홈/로그인으로 복귀하는 콜백 */
  onBack: () => void;
  /** 복귀 버튼 라벨 */
  backLabel?: string;
}

/**
 * 비로그인 및 로그인 상태 모두에서 상시 접근 가능한 이용약관(/terms)·개인정보처리방침(/privacy) 화면입니다.
 * (SRS NFR-PRIV-01, NFR-UX-01~02, SDS 2.2 `20_terms_privacy`)
 */
export function LegalDocumentView({
  activeDoc,
  onSelectDoc,
  onBack,
  backLabel = "이전 화면으로 돌아가기",
}: LegalDocumentViewProps) {
  const isTerms = activeDoc === "terms";
  const sections = isTerms
    ? TERMS_OF_SERVICE_SECTIONS
    : PRIVACY_POLICY_SECTIONS;
  const effectiveDate = isTerms
    ? TERMS_EFFECTIVE_DATE
    : PRIVACY_EFFECTIVE_DATE;

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const nextDoc: LegalDocKind = isTerms ? "privacy" : "terms";
      onSelectDoc(nextDoc);
    }
  }

  return (
    <div
      className="cbc-legal-page"
      data-testid="legal-document-view"
      data-legal-doc={activeDoc}
    >
      <header className="cbc-legal-topbar">
        <div>
          <span className="cbc-eyebrow">정책 및 법적 고지 · NFR-PRIV-01</span>
          <h1 className="cbc-profile-title">
            {isTerms ? "서비스 이용약관" : "개인정보처리방침"}
          </h1>
          <p className="cbc-subheading" style={{ marginTop: "0.25rem" }}>
            시행일: {effectiveDate} · 실제 서버 수집·보관·파기 정책 기준
          </p>
        </div>

        <button
          type="button"
          className="cbc-btn-secondary"
          style={{ width: "auto" }}
          data-testid="legal-back-btn"
          onClick={onBack}
        >
          {backLabel}
        </button>
      </header>

      {/* 문서 전환 탭 (이용약관 / 개인정보처리방침) */}
      <div
        className="cbc-tabs cbc-legal-tabs"
        role="tablist"
        aria-label="법적 고지 문서 선택"
        onKeyDown={handleTabKeyDown}
      >
        <button
          type="button"
          id="tab-terms"
          role="tab"
          aria-selected={isTerms}
          aria-controls="panel-legal-content"
          className={isTerms ? "is-active" : ""}
          data-testid="tab-legal-terms"
          onClick={() => onSelectDoc("terms")}
        >
          이용약관 (/terms)
        </button>
        <button
          type="button"
          id="tab-privacy"
          role="tab"
          aria-selected={!isTerms}
          aria-controls="panel-legal-content"
          className={!isTerms ? "is-active" : ""}
          data-testid="tab-legal-privacy"
          onClick={() => onSelectDoc("privacy")}
        >
          개인정보처리방침 (/privacy)
        </button>
      </div>

      {/* 본문 조항 영역 */}
      <section
        id="panel-legal-content"
        role="tabpanel"
        aria-labelledby={isTerms ? "tab-terms" : "tab-privacy"}
        className="cbc-legal-sections"
      >
        {sections.map((section) => (
          <article
            key={section.id}
            id={section.id}
            className="cbc-profile-card cbc-legal-card"
          >
            <h2 className="cbc-legal-section-title">{section.title}</h2>
            {section.paragraphs.map((paragraph, idx) => (
              <p key={`${section.id}-p-${idx}`} className="cbc-legal-paragraph">
                {paragraph}
              </p>
            ))}
            {section.bullets && section.bullets.length > 0 && (
              <ul className="cbc-legal-bullet-list">
                {section.bullets.map((bullet, idx) => (
                  <li key={`${section.id}-b-${idx}`}>{bullet}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <footer className="cbc-legal-bottom-actions">
        <button
          type="button"
          className="cbc-btn-primary"
          style={{ width: "auto" }}
          onClick={onBack}
        >
          {backLabel}
        </button>
      </footer>
    </div>
  );
}

/** 404 찾을 수 없음 화면 Props */
export interface NotFoundViewProps {
  pathname: string;
  isAuthenticated: boolean;
  onNavigateHome: () => void;
}

/**
 * 정의되지 않은 URL 경로 진입 시 표시하는 404 안내 화면입니다 (SDS 2.2 `21_error_404`).
 */
export function NotFoundView({
  pathname,
  isAuthenticated,
  onNavigateHome,
}: NotFoundViewProps) {
  return (
    <div className="cbc-stage" data-testid="not-found-view">
      <div className="cbc-login-card" style={{ textAlign: "center" }}>
        <span className="cbc-eyebrow">404 NOT FOUND</span>
        <h1 className="cbc-heading-login" style={{ marginTop: "0.375rem" }}>
          요청하신 페이지를 찾을 수 없습니다
        </h1>
        <p className="cbc-subheading" style={{ marginTop: "0.5rem" }}>
          경로(<code>{pathname}</code>)가 존재하지 않거나 이동되었습니다.
        </p>
        <div style={{ marginTop: "1.5rem" }}>
          <button
            type="button"
            className="cbc-btn-primary"
            data-testid="not-found-home-btn"
            onClick={onNavigateHome}
          >
            {isAuthenticated ? "로비로 이동" : "로그인 화면으로 이동"}
          </button>
        </div>
      </div>
    </div>
  );
}

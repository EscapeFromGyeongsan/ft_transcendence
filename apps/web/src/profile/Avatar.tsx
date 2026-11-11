import { avatarInitial } from "../api/profile-format.ts";

/** 아바타 이미지·대체 닉네임과 표시 크기·스타일을 지정하는 속성입니다. */
interface AvatarProps {
  nickname: string | null | undefined;
  /** `null`이면 닉네임 첫 글자를 담은 기본 이미지를 표시합니다. */
  avatarUrl?: string | null;
  className?: string;
  size?: number;
}

/**
 * 사용자 아바타를 표시합니다. 업로드한 이미지가 없으면(`avatarUrl === null`) 기본 이미지로 대체합니다.
 */
export function Avatar({
  nickname,
  avatarUrl = null,
  className = "",
  size,
}: AvatarProps) {
  const style = size
    ? { width: size, height: size, fontSize: Math.round(size * 0.42) }
    : undefined;

  if (avatarUrl) {
    return (
      <img
        className={`cbc-avatar-img ${className}`.trim()}
        src={avatarUrl}
        alt={`${nickname ?? "사용자"} 프로필 이미지`}
        style={style}
      />
    );
  }

  return (
    <span
      className={`cbc-avatar-circle cbc-avatar-default ${className}`.trim()}
      style={style}
      role="img"
      aria-label={`${nickname ?? "사용자"} 기본 프로필 이미지`}
    >
      {avatarInitial(nickname)}
    </span>
  );
}

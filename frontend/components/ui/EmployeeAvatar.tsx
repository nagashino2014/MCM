"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";

/**
 * 직원 사진 아바타(공용) — employee_profiles.photo_public_path(=/api/admin/employees/{id}/photo)
 * 를 src 로 렌더하고, 없거나 로드 실패 시 lucide UserRound 아이콘으로 폴백한다.
 * photoPath 가 없어도 employeeId 가 있으면 API 경로를 직접 구성해 시도한다.
 */
export function EmployeeAvatar({
  employeeId,
  photoPath,
  size = 28,
  className,
}: {
  employeeId?: string | null;
  photoPath?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = photoPath || (employeeId ? `/api/admin/employees/${encodeURIComponent(employeeId)}/photo` : null);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className={`rounded-full object-cover shrink-0 ${className ?? ""}`}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className={`rounded-full flex items-center justify-center cd-surface-bg shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <UserRound className="cd-text-muted" style={{ width: size * 0.58, height: size * 0.58 }} />
    </span>
  );
}

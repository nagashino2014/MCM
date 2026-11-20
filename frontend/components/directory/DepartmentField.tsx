"use client";

// 담당자 부서 지정(2026-11-20) — 주소록의 담당자 등록·수정 창 공용.
// 그 기관·업체에 이미 있는 부서에서 고르거나 [새 부서 입력]으로 새 이름을 적는다(저장할 때 부서가 만들어진다).
// 사업장 상세까지 가지 않고 주소록에서 부서를 만들고 지정할 수 있게 한다.

import { useEffect, useState } from "react";
import { CdInput, CdSelect } from "@/components/cdash/CdField";

const NEW = "__new__";

export function DepartmentField({
  facilityId,
  value,
  onChange,
}: {
  /** 기관·업체가 아직 정해지지 않았으면 null — 이름을 직접 적는다. */
  facilityId: string | null;
  /** 부서명(빈 문자열 = 부서 없음) */
  value: string;
  onChange: (name: string) => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    setNames(null);
    setTyping(false);
    if (!facilityId) return;
    let cancelled = false;
    fetch(`/api/directory/contacts?facilityId=${encodeURIComponent(facilityId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list: string[] = Array.isArray(d?.departments) ? d.departments.map((x: { name: string }) => String(x.name)) : [];
        setNames(list);
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [facilityId]);

  // 고를 부서가 없거나(업체 미정·부서 0개·불러오는 중) 새 이름을 적는 중이면 입력 칸.
  const listed = names ?? [];
  const current = value.trim();
  const freeText = !facilityId || names == null || listed.length === 0 || typing || (current !== "" && !listed.includes(current));
  if (freeText) {
    return (
      <CdInput
        label="부서"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="예: 환경안전팀"
        hint={listed.length > 0 ? "새 부서 이름을 적으면 저장할 때 이 기관·업체에 부서가 만들어집니다." : undefined}
        labelExtra={
          listed.length > 0 ? (
            <button
              type="button"
              className="text-[12px] cd-text-primary"
              onClick={() => {
                setTyping(false);
                onChange("");
              }}
            >
              기존 부서에서 고르기
            </button>
          ) : undefined
        }
      />
    );
  }
  return (
    <CdSelect
      label="부서"
      value={current}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setTyping(true);
          onChange("");
        } else onChange(e.target.value);
      }}
    >
      <option value="">부서 없음</option>
      {listed.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={NEW}>＋ 새 부서 입력</option>
    </CdSelect>
  );
}

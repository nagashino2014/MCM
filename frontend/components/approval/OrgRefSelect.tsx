"use client";

// 부서·직급 선택(2026-10-21, 결재 연계 L1) — 양식의 부서 검색 항목(dept_select)과 표의 부서·직급 선택 열이 쓴다.
// 값은 마스터 ID 를 함께 저장한다: 부서 {deptId, name}, 직급 {positionId, name}.
// 구버전 자유 텍스트 값은 "(목록 외)" 선택지로 그대로 보여 준다(값을 바꾸기 전까지 보존).
// 조직도는 /api/org/snapshot(로그인만 필요)을 한 번만 받아 화면 전체가 공유한다.

import { useEffect, useState } from "react";

interface OrgOptions {
  departments: { id: string; name: string }[];
  positions: { id: string; name: string }[];
}

let cache: Promise<OrgOptions> | null = null;

function loadOrgOptions(): Promise<OrgOptions> {
  if (!cache) {
    cache = fetch("/api/org/snapshot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { departments: [], positions: [] }))
      .then((d: { departments?: { deptId: string; deptName: string; isActive?: boolean }[]; positions?: { positionId: string; positionName: string; isActive?: boolean }[] }) => ({
        departments: (d.departments ?? []).filter((x) => x.isActive !== false).map((x) => ({ id: x.deptId, name: x.deptName })),
        positions: (d.positions ?? []).filter((x) => x.isActive !== false).map((x) => ({ id: x.positionId, name: x.positionName })),
      }))
      .catch(() => {
        cache = null; // 실패는 다음 화면에서 다시 시도
        return { departments: [], positions: [] };
      });
  }
  return cache;
}

export type OrgRefKind = "dept" | "position";

/** 저장 값 → {id, name}. 구버전 문자열은 id 없이 이름만 */
export function orgRefOf(value: unknown, kind: OrgRefKind): { id: string | null; name: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return { id: String(o[kind === "dept" ? "deptId" : "positionId"] ?? "") || null, name: String(o.name ?? "") };
  }
  return { id: null, name: String(value ?? "").trim() };
}

export function OrgRefSelect({
  kind,
  value,
  onChange,
  disabled,
  className = "",
  style,
}: {
  kind: OrgRefKind;
  value: unknown;
  onChange: (next: { deptId: string; name: string } | { positionId: string; name: string } | "") => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [opts, setOpts] = useState<OrgOptions | null>(null);
  useEffect(() => {
    let alive = true;
    void loadOrgOptions().then((o) => alive && setOpts(o));
    return () => {
      alive = false;
    };
  }, []);
  const list = opts ? (kind === "dept" ? opts.departments : opts.positions) : [];
  const cur = orgRefOf(value, kind);
  const legacy = !cur.id && cur.name ? cur.name : null;
  const selectValue = cur.id ?? (legacy ? `__legacy__` : "");
  return (
    <select
      className={className}
      style={style}
      disabled={disabled}
      value={selectValue}
      onChange={(e) => {
        const id = e.target.value;
        if (!id || id === "__legacy__") {
          if (!id) onChange("");
          return;
        }
        const hit = list.find((x) => x.id === id);
        if (!hit) return;
        onChange(kind === "dept" ? { deptId: hit.id, name: hit.name } : { positionId: hit.id, name: hit.name });
      }}
    >
      <option value="">{kind === "dept" ? "부서 선택" : "직급 선택"}</option>
      {legacy && <option value="__legacy__">{legacy} (목록 외)</option>}
      {/* 목록에서 사라진(비활성) 부서·직급을 고른 기존 값도 보이게 남긴다 */}
      {cur.id && !list.some((x) => x.id === cur.id) && <option value={cur.id}>{cur.name || cur.id}</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

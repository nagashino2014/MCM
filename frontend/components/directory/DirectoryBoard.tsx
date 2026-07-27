"use client";

// 주소록·조직도(G6-A, /directory) — 사내 임직원 디렉터리 + 외부 연락처(사업장 담당자).
// 임직원 탭: 좌 부서 트리 + 우 인명 카드 그리드(auto-fit — §3.0 FHD-first, 고정 열 수 금지).
// 외부 탭: 담당자 목록(cd-table, sales.view 권한 없으면 안내). 메일 주소 클릭 = 웹메일 작성 딥링크.
// 설계: docs/groupware-ux-overhaul-blueprint.md §7 — 메일 자동완성·결재선(OrgPickerModal)과 데이터 공유.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookUser, Building2, Mail, Phone, Search, Smartphone, Users, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdTabs } from "@/components/cdash/CdTabs";
import type { DirectoryDepartment, DirectoryPerson } from "@/lib/directory";
import "@/components/cdash/cdash.css";

type Tab = "staff" | "external";

interface ExternalContact {
  id: number;
  facilityName: string | null;
  departmentName: string | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  deptType: string | null;
  status: string;
}

const DEPT_TYPE_LABEL: Record<string, string> = { contract: "계약", env: "환경" };

export function DirectoryBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<Tab>("staff");

  // 임직원
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // 외부 연락처(사업장 담당자)
  const [contacts, setContacts] = useState<ExternalContact[] | null>(null);
  const [contactsDenied, setContactsDenied] = useState(false);
  const [cq, setCq] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/directory", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setDepartments(Array.isArray(d.departments) ? d.departments : []);
        setPeople(Array.isArray(d.people) ? d.people : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadContacts = useCallback(async () => {
    if (contacts || contactsDenied) return;
    try {
      const r = await fetch("/api/sales/contacts", { cache: "no-store" });
      if (r.status === 403 || r.status === 401) {
        setContactsDenied(true);
        return;
      }
      if (r.ok) {
        const d = await r.json();
        setContacts(Array.isArray(d.contacts) ? d.contacts : []);
      }
    } catch {
      // 무시 — 재진입 시 재시도
    }
  }, [contacts, contactsDenied]);

  useEffect(() => {
    if (tab === "external") loadContacts();
  }, [tab, loadContacts]);

  // 부서 트리(1depth 들여쓰기) + 부서별 인원수.
  const deptTree = useMemo(() => {
    const countBy = new Map<string, number>();
    for (const p of people) {
      if (p.deptId) countBy.set(p.deptId, (countBy.get(p.deptId) ?? 0) + 1);
    }
    const roots = departments.filter((d) => !d.parentDeptId);
    const childrenOf = (id: string) => departments.filter((d) => d.parentDeptId === id);
    const out: { dept: DirectoryDepartment; depth: number; count: number }[] = [];
    const walk = (dept: DirectoryDepartment, depth: number) => {
      out.push({ dept, depth, count: countBy.get(dept.deptId) ?? 0 });
      for (const c of childrenOf(dept.deptId)) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [departments, people]);

  const filteredPeople = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter((p) => {
      if (deptId && p.deptId !== deptId) return false;
      if (!s) return true;
      const hay = [p.name, p.deptName, p.positionName, p.companyEmail, p.mobilePhone, p.companyPhone, p.jobDuties]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [people, deptId, q]);

  const filteredContacts = useMemo(() => {
    const s = cq.trim().toLowerCase();
    const list = (contacts ?? []).filter((c) => c.status !== "inactive");
    if (!s) return list;
    return list.filter((c) =>
      [c.personName, c.facilityName, c.departmentName, c.title, c.mobilePhone, c.officePhone, c.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s)
    );
  }, [contacts, cq]);

  const selectedDeptName = deptId ? departments.find((d) => d.deptId === deptId)?.deptName : null;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<BookUser className="w-5 h-5" />}
        eyebrow="Directory"
        title="주소록 · 조직도"
        subtitle="임직원 연락처와 조직도를 한눈에 — 메일 주소를 클릭하면 바로 메일을 쓸 수 있습니다."
      />

      <CdTabs
        variant="pill"
        items={[
          { key: "staff", label: "임직원", count: people.length || undefined },
          { key: "external", label: "외부 연락처(사업장 담당자)" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      {tab === "staff" ? (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          {/* 부서 pane — <lg 는 가로 스크롤 칩으로 리플로우(§3.0 축소 금지) */}
          <div className="lg:w-60 shrink-0 rounded-2xl border cd-border-c cd-card-bg p-3 lg:overflow-y-auto">
            <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible">
              <button
                type="button"
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-left whitespace-nowrap transition-colors ${
                  deptId == null ? "cd-tint-primary font-semibold" : "cd-text hover:bg-[color:var(--cd-surface)]"
                }`}
                onClick={() => setDeptId(null)}
              >
                <Users className="w-4 h-4 shrink-0" />
                전체
                <span className="ml-auto text-[10.5px] cd-text-faint">{people.length}</span>
              </button>
              {deptTree.map(({ dept, depth, count }) => (
                <button
                  key={dept.deptId}
                  type="button"
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-left whitespace-nowrap transition-colors ${
                    deptId === dept.deptId ? "cd-tint-primary font-semibold" : "cd-text hover:bg-[color:var(--cd-surface)]"
                  }`}
                  style={{ paddingLeft: `${0.625 + depth * 0.9}rem` }}
                  onClick={() => setDeptId(dept.deptId)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: dept.accentColor ?? "var(--cd-primary)" }}
                  />
                  <span className="truncate">{dept.deptName}</span>
                  <span className="ml-auto text-[10.5px] cd-text-faint">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 인명부 */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Search className="w-4 h-4 cd-text-faint" />
                <input
                  className="cd-input"
                  style={{ width: 260 }}
                  placeholder="이름·부서·직급·전화·메일 검색"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {selectedDeptName && (
                <button type="button" className="cd-chip cd-chip-sm" data-active onClick={() => setDeptId(null)}>
                  {selectedDeptName} <X className="w-3 h-3 inline" />
                </button>
              )}
              <span className="ml-auto text-[11.5px] cd-text-faint">{filteredPeople.length}명</span>
            </div>

            {loading ? (
              <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
            ) : filteredPeople.length === 0 ? (
              <CdEmptyState icon={<Users className="w-7 h-7" />} title="인원이 없습니다" description="검색어나 부서 필터를 바꿔보세요." />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
                  {filteredPeople.map((p) => (
                    <div key={p.employeeId} className="rounded-2xl border cd-border-c cd-card-bg p-4 flex flex-col gap-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <CdAvatar name={p.name} src={p.photoPath} size="md" />
                        <div className="min-w-0">
                          <p className="text-[14px] font-bold cd-text truncate">
                            {p.name}
                            {p.positionName && <span className="ml-1.5 text-[11.5px] font-medium cd-text-faint">{p.positionName}</span>}
                          </p>
                          <p className="text-[11.5px] cd-text-faint truncate">{p.deptName ?? "-"}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 text-[12px]">
                        <ContactRow icon={<Mail className="w-3.5 h-3.5" />}>
                          {p.companyEmail ? (
                            <Link
                              href={`/mail/compose?to=${encodeURIComponent(p.companyEmail)}`}
                              className="cd-text-primary hover:underline truncate"
                              title={`${p.name} 님에게 메일 쓰기`}
                            >
                              {p.companyEmail}
                            </Link>
                          ) : (
                            <span className="cd-text-faint">-</span>
                          )}
                        </ContactRow>
                        <ContactRow icon={<Smartphone className="w-3.5 h-3.5" />}>
                          <span className="cd-text tabular-nums">{p.mobilePhone ?? "-"}</span>
                        </ContactRow>
                        <ContactRow icon={<Phone className="w-3.5 h-3.5" />}>
                          <span className="cd-text tabular-nums">{p.companyPhone ?? "-"}</span>
                        </ContactRow>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {contactsDenied ? (
            <CdEmptyState
              icon={<Building2 className="w-7 h-7" />}
              title="열람 권한이 없습니다"
              description="외부 연락처(사업장 담당자)는 영업 조회 권한이 있는 계정만 볼 수 있습니다."
            />
          ) : contacts == null ? (
            <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 cd-text-faint" />
                <input
                  className="cd-input"
                  style={{ width: 260 }}
                  placeholder="이름·사업장·전화·이메일 검색"
                  value={cq}
                  onChange={(e) => setCq(e.target.value)}
                />
                <span className="ml-auto text-[11.5px] cd-text-faint">{filteredContacts.length}명</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto rounded-2xl border cd-border-c cd-card-bg">
                <table className="cd-table text-[12.5px]">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>직급</th>
                      <th>사업장</th>
                      <th>부서</th>
                      <th>휴대폰</th>
                      <th>사무실</th>
                      <th>이메일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((c) => (
                      <tr key={c.id}>
                        <td className="cd-text font-bold whitespace-nowrap">{c.personName}</td>
                        <td className="cd-text-muted whitespace-nowrap">{c.title ?? "-"}</td>
                        <td className="cd-text-muted">{c.facilityName ?? "-"}</td>
                        <td className="cd-text-muted whitespace-nowrap">
                          {c.departmentName ?? "-"}
                          {c.deptType && DEPT_TYPE_LABEL[c.deptType] && (
                            <span className="ml-1 text-[10px] cd-text-faint">({DEPT_TYPE_LABEL[c.deptType]})</span>
                          )}
                        </td>
                        <td className="cd-text-muted tabular-nums whitespace-nowrap">{c.mobilePhone ?? "-"}</td>
                        <td className="cd-text-muted tabular-nums whitespace-nowrap">{c.officePhone ?? "-"}</td>
                        <td>
                          {c.email ? (
                            <Link href={`/mail/compose?to=${encodeURIComponent(c.email)}`} className="cd-text-primary hover:underline">
                              {c.email}
                            </Link>
                          ) : (
                            <span className="cd-text-faint">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredContacts.length === 0 && (
                  <p className="text-sm cd-text-faint p-6 text-center">표시할 담당자가 없습니다.</p>
                )}
              </div>
              <p className="text-[10.5px] cd-text-faint">
                담당자 등록·수정은 영업 · 마케팅 &gt; 담당자 정보 관리에서 합니다.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ContactRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="cd-text-faint shrink-0">{icon}</span>
      {children}
    </div>
  );
}

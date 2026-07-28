"use client";

// 주소록·조직도(G6-A, /directory) — 임직원 / 외부 연락처 / 조직도 3탭.
// 임직원·외부 연락처는 좌측 분류 pane + 우측 목록의 동일한 양식을 쓴다(부서 / 연락처 구분).
// 연락처 구분(기관 유형)은 담당자 개인이 아니라 소속 사업장 속성이라, 한 번 지정하면
// 같은 사업장의 담당자 전원에게 함께 적용된다.
// 설계: docs/groupware-ux-overhaul-blueprint.md §7 — 메일 자동완성·결재선과 데이터 공유.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Beaker, BookUser, Building2, Landmark, Mail, Network, Pencil, Phone, Search, Smartphone,
  Trash2, Users, X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import { CdButton } from "@/components/cdash/CdButton";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdInput, CdSelect } from "@/components/cdash/CdField";
import { CdModal } from "@/components/cdash/CdModal";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdToast } from "@/components/cdash/CdToast";
import { ORG_CATEGORIES } from "@/lib/directory-categories";
import type { DirectoryDepartment, DirectoryPerson } from "@/lib/directory";
import "@/components/cdash/cdash.css";

type Tab = "staff" | "external" | "orgchart";

interface ExternalContact {
  id: number;
  facilityId: string;
  facilityName: string | null;
  departmentName: string | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  deptType: string | null;
  orgCategory: string | null;
  status: string;
}

const DEPT_TYPE_LABEL: Record<string, string> = { contract: "계약", env: "환경" };
const UNCATEGORIZED = "__none__";

/** 메일 쓰기 딥링크용 수신자 토큰 — "이름 직함 <주소>, " 형태로 넘겨야 작성 화면에서 칩으로 잡힌다. */
function mailToken(name: string, title: string | null | undefined, address: string): string {
  const label = [name, title].filter(Boolean).join(" ");
  return `${label} <${address}>, `;
}

export function DirectoryBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [tab, setTab] = useState<Tab>("staff");

  // 임직원
  const [departments, setDepartments] = useState<DirectoryDepartment[]>([]);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [deptId, setDeptId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // 외부 연락처
  const [contacts, setContacts] = useState<ExternalContact[] | null>(null);
  const [contactsDenied, setContactsDenied] = useState(false);
  const [cq, setCq] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<ExternalContact | null>(null);
  const [deleting, setDeleting] = useState<ExternalContact | null>(null);

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
  }, []);

  useEffect(() => {
    if (tab === "external" && contacts == null && !contactsDenied) loadContacts();
  }, [tab, contacts, contactsDenied, loadContacts]);

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

  const activeContacts = useMemo(() => (contacts ?? []).filter((c) => c.status !== "inactive"), [contacts]);

  // 연락처 구분별 건수(미지정 포함) — 좌측 분류 pane 용.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of activeContacts) {
      const key = c.orgCategory && ORG_CATEGORIES.includes(c.orgCategory as never) ? c.orgCategory : UNCATEGORIZED;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [activeContacts]);

  const filteredContacts = useMemo(() => {
    const s = cq.trim().toLowerCase();
    return activeContacts.filter((c) => {
      if (category) {
        const key = c.orgCategory && ORG_CATEGORIES.includes(c.orgCategory as never) ? c.orgCategory : UNCATEGORIZED;
        if (key !== category) return false;
      }
      if (!s) return true;
      return [c.personName, c.facilityName, c.departmentName, c.title, c.mobilePhone, c.officePhone, c.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s);
    });
  }, [activeContacts, cq, category]);

  const selectedDeptName = deptId ? departments.find((d) => d.deptId === deptId)?.deptName : null;

  const removeContact = async (c: ExternalContact) => {
    const r = await fetch(`/api/directory/contacts?id=${c.id}`, { method: "DELETE" });
    if (r.ok) {
      toast(`'${c.personName}' 담당자를 삭제했습니다.`, "success");
      setContacts((prev) => (prev ?? []).filter((x) => x.id !== c.id));
    } else {
      const d = await r.json().catch(() => ({}));
      toast(String(d.error ?? "삭제에 실패했습니다."), "error");
    }
    setDeleting(null);
  };

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
          { key: "external", label: "외부 연락처", count: activeContacts.length || undefined },
          { key: "orgchart", label: "조직도" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      {tab === "staff" ? (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          {/* 부서 pane — <lg 는 가로 스크롤 칩으로 리플로우(§3.0 축소 금지) */}
          <FilterPane>
            <FilterItem active={deptId == null} onClick={() => setDeptId(null)} icon={<Users className="w-4 h-4 shrink-0" />} count={people.length}>
              전체
            </FilterItem>
            {deptTree.map(({ dept, depth, count }) => (
              <FilterItem
                key={dept.deptId}
                active={deptId === dept.deptId}
                onClick={() => setDeptId(dept.deptId)}
                indent={depth}
                dot={dept.accentColor ?? "var(--cd-primary)"}
                count={count}
              >
                {dept.deptName}
              </FilterItem>
            ))}
          </FilterPane>

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
                              href={`/mail/compose?to=${encodeURIComponent(mailToken(p.name, p.positionName, p.companyEmail))}`}
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
      ) : tab === "external" ? (
        contactsDenied ? (
          <CdEmptyState
            icon={<Building2 className="w-7 h-7" />}
            title="열람 권한이 없습니다"
            description="외부 연락처는 영업 조회 권한이 있는 계정만 볼 수 있습니다."
          />
        ) : contacts == null ? (
          <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
            {/* 연락처 구분 pane — 임직원 탭의 부서 pane 과 동일 양식 */}
            <FilterPane>
              <FilterItem active={category == null} onClick={() => setCategory(null)} icon={<Users className="w-4 h-4 shrink-0" />} count={activeContacts.length}>
                전체
              </FilterItem>
              {ORG_CATEGORIES.map((c) => (
                <FilterItem key={c} active={category === c} onClick={() => setCategory(c)} icon={<CategoryIcon name={c} />} count={categoryCounts.get(c) ?? 0}>
                  {c}
                </FilterItem>
              ))}
              <FilterItem
                active={category === UNCATEGORIZED}
                onClick={() => setCategory(UNCATEGORIZED)}
                icon={<X className="w-4 h-4 shrink-0" />}
                count={categoryCounts.get(UNCATEGORIZED) ?? 0}
              >
                미지정
              </FilterItem>
            </FilterPane>

            <div className="flex-1 min-w-0 flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Search className="w-4 h-4 cd-text-faint" />
                <input
                  className="cd-input"
                  style={{ width: 260 }}
                  placeholder="이름·기관/업체·전화·이메일 검색"
                  value={cq}
                  onChange={(e) => setCq(e.target.value)}
                />
                {category && (
                  <button type="button" className="cd-chip cd-chip-sm" data-active onClick={() => setCategory(null)}>
                    {category === UNCATEGORIZED ? "미지정" : category} <X className="w-3 h-3 inline" />
                  </button>
                )}
                <span className="ml-auto text-[11.5px] cd-text-faint">{filteredContacts.length}명</span>
              </div>

              <div className="flex-1 min-h-0 overflow-auto rounded-2xl border cd-border-c cd-card-bg">
                <table className="cd-table text-[12.5px]">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>직급</th>
                      <th>기관·업체</th>
                      <th>연락처 구분</th>
                      <th>부서</th>
                      <th>휴대폰</th>
                      <th>사무실</th>
                      <th>이메일</th>
                      <th className="w-20">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((c) => (
                      <tr key={c.id}>
                        <td className="cd-text font-bold whitespace-nowrap">{c.personName}</td>
                        <td className="cd-text-muted whitespace-nowrap">{c.title ?? "-"}</td>
                        <td className="cd-text-muted">{c.facilityName ?? "-"}</td>
                        <td className="whitespace-nowrap">
                          {c.orgCategory ? (
                            <span className="cd-pill cd-pill-info">{c.orgCategory}</span>
                          ) : (
                            <span className="text-[11px] cd-text-faint">미지정</span>
                          )}
                        </td>
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
                            <Link
                              href={`/mail/compose?to=${encodeURIComponent(mailToken(c.personName, c.title, c.email))}`}
                              className="cd-text-primary hover:underline"
                            >
                              {c.email}
                            </Link>
                          ) : (
                            <span className="cd-text-faint">-</span>
                          )}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="p-1 rounded-md cd-text-faint hover:cd-text-primary"
                              title="수정"
                              onClick={() => setEditing(c)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              className="p-1 rounded-md cd-text-faint hover:cd-error-text"
                              title="삭제"
                              onClick={() => setDeleting(c)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredContacts.length === 0 && <p className="text-sm cd-text-faint p-6 text-center">표시할 담당자가 없습니다.</p>}
              </div>
              <p className="text-[10.5px] cd-text-faint">
                연락처 구분은 소속 기관·업체(사업장) 단위 속성이라, 지정하면 같은 곳의 담당자 전원에게 함께 적용됩니다. 담당자 신규 등록·명함 촬영은 사업장 상세에서 합니다.
              </p>
            </div>
          </div>
        )
      ) : (
        <OrgChart departments={departments} people={people} loading={loading} />
      )}

      {editing && (
        <ContactEditModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            // 연락처 구분은 사업장 속성 — 같은 사업장의 다른 담당자에게도 즉시 반영한다.
            setContacts((prev) =>
              (prev ?? []).map((x) =>
                x.id === editing.id
                  ? { ...x, ...patch }
                  : x.facilityId === editing.facilityId && patch.orgCategory !== undefined
                    ? { ...x, orgCategory: patch.orgCategory ?? x.orgCategory }
                    : x
              )
            );
            setEditing(null);
          }}
        />
      )}

      <CdModal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title="담당자 삭제"
        size="sm"
        footer={
          <>
            <CdButton onClick={() => setDeleting(null)}>취소</CdButton>
            <CdButton variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={() => deleting && removeContact(deleting)}>
              삭제
            </CdButton>
          </>
        }
      >
        <p className="text-sm cd-text">
          {deleting ? `'${deleting.personName}'(${deleting.facilityName ?? "-"}) 담당자를 주소록에서 삭제할까요?` : ""}
        </p>
        <p className="text-xs cd-text-faint mt-1.5">삭제하면 사업장 상세의 담당자 목록에서도 제거됩니다.</p>
      </CdModal>
    </div>
  );
}

/** 좌측 분류 pane — 임직원(부서)·외부 연락처(연락처 구분) 공용 셸. */
function FilterPane({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:w-60 shrink-0 rounded-2xl border cd-border-c cd-card-bg p-3 lg:overflow-y-auto">
      <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible">{children}</div>
    </div>
  );
}

function FilterItem({
  active,
  onClick,
  children,
  count,
  icon,
  dot,
  indent = 0,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  icon?: React.ReactNode;
  dot?: string;
  indent?: number;
}) {
  return (
    <button
      type="button"
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-left whitespace-nowrap transition-colors ${
        active ? "cd-tint-primary font-semibold" : "cd-text hover:bg-[color:var(--cd-surface)]"
      }`}
      style={indent ? { paddingLeft: `${0.625 + indent * 0.9}rem` } : undefined}
      onClick={onClick}
    >
      {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dot }} />}
      {icon}
      <span className="truncate">{children}</span>
      {count != null && <span className="ml-auto text-[10.5px] cd-text-faint">{count}</span>}
    </button>
  );
}

function CategoryIcon({ name }: { name: string }) {
  const cls = "w-4 h-4 shrink-0";
  if (name === "공공기관" || name === "공기업") return <Landmark className={cls} />;
  if (name === "금융기관") return <Landmark className={cls} />;
  if (name === "협회·조합") return <Users className={cls} />;
  if (name === "협력업체") return <Beaker className={cls} />;
  return <Building2 className={cls} />;
}

function ContactRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="cd-text-faint shrink-0">{icon}</span>
      {children}
    </div>
  );
}

/** 담당자 수정 — 이름·직급·연락처 + 소속 사업장의 연락처 구분(기관 유형). */
function ContactEditModal({
  contact,
  onClose,
  onSaved,
}: {
  contact: ExternalContact;
  onClose: () => void;
  onSaved: (patch: Partial<ExternalContact>) => void;
}) {
  const { toast } = useCdToast();
  const [personName, setPersonName] = useState(contact.personName);
  const [title, setTitle] = useState(contact.title ?? "");
  const [mobilePhone, setMobilePhone] = useState(contact.mobilePhone ?? "");
  const [officePhone, setOfficePhone] = useState(contact.officePhone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [orgCategory, setOrgCategory] = useState(contact.orgCategory ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!personName.trim()) {
      toast("이름을 입력하세요.", "warn");
      return;
    }
    if (!orgCategory) {
      toast("연락처 구분을 선택하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/directory/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contact.id,
          facilityId: contact.facilityId,
          orgCategory,
          personName,
          title: title.trim() || null,
          mobilePhone: mobilePhone.trim() || null,
          officePhone: officePhone.trim() || null,
          email: email.trim() || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(String(d.error ?? "저장에 실패했습니다."), "error");
        return;
      }
      toast("담당자 정보를 저장했습니다.", "success");
      onSaved({
        personName,
        title: title.trim() || null,
        mobilePhone: mobilePhone.trim() || null,
        officePhone: officePhone.trim() || null,
        email: email.trim() || null,
        orgCategory,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <CdModal
      open
      onClose={onClose}
      title="담당자 수정"
      size="md"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={save}>
            저장
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs cd-text-faint">
          소속: <span className="cd-text font-semibold">{contact.facilityName ?? "-"}</span>
        </p>
        <CdSelect
          label="연락처 구분"
          required
          value={orgCategory}
          onChange={(e) => setOrgCategory(e.target.value)}
          hint="소속 기관·업체(사업장) 속성입니다 — 같은 곳의 담당자 전원에게 함께 적용됩니다."
        >
          <option value="">선택하세요</option>
          {ORG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </CdSelect>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CdInput label="이름" required value={personName} onChange={(e) => setPersonName(e.target.value)} />
          <CdInput label="직급" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 부장" />
          <CdInput label="휴대폰" value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
          <CdInput label="사무실" value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} />
        </div>
        <CdInput label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
      </div>
    </CdModal>
  );
}

/**
 * 조직도 — 대표이사 → 총괄 → 실무 부서(수평) 3단 구성.
 * departments 는 평면 구조라, 최상위 부서('총괄')를 축으로 나머지를 아래 단에 배치한다.
 */
function OrgChart({
  departments,
  people,
  loading,
}: {
  departments: DirectoryDepartment[];
  people: DirectoryPerson[];
  loading: boolean;
}) {
  const byDept = useMemo(() => {
    const m = new Map<string, DirectoryPerson[]>();
    for (const p of people) {
      if (!p.deptId) continue;
      m.set(p.deptId, [...(m.get(p.deptId) ?? []), p]);
    }
    return m;
  }, [people]);

  if (loading) return <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>;

  // 대표이사는 소속 부서와 무관하게 최상단에 단독 배치한다(직급 서열 최상위).
  const ceo = people.find((p) => p.positionName === "대표이사") ?? null;
  const headDept = departments.find((d) => d.deptName === "총괄") ?? departments[0] ?? null;
  const headMembers = (headDept ? byDept.get(headDept.deptId) ?? [] : []).filter((p) => p.employeeId !== ceo?.employeeId);
  const unitDepts = departments.filter((d) => d.deptId !== headDept?.deptId);

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="flex flex-col items-center gap-0 py-4 min-w-max mx-auto">
        {/* 대표이사 */}
        {ceo && (
          <>
            <OrgNode title="대표이사" accent="var(--cd-primary)" members={[ceo]} emphasis />
            <Connector />
          </>
        )}

        {/* 총괄 */}
        {headDept && (
          <>
            <OrgNode title={headDept.deptName} accent={headDept.accentColor ?? "var(--cd-primary)"} members={headMembers} />
            <Connector />
          </>
        )}

        {/* 실무 부서 — 상하 관계 없이 수평 배치. 가로 간선으로 형제 관계를 명확히 보인다. */}
        <div className="flex items-stretch justify-center">
          {unitDepts.map((d, i) => (
            <div key={d.deptId} className="flex flex-col items-center px-2">
              {/* 형제 연결 가로선 — 열 사이 여백(px-2, 좌우 8px)까지 늘려 이웃 선과 이어지게 한다.
                  양 끝 열은 바깥쪽 절반을 비워 ㅜ 자 모양이 되도록. */}
              <div className="relative w-full" style={{ height: 2 }}>
                <div
                  className="absolute top-0"
                  style={{
                    height: 2,
                    background: ORG_LINE,
                    left: i === 0 ? "50%" : -8,
                    right: i === unitDepts.length - 1 ? "50%" : -8,
                  }}
                />
              </div>
              <div style={{ width: 2, height: 18, background: ORG_LINE }} />
              <OrgNode title={d.deptName} accent={d.accentColor ?? "var(--cd-primary)"} members={byDept.get(d.deptId) ?? []} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 조직도 간선 색 — 카드 테두리(--cd-border)는 옅어 계통이 안 보여 뚜렷한 색을 쓴다. */
const ORG_LINE = "color-mix(in srgb, var(--cd-primary) 55%, transparent)";

function Connector() {
  return <div style={{ width: 2, height: 20, background: ORG_LINE }} />;
}

function OrgNode({
  title,
  accent,
  members,
  emphasis,
}: {
  title: string;
  accent: string;
  members: DirectoryPerson[];
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border cd-card-bg px-4 py-3 min-w-[190px] max-w-[240px] ${emphasis ? "border-2" : "cd-border-c"}`}
      style={emphasis ? { borderColor: accent } : undefined}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
        <span className="text-[13px] font-bold cd-text truncate">{title}</span>
        <span className="ml-auto text-[10.5px] cd-text-faint">{members.length}명</span>
      </div>
      <div className="flex flex-col gap-1">
        {members.length === 0 ? (
          <span className="text-[11px] cd-text-faint">인원 없음</span>
        ) : (
          members.map((m) => (
            <div key={m.employeeId} className="flex items-center gap-1.5 min-w-0">
              <CdAvatar name={m.name} src={m.photoPath} size="xs" />
              <span className="text-[12px] cd-text truncate">{m.name}</span>
              {m.positionName && <span className="text-[10.5px] cd-text-faint shrink-0">{m.positionName}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

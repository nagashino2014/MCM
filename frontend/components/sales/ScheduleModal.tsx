"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_META,
  ASSIGNEE_ROLE_LABELS,
  SALES_BID_RESULT_LABELS,
  type ActivityAssigneeRole,
  type ActivityBid,
  type ActivityQuote,
  type SalesActivity,
  type SalesActivityType,
  type SalesBidResult,
  type SalesProjectMember,
} from "@/lib/sales/types";

interface FacilityPerson {
  id: number;
  personName: string;
  title: string | null;
  status: string;
}

interface AssigneePick {
  employeeId: string;
  name: string;
  roleKind: ActivityAssigneeRole;
}

// 담당인력 역할 토글(참석자 제외 — 참석자는 좌측 별도 항목)
const ROLE_TOGGLES: ActivityAssigneeRole[] = ["lead", "deputy", "bidding"];
// 사업장 담당자(구 접견자) 노출 일정명
const CONTACT_TYPES: SalesActivityType[] = ["telemarketing", "email", "visit", "site_briefing", "quote"];
// 장소 노출 일정명
const PLACE_TYPES: SalesActivityType[] = ["visit", "site_briefing", "proposal_meeting"];
// 참석자 노출 일정명
const ATTENDEE_TYPES: SalesActivityType[] = ["visit", "site_briefing", "proposal_meeting"];
const MIN_ASSIGNEE_RANK = 60;
const EXCLUDE_NAMES = ["한상순"]; // 조직도 트리에서 제외할 인원

export function ScheduleModal({
  theme,
  projectId,
  activity,
  defaultDate,
  people,
  snapshot,
  members,
  onClose,
  onSaved,
}: {
  theme: string;
  projectId: string;
  activity: SalesActivity | null;
  defaultDate?: string | null;
  people: FacilityPerson[];
  snapshot: OrganizationSnapshot | null;
  members: SalesProjectMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!activity;
  const [type, setType] = useState<SalesActivityType>(activity?.activityType ?? "visit");
  const [startAt, setStartAt] = useState((activity?.scheduledAt ?? (defaultDate ? `${defaultDate}T09:00` : "")).slice(0, 16));
  const [endAt, setEndAt] = useState((activity?.endedAt ?? "").slice(0, 16));
  const [summary, setSummary] = useState(activity?.summary ?? "");
  const [place, setPlace] = useState(activity?.place ?? "");
  const [progressNote, setProgressNote] = useState(activity?.progressNote ?? "");
  const [selectedPersons, setSelectedPersons] = useState<number[]>(activity?.contacts?.map((c) => c.personId) ?? []);
  const [quotes, setQuotes] = useState<ActivityQuote[]>(
    activity?.quotes?.length ? activity.quotes : [{ seq: 1, amount: null, submittedAt: null }]
  );
  const [bids, setBids] = useState<ActivityBid[]>(
    activity?.bids?.length ? activity.bids : [{ seq: 1, amount: null, biddedAt: null }]
  );
  const [bidResult, setBidResult] = useState<SalesBidResult | "">(activity?.bidResult ?? "");
  // 담당인력(정/부/입찰) + 참석자(attendee) 통합. 정/부는 프로젝트 관계자에서 상속.
  const [assignees, setAssignees] = useState<AssigneePick[]>(() => {
    if (activity?.assignees?.length) {
      return activity.assignees.map((a) => ({ employeeId: a.employeeId, name: a.employeeName ?? a.employeeId, roleKind: a.roleKind }));
    }
    return members
      .filter((m) => m.roleLabel === "정" || m.roleLabel === "부")
      .map((m) => ({ employeeId: m.employeeId, name: m.employeeName ?? m.employeeId, roleKind: (m.roleLabel === "정" ? "lead" : "deputy") as ActivityAssigneeRole }));
  });
  const [activeTarget, setActiveTarget] = useState<ActivityAssigneeRole>("lead");
  const [attendeeSlots, setAttendeeSlots] = useState(() => Math.max(1, activity?.assignees?.filter((a) => a.roleKind === "attendee").length ?? 0));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const showContacts = CONTACT_TYPES.includes(type);
  const showPlace = PLACE_TYPES.includes(type);
  const showAttendee = ATTENDEE_TYPES.includes(type);
  const showQuote = type === "quote";
  const showBid = type === "bid";
  const showBidResult = type === "result";

  const roleAssignees = assignees.filter((a) => a.roleKind !== "attendee");
  const attendees = assignees.filter((a) => a.roleKind === "attendee");

  const treeSnapshot = useMemo<OrganizationSnapshot | null>(() => {
    if (!snapshot) return null;
    const emps = snapshot.employees.filter((e) => (e.positionRankOrder ?? 0) >= MIN_ASSIGNEE_RANK && !EXCLUDE_NAMES.includes(e.name));
    const byId = new Map(snapshot.departments.map((d) => [d.deptId, d]));
    const keep = new Set<string>();
    for (const e of emps) {
      let cur: string | null = e.deptId ?? null;
      while (cur && !keep.has(cur)) {
        keep.add(cur);
        cur = byId.get(cur)?.parentDeptId ?? null;
      }
    }
    return { ...snapshot, employees: emps, departments: snapshot.departments.filter((d) => keep.has(d.deptId)) };
  }, [snapshot]);

  const onTreeSelect = (emp: OrganizationEmployeeRow) => {
    if (activeTarget === "attendee") {
      setAssignees((prev) => {
        if (prev.some((a) => a.employeeId === emp.employeeId && a.roleKind === "attendee")) return prev;
        if (prev.filter((a) => a.roleKind === "attendee").length >= 3) return prev;
        return [...prev, { employeeId: emp.employeeId, name: emp.name, roleKind: "attendee" }];
      });
      setAttendeeSlots((s) => Math.min(3, Math.max(s, attendees.length + 1)));
    } else {
      setAssignees((prev) => {
        const ex = prev.find((a) => a.employeeId === emp.employeeId && a.roleKind === activeTarget);
        if (ex) return prev.filter((a) => !(a.employeeId === emp.employeeId && a.roleKind === activeTarget));
        return [...prev, { employeeId: emp.employeeId, name: emp.name, roleKind: activeTarget }];
      });
    }
  };
  const removeAssignee = (p: AssigneePick) =>
    setAssignees((prev) => prev.filter((a) => !(a.employeeId === p.employeeId && a.roleKind === p.roleKind)));

  const num = (s: string) => (s ? Number(s.replace(/[^0-9]/g, "")) : null);
  const activePeople = people.filter((p) => p.status === "active");
  const slotCount = Math.min(3, Math.max(attendeeSlots, attendees.length));

  const submit = async () => {
    if (!startAt) {
      setErr("일시(시작)를 입력하세요.");
      return;
    }
    setSaving(true);
    setErr(null);
    const status = progressNote.trim() ? "done" : "planned";
    const keepAssignees = showAttendee ? assignees : assignees.filter((a) => a.roleKind !== "attendee");
    const body = {
      activityType: type,
      status,
      scheduledAt: startAt || null,
      endedAt: endAt || null,
      occurredAt: status === "done" ? (startAt || null) : null,
      place: showPlace ? (place.trim() || null) : null,
      summary: summary.trim() || null,
      progressNote: progressNote.trim() || null,
      quotes: showQuote ? quotes.filter((q) => q.amount != null || q.submittedAt).map((q, i) => ({ ...q, seq: i + 1 })) : [],
      bids: showBid ? bids.filter((b) => b.amount != null || b.biddedAt).map((b, i) => ({ ...b, seq: i + 1 })) : [],
      bidResult: showBidResult ? (bidResult || null) : null,
      color: ACTIVITY_TYPE_META[type].color,
      contactPersonIds: showContacts ? selectedPersons : [],
      assignees: keepAssignees.map((a) => ({ employeeId: a.employeeId, roleKind: a.roleKind })),
    };
    try {
      const url = editing ? `/api/sales/activities/${activity!.activityId}` : `/api/sales/projects/${projectId}/activities`;
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 880, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="cd-text text-lg font-extrabold">영업 스케쥴 {editing ? "수정" : "입력"}</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-5">
          {/* 좌: 일반 항목 전부 */}
          <div>
            <label className="cd-label">일정명</label>
            <select className="cd-select mb-3" value={type} onChange={(e) => setType(e.target.value as SalesActivityType)}>
              {ACTIVITY_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>

            <label className="cd-label">일시 (시작 ~ 종료)</label>
            <div className="flex items-center gap-1.5 mb-3">
              <input type="datetime-local" className="cd-input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              <span className="cd-text-faint">~</span>
              <input type="datetime-local" className="cd-input" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>

            {showPlace && (
              <>
                <label className="cd-label">장소</label>
                <input className="cd-input mb-3" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="도로명 주소" />
              </>
            )}

            <label className="cd-label">업무상세 <span className="cd-text-faint">({summary.length}/100)</span></label>
            <textarea className="cd-textarea mb-3" rows={2} maxLength={100} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="100자 이내" />

            {editing && (
              <>
                <label className="cd-label">경과 <span className="cd-text-faint">({progressNote.length}/200)</span></label>
                <textarea className="cd-textarea mb-3" rows={2} maxLength={200} value={progressNote} onChange={(e) => setProgressNote(e.target.value)} placeholder="진행상황·결과(200자 이내)" />
              </>
            )}

            {showAttendee && (
              <div className="mb-3">
                <label className="cd-label">참석자</label>
                <div className="flex items-stretch gap-1.5">
                  {Array.from({ length: slotCount }).map((_, i) => {
                    const a = attendees[i];
                    return a ? (
                      <div key={i} className="cd-input flex-1 min-w-0 flex items-center justify-between gap-1">
                        <span className="truncate text-xs">{a.name}</span>
                        <button type="button" className="cd-text-faint shrink-0" onClick={() => removeAssignee(a)}><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <button key={i} type="button" onClick={() => setActiveTarget("attendee")}
                        className="cd-input flex-1 min-w-0 text-left cd-text-faint text-xs" data-active={activeTarget === "attendee"}>선택</button>
                    );
                  })}
                  {slotCount < 3 && (
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm shrink-0"
                      onClick={() => { setAttendeeSlots((s) => Math.min(3, Math.max(s, attendees.length) + 1)); setActiveTarget("attendee"); }}>
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {activeTarget === "attendee" && <p className="cd-text-primary text-[11px] mt-1">우측 조직도에서 참석자를 클릭하세요.</p>}
              </div>
            )}

            {showContacts && (
              <div className="mb-3">
                <label className="cd-label">사업장 담당자</label>
                <div className="flex flex-wrap gap-1.5">
                  {activePeople.map((p) => {
                    const on = selectedPersons.includes(p.id);
                    return (
                      <button key={p.id} type="button" className="cd-chip cd-chip-sm" data-active={on}
                        onClick={() => setSelectedPersons((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}>
                        {p.personName}{p.title ? ` ${p.title}` : ""}
                      </button>
                    );
                  })}
                  {activePeople.length === 0 && <span className="cd-text-faint text-xs">등록된 담당자가 없습니다.</span>}
                </div>
              </div>
            )}

            {showQuote && (
              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <label className="cd-label">견적가 / 제출일시</label>
                  <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setQuotes((q) => [...q, { seq: q.length + 1, amount: null, submittedAt: null }])}><Plus className="w-3.5 h-3.5" /></button>
                </div>
                {quotes.map((q, i) => (
                  <div key={i} className="flex items-center gap-1.5 mb-1.5">
                    {quotes.length > 1 && <span className="cd-text-faint text-[11px] w-8 shrink-0">{i + 1}차</span>}
                    <input className="cd-input" placeholder="금액" inputMode="numeric" value={q.amount != null ? String(q.amount) : ""}
                      onChange={(e) => setQuotes((arr) => arr.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)))} />
                    <input type="datetime-local" className="cd-input" value={(q.submittedAt ?? "").slice(0, 16)}
                      onChange={(e) => setQuotes((arr) => arr.map((x, j) => (j === i ? { ...x, submittedAt: e.target.value || null } : x)))} />
                    {quotes.length > 1 && <button className="cd-text-faint shrink-0" onClick={() => setQuotes((arr) => arr.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
              </div>
            )}

            {showBid && (
              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <label className="cd-label">투찰가 / 투찰일시</label>
                  <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setBids((b) => [...b, { seq: b.length + 1, amount: null, biddedAt: null }])}><Plus className="w-3.5 h-3.5" /></button>
                </div>
                {bids.map((b, i) => (
                  <div key={i} className="flex items-center gap-1.5 mb-1.5">
                    {bids.length > 1 && <span className="cd-text-faint text-[11px] w-8 shrink-0">{i + 1}차</span>}
                    <input className="cd-input" placeholder="금액" inputMode="numeric" value={b.amount != null ? String(b.amount) : ""}
                      onChange={(e) => setBids((arr) => arr.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)))} />
                    <input type="datetime-local" className="cd-input" value={(b.biddedAt ?? "").slice(0, 16)}
                      onChange={(e) => setBids((arr) => arr.map((x, j) => (j === i ? { ...x, biddedAt: e.target.value || null } : x)))} />
                    {bids.length > 1 && <button className="cd-text-faint shrink-0" onClick={() => setBids((arr) => arr.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
              </div>
            )}

            {showBidResult && (
              <div className="mb-1">
                <label className="cd-label">투찰결과</label>
                <select className="cd-select" value={bidResult} onChange={(e) => setBidResult(e.target.value as SalesBidResult | "")}>
                  <option value="">미정</option>
                  {(Object.keys(SALES_BID_RESULT_LABELS) as SalesBidResult[]).map((r) => <option key={r} value={r}>{SALES_BID_RESULT_LABELS[r]}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* 우: 담당인력만 */}
          <div className="min-w-0">
            <label className="cd-label">담당인력</label>
            <div className="flex gap-1.5 mb-2">
              {ROLE_TOGGLES.map((r) => (
                <button key={r} type="button" className="cd-chip cd-chip-sm" data-active={activeTarget === r} onClick={() => setActiveTarget(r)}>
                  {ASSIGNEE_ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {roleAssignees.map((a) => (
                <span key={`${a.employeeId}-${a.roleKind}`} className="cd-pill cd-pill-info inline-flex items-center gap-1">
                  {ASSIGNEE_ROLE_LABELS[a.roleKind]}·{a.name}
                  <button onClick={() => removeAssignee(a)}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {roleAssignees.length === 0 && <span className="cd-text-faint text-xs">역할 선택 후 조직도에서 인원을 클릭하세요.</span>}
            </div>
            <OrganizationTree snapshot={treeSnapshot} embedded title="조직도" onSelectEmployee={onTreeSelect} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>닫기</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={submit} disabled={saving}>{saving ? "저장 중…" : editing ? "수정" : "입력"}</button>
        </div>
      </div>
    </div>
  );
}

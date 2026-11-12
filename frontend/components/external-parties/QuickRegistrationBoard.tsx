"use client";

// 주소록 간이 등록 목록(357, 2026-11-12 사용자 결정) — /external-parties/quick.
// 메일 주소에서 '주소록 추가'로 만든 간이 업체·담당자를 모은다. 관리자(사업장 수정 권한)는 전체를 보고
//   ① 업체는 [상세 등록]으로 사업자번호·주소 등을 넣은 뒤 [확정], ② 담당자는 등록한 직원에게 [상세정보 요청](메신저·알림)을 보낸다.
// 그 외 직원은 자기가 등록한 것만 보고 [보완]으로 담당자 정보를 채운다(요청 메시지의 링크 ?item=<id> 로 바로 열린다).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Check, MessageSquare, PenLine, UserRound } from "lucide-react";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { CdModal } from "@/components/cdash/CdModal";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdToast } from "@/components/cdash/CdToast";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { useClientPaging } from "@/components/ui/PaginationControls";
import "@/components/cdash/cdash.css";

interface QuickItem {
  quickId: number;
  kind: "facility" | "person";
  status: "pending" | "requested" | "done";
  facilityId: string;
  facilityName: string;
  facilityBrn: string | null;
  facilityAddress: string | null;
  personId: number | null;
  personName: string | null;
  title: string | null;
  departmentName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  email: string | null;
  sourceAddress: string | null;
  registeredBy: string;
  registeredByName: string | null;
  registeredAt: string;
  requestedAt: string | null;
  requestedByName: string | null;
  requestNote: string | null;
  completedAt: string | null;
  completedByName: string | null;
}

const STATUS_LABEL: Record<QuickItem["status"], string> = { pending: "간이", requested: "요청함", done: "완료" };
const STATUS_TONE = { pending: "warn", requested: "info", done: "success" } as const;

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function QuickRegistrationBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [items, setItems] = useState<QuickItem[]>([]);
  const [counts, setCounts] = useState({ open: 0, done: 0 });
  const [canReview, setCanReview] = useState(false);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [supplementing, setSupplementing] = useState<QuickItem | null>(null);
  const [requesting, setRequesting] = useState<QuickItem | null>(null);
  const paging = useClientPaging(items, "contact-quick-page-size", loading);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ items: QuickItem[]; counts: { open: number; done: number }; canReview: boolean; userId: string }>(`/api/directory/quick?status=${tab}`);
      setItems(d.items);
      setCounts(d.counts);
      setCanReview(d.canReview);
      setUserId(d.userId);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);

  // 상세정보 요청 메시지·알림의 링크(?item=<id>)로 들어오면 그 담당자의 보완 양식을 바로 연다.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("item"));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    api<{ item: QuickItem }>(`/api/directory/quick/${id}`)
      .then(({ item }) => {
        if (item.status === "done") {
          setTab("done");
          toast("이미 완료된 항목입니다.", "info");
        } else if (item.kind === "person") setSupplementing(item);
      })
      .catch((e) => setError((e as Error).message));
  }, [toast]);

  const act = async (item: QuickItem, body: Record<string, unknown>, done: string) => {
    setBusy(item.quickId);
    try {
      await api(`/api/directory/quick/${item.quickId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      toast(done, "success");
      await load();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cdash cd-fields-white p-4 md:p-5 flex flex-col gap-4 min-h-full rounded-lg" data-theme={theme}>
      <CdPageHeader
        title="간이 등록"
        helpTopic="external-parties.quick"
        meta={canReview ? `처리 대기 ${counts.open}건` : `내가 등록한 것 · 처리 대기 ${counts.open}건`}
      />
      {error && <div role="alert" className="cd-card p-3 cd-error-text">{error}</div>}
      <CdTabs
        items={[
          { key: "open", label: "처리 대기", count: counts.open || undefined },
          { key: "done", label: "완료", count: counts.done || undefined },
        ]}
        active={tab}
        onChange={(k) => setTab(k)}
      />
      <section className="cd-card p-5 flex flex-col gap-3 min-h-0" aria-label="간이 등록 목록">
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="cd-table-head">
              <tr className="text-left cd-text-faint">
                <th className="p-3">구분</th>
                <th className="p-3">업체</th>
                <th className="p-3">담당자</th>
                <th className="p-3">연락처</th>
                <th className="p-3">등록</th>
                <th className="p-3">상태</th>
                <th className="p-3 text-right">처리</th>
              </tr>
            </thead>
            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center cd-text-faint">
                    {tab === "open" ? "처리할 간이 등록이 없습니다." : "완료된 간이 등록이 없습니다."}
                  </td>
                </tr>
              )}
              {paging.pageRows.map((it) => {
                const mine = it.registeredBy === userId;
                const open = it.status !== "done";
                return (
                  <tr key={it.quickId} className="border-t cd-border-c cd-text align-top">
                    <td className="p-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {it.kind === "facility" ? <Building2 className="w-3.5 h-3.5 cd-text-faint" aria-hidden /> : <UserRound className="w-3.5 h-3.5 cd-text-faint" aria-hidden />}
                        {it.kind === "facility" ? "업체" : "담당자"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold">{it.facilityName}</div>
                      {it.kind === "facility" && (
                        <div className="text-xs cd-text-faint">{[it.facilityBrn ?? "사업자번호 없음", it.facilityAddress].filter(Boolean).join(" · ")}</div>
                      )}
                    </td>
                    <td className="p-3">
                      {it.kind === "person" ? (
                        <>
                          <div>
                            {it.personName}
                            {it.title ? ` ${it.title}` : ""}
                          </div>
                          {it.departmentName && <div className="text-xs cd-text-faint">{it.departmentName}</div>}
                        </>
                      ) : (
                        <span className="cd-text-faint">—</span>
                      )}
                    </td>
                    <td className="p-3 text-xs cd-text-muted break-all">
                      {it.kind === "person" ? [it.mobilePhone, it.officePhone, it.email].filter(Boolean).join(" · ") || "—" : it.sourceAddress ?? "—"}
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs">
                      <div>{it.registeredByName ?? "—"}</div>
                      <div className="cd-text-faint tabular-nums">{fmt(it.registeredAt)}</div>
                    </td>
                    <td className="p-3 whitespace-nowrap text-xs">
                      <CdBadge tone={STATUS_TONE[it.status]}>{STATUS_LABEL[it.status]}</CdBadge>
                      {it.status === "requested" && it.requestedAt && <div className="cd-text-faint mt-1 tabular-nums">{fmt(it.requestedAt)}</div>}
                      {it.status === "done" && it.completedByName && <div className="cd-text-faint mt-1">{it.completedByName}</div>}
                    </td>
                    <td className="p-3">
                      {open && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {it.kind === "facility" && canReview && (
                            <Link href={`/external-parties?focus=${encodeURIComponent(it.facilityId)}`} className="cd-btn cd-btn-ghost cd-btn-sm cd-action">
                              <PenLine className="w-3.5 h-3.5" /> 상세 등록
                            </Link>
                          )}
                          {it.kind === "person" && (mine || canReview) && (
                            <CdButton size="sm" icon={<PenLine className="w-3.5 h-3.5" />} onClick={() => setSupplementing(it)}>
                              보완
                            </CdButton>
                          )}
                          {it.kind === "person" && canReview && !mine && (
                            <CdButton size="sm" icon={<MessageSquare className="w-3.5 h-3.5" />} onClick={() => setRequesting(it)}>
                              상세정보 요청
                            </CdButton>
                          )}
                          {canReview && (
                            <CdButton
                              size="sm"
                              variant="soft"
                              icon={<Check className="w-3.5 h-3.5" />}
                              loading={busy === it.quickId}
                              onClick={() => void act(it, { action: "confirm" }, it.kind === "facility" ? "업체를 확정했습니다." : "담당자를 확정했습니다.")}
                            >
                              확정
                            </CdButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {paging.pager}
      </section>

      {supplementing && (
        <SupplementModal
          item={supplementing}
          onClose={() => setSupplementing(null)}
          onSave={async (person) => {
            if (await act(supplementing, { action: "supplement", person }, "담당자 정보를 보완했습니다.")) setSupplementing(null);
          }}
          saving={busy === supplementing.quickId}
        />
      )}
      {requesting && (
        <RequestModal
          item={requesting}
          onClose={() => setRequesting(null)}
          saving={busy === requesting.quickId}
          onSend={async (note) => {
            if (await act(requesting, { action: "request", note }, `${requesting.registeredByName ?? "등록 직원"}에게 상세정보 요청을 보냈습니다.`)) setRequesting(null);
          }}
        />
      )}
    </div>
  );
}

function SupplementModal({
  item,
  saving,
  onClose,
  onSave,
}: {
  item: QuickItem;
  saving: boolean;
  onClose: () => void;
  onSave: (person: Record<string, string>) => void;
}) {
  const [f, setF] = useState({
    personName: item.personName ?? "",
    title: item.title ?? "",
    departmentName: item.departmentName ?? "",
    mobilePhone: item.mobilePhone ?? "",
    officePhone: item.officePhone ?? "",
    email: item.email ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <CdModal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={`담당자 보완 — ${item.facilityName}`}
      size="md"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={() => onSave(f)}>
            보완 완료
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {item.requestNote && (
          <p className="cd-card p-3 text-[13px] cd-text">
            <span className="cd-text-faint">요청 메모{item.requestedByName ? ` (${item.requestedByName})` : ""}</span> {item.requestNote}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CdInput label="이름" required value={f.personName} onChange={set("personName")} />
          <CdInput label="직함" value={f.title} onChange={set("title")} />
          <CdInput label="부서" value={f.departmentName} onChange={set("departmentName")} placeholder="예: 환경안전팀" />
          <CdInput label="휴대폰" value={f.mobilePhone} onChange={set("mobilePhone")} />
          <CdInput label="사무실 전화" value={f.officePhone} onChange={set("officePhone")} />
          <CdInput label="이메일" value={f.email} onChange={set("email")} />
        </div>
        <p className="text-xs cd-text-faint">저장하면 간이 표시가 없어지고 주소록에 바로 반영됩니다.</p>
      </div>
    </CdModal>
  );
}

function RequestModal({ item, saving, onClose, onSend }: { item: QuickItem; saving: boolean; onClose: () => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <CdModal
      open
      onClose={onClose}
      title="상세정보 등록 요청"
      size="sm"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={() => onSend(note)}>
            요청 보내기
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] cd-text">
        <p>
          <span className="font-semibold">{item.registeredByName ?? "등록 직원"}</span>에게 메신저와 알림으로 보냅니다. 받은 직원은 링크로 보완 화면을 바로 엽니다.
        </p>
        <p className="cd-text-muted">
          {item.facilityName} · {item.personName}
          {item.title ? ` ${item.title}` : ""}
        </p>
        <CdInput label="요청 메모" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 부서와 휴대폰 번호를 알려 주세요" maxLength={500} />
      </div>
    </CdModal>
  );
}

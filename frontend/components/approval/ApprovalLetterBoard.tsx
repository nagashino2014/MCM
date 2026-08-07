"use client";

// 공문 작성(/approval/letter) — 대외 발송 공문 전용 기안 화면.
// 수신처(주소록 담당자 검색·메일 포함)·유형(일반/내용증명)·본문(MailEditor)·붙임 목록·
// 인감 날인/HWPX 동봉 옵션 + 결재선/참조자(전자결재 코어 위임). 승인 완료 시 자동 채번·
// PDF/HWPX 생성·기안자 계정 메일 발송(lib/letter/send.ts). 설계: docs/official-letter-blueprint.md.
// 결재선 패널은 ApprovalDraftBoard(:704-810)의 마크업·프리셋 로직을 이식했다(회귀 방지 위해
// 원본은 수정하지 않음 — work-plan 탭 복제와 같은 관행).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, BookmarkPlus, Eye, FileText, Plus, Save, Search, Send, Stamp, Trash2, Users, X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { MailEditor } from "@/components/mail/MailEditor";
import { recipientsDisplay } from "@/lib/letter/compose";
import {
  COMPANY_ADDRESS, COMPANY_BIZ_NO, COMPANY_CEO, COMPANY_CONTACT_EMAIL, COMPANY_KO, COMPANY_PHONE,
  LETTER_FORM_ID,
  type LetterFieldValues, type LetterLayoutOverrides, type LetterRecipient, type ProofParty,
} from "@/lib/letter/types";
import "@/components/cdash/cdash.css";

interface LineStep {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName: string;
  assigneePosition: string | null;
}

interface Watcher {
  userId: string;
  name: string;
  kind: "ref" | "view";
}

interface LinePreset {
  presetId: string;
  name: string;
  steps: { stepType: "agree" | "approve"; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }[];
  watchers: { userId: string; name: string | null; kind: "ref" | "view" }[];
}

type OrgTarget = "approve" | "ref";

interface ContactItem {
  id: number;
  personName: string;
  title: string | null;
  email: string | null;
  facilityName: string | null;
  departmentName: string | null;
}

const EMPTY_PROOF: ProofParty = { company: "", address: "", bizNo: "", representative: "" };
const SENDER_PROOF: ProofParty = { company: COMPANY_KO, address: COMPANY_ADDRESS, bizNo: COMPANY_BIZ_NO, representative: COMPANY_CEO };

interface FacilityOption {
  facilityId: string;
  companyName: string;
  businessRegistrationNo?: string | null;
  siteAddress?: string | null;
  regionSido?: string | null;
  regionSigungu?: string | null;
}

/** 수신처(업체/기관) 선택 — 사업장 검색 + 간편 신규 등록(사용자 확정: 직접 입력 대신).
 *  export: 견적서 작성(QuoteBoard, 136)이 동일 픽커를 재사용한다. */
export function FacilityRecipientPicker({
  list,
  onChange,
  onNewFacility,
}: {
  list: LetterRecipient[];
  onChange: (next: LetterRecipient[]) => void;
  onNewFacility: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FacilityOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q: q.trim(), limit: "15", sort: "name" });
      fetch(`/api/facilities?${params.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [q]);

  const add = (o: FacilityOption) => {
    onChange([
      ...list,
      {
        facilityId: o.facilityId,
        name: o.companyName,
        address: o.siteAddress ?? [o.regionSido, o.regionSigungu].filter(Boolean).join(" ") ?? "",
        bizNo: o.businessRegistrationNo ?? "",
      },
    ]);
    setQ("");
    setItems([]);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] cd-text-faint">수신처 <span className="cd-text-faint">— 업체/기관명 표기(공문 수신란). 실제 메일 발송은 참조 담당자에게 갑니다</span></span>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border cd-border-c pl-2.5 pr-1.5 py-1 text-[11.5px] cd-text">
              <span className="font-semibold">{r.name || r.facilityName}</span>
              {r.bizNo && <span className="cd-text-faint">{r.bizNo}</span>}
              <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => onChange(list.filter((_, xi) => xi !== i))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
            <input
              className="cd-input w-full"
              style={{ paddingLeft: 36 }}
              placeholder="사업장 검색(업체명 2자 이상)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
            />
          </div>
          <button
            type="button"
            className="cd-btn rounded-lg border border-dashed cd-border-c px-2.5 py-2 text-[11px] cd-text-faint shrink-0"
            title="미등록 업체 — 사업장명·소재지·사업자번호만으로 간편 등록 후 수신처로 지정"
            onClick={onNewFacility}
          >
            <Plus className="w-3 h-3 inline -mt-0.5" /> 신규 등록
          </button>
        </div>
        {open && items.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border cd-border-c bg-[color:var(--cd-card)] shadow-lg max-h-60 overflow-auto">
            {items.map((o) => (
              <button key={o.facilityId} type="button" className="w-full text-left px-3 py-2 text-[12px] cd-text cd-row-hover flex items-center gap-2" onClick={() => add(o)}>
                <span className="font-semibold truncate">{o.companyName}</span>
                <span className="ml-auto shrink-0 cd-text-faint">{o.businessRegistrationNo ?? ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 간편 사업장 등록 모달 — 영업 사업장 정보(일반현황) 신규 등록 이식(필수 3필드). */
export function QuickFacilityModal({ theme, onClose, onCreated }: { theme: string; onClose: () => void; onCreated: (r: LetterRecipient) => void }) {
  const [companyName, setCompanyName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [brn, setBrn] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!companyName.trim() || !siteAddress.trim() || !brn.trim()) {
      setErr("사업장명 · 소재지 · 사업자번호는 필수입니다.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/facilities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          siteAddress: siteAddress.trim(),
          businessRegistrationNo: brn.trim(),
          representativeName: null,
          phoneNumber: null,
          industryName: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onCreated({ facilityId: String(data.facilityId ?? ""), name: companyName.trim(), address: siteAddress.trim(), bizNo: brn.trim() });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cdash-vars cd-fields-white fixed inset-0 z-[80] flex items-center justify-center p-4" data-theme={theme} style={{ background: "rgba(15,20,34,0.45)" }} onClick={onClose}>
      <div className="rounded-2xl bg-[color:var(--cd-card)] shadow-2xl w-full max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-base font-extrabold">사업장 간편 등록</h3>
          <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {err && <div className="rounded-lg px-3 py-2 text-xs mb-3 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">{err}</div>}
        <p className="cd-text-faint text-[11px] mb-3">등록 즉시 수신처로 지정됩니다. 상세 정보는 사업장 메뉴에서 보강할 수 있습니다.</p>
        <label className="text-[11px] cd-text-faint flex flex-col gap-1 mb-2.5">
          사업장명 *
          <input className="cd-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>
        <label className="text-[11px] cd-text-faint flex flex-col gap-1 mb-2.5">
          소재지 *
          <input className="cd-input" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
        </label>
        <label className="text-[11px] cd-text-faint flex flex-col gap-1 mb-4">
          사업자번호 *
          <input className="cd-input" value={brn} onChange={(e) => setBrn(e.target.value)} placeholder="000-00-00000" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs" onClick={onClose}>취소</button>
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={saving} onClick={submit}>
            {saving ? "등록 중..." : "등록 후 수신처 지정"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 수신처/참조 입력 — 주소록 담당자 검색(메일 포함) + 수동 추가. */
export function RecipientPicker({
  label,
  hint,
  list,
  onChange,
}: {
  label: string;
  hint: string;
  list: LetterRecipient[];
  onChange: (next: LetterRecipient[]) => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ContactItem[]>([]);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<LetterRecipient>({ name: "", deptName: "", title: "", email: "", facilityName: "" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      fetch(`/api/approval/contacts?q=${encodeURIComponent(q.trim())}&limit=15`, { signal: ac.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
        .catch(() => {});
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const add = (r: LetterRecipient) => {
    if (!r.name.trim()) return;
    onChange([...list, r]);
    setQ("");
    setItems([]);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] cd-text-faint">{label} <span className="cd-text-faint">— {hint}</span></span>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-full border cd-border-c pl-2.5 pr-1.5 py-1 text-[11.5px] cd-text">
              <span className="font-semibold">{r.facilityName ? `${r.facilityName} · ` : ""}{r.name}{r.title ? ` ${r.title}` : ""}</span>
              <span className={r.email ? "cd-text-faint" : "text-[color:var(--cd-danger,#FA896B)]"}>{r.email || "메일 없음"}</span>
              <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => onChange(list.filter((_, xi) => xi !== i))}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
            <input
              className="cd-input w-full"
              style={{ paddingLeft: 36 }}
              placeholder="주소록 담당자 검색(성명·업체명 2자 이상)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
            />
          </div>
          <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-2.5 py-2 text-[11px] cd-text-faint shrink-0" onClick={() => setManual((v) => !v)}>
            <Plus className="w-3 h-3 inline -mt-0.5" /> 직접 입력
          </button>
        </div>
        {open && items.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border cd-border-c bg-[color:var(--cd-card)] shadow-lg max-h-60 overflow-auto">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                className="w-full text-left px-3 py-2 text-[12px] cd-text cd-row-hover flex items-center gap-2"
                onClick={() =>
                  add({
                    contactId: String(it.id),
                    name: it.personName,
                    deptName: it.departmentName ?? "",
                    title: it.title ?? "",
                    email: it.email ?? "",
                    facilityName: it.facilityName ?? "",
                  })
                }
              >
                <span className="font-semibold truncate">{it.facilityName ?? "-"}</span>
                <span className="truncate">{it.departmentName ? `${it.departmentName} ` : ""}{it.personName}{it.title ? ` ${it.title}` : ""}</span>
                <span className={`ml-auto shrink-0 ${it.email ? "cd-text-faint" : "text-[color:var(--cd-danger,#FA896B)]"}`}>{it.email ?? "메일 없음"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {manual && (
        <div className="rounded-xl border border-dashed cd-border-c p-2.5 grid grid-cols-2 md:grid-cols-5 gap-1.5">
          <input className="cd-input" placeholder="업체/기관명" value={draft.facilityName ?? ""} onChange={(e) => setDraft({ ...draft, facilityName: e.target.value })} />
          <input className="cd-input" placeholder="부서" value={draft.deptName ?? ""} onChange={(e) => setDraft({ ...draft, deptName: e.target.value })} />
          <input className="cd-input" placeholder="성명 *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="cd-input" placeholder="직함" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div className="flex items-center gap-1.5">
            <input className="cd-input flex-1" placeholder="메일주소" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <button
              type="button"
              className="cd-btn cd-btn-primary rounded-lg px-2.5 py-2 text-[11px] shrink-0"
              onClick={() => {
                add(draft);
                setDraft({ name: "", deptName: "", title: "", email: "", facilityName: "" });
                setManual(false);
              }}
            >
              추가
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProofPartyInputs({ label, value, onChange }: { label: string; value: ProofParty; onChange: (v: ProofParty) => void }) {
  return (
    <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text">{label}</span>
      <input className="cd-input" placeholder="주소" value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
        <input className="cd-input" placeholder="회사/기관명" value={value.company} onChange={(e) => onChange({ ...value, company: e.target.value })} />
        <input className="cd-input" placeholder="사업자번호" value={value.bizNo} onChange={(e) => onChange({ ...value, bizNo: e.target.value })} />
        <input className="cd-input" placeholder="대표자 성명" value={value.representative} onChange={(e) => onChange({ ...value, representative: e.target.value })} />
      </div>
    </div>
  );
}

export function ApprovalLetterBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const editDocId = sp.get("docId");
  /** 계약 메뉴에서 "공문으로 발송"으로 넘어온 착수계·준공계 문서 id(D3 연계) */
  const deliverableId = sp.get("deliverable");

  const [docId, setDocId] = useState<string | null>(editDocId);
  const [subject, setSubject] = useState("");
  const [letterKind, setLetterKind] = useState<"general" | "proof">("general");
  const [recipients, setRecipients] = useState<LetterRecipient[]>([]);
  const [ccRefs, setCcRefs] = useState<LetterRecipient[]>([]);
  const [proofSender, setProofSender] = useState<ProofParty>(SENDER_PROOF);
  const [proofReceiver, setProofReceiver] = useState<ProofParty>(EMPTY_PROOF);
  const [attachItems, setAttachItems] = useState<string[]>([]);
  const [stampOn, setStampOn] = useState(true);
  const [includeHwpx, setIncludeHwpx] = useState(false);
  const [contactPhone, setContactPhone] = useState(COMPANY_PHONE);
  const [contactEmail, setContactEmail] = useState(COMPANY_CONTACT_EMAIL);
  const [line, setLine] = useState<LineStep[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [presets, setPresets] = useState<LinePreset[]>([]);
  const [orgModal, setOrgModal] = useState<OrgTarget | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | "preview" | null>(null);
  const [loading, setLoading] = useState(!!editDocId);
  // 레이아웃 미세조정(사용자 확정) — 미리보기 모달에서 조정, field_values 로 저장돼 발송본에 반영
  const [overrides, setOverrides] = useState<LetterLayoutOverrides>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 수신처 간편 등록 모달 + 문서번호 표시 + 동봉 첨부
  const [facilityModal, setFacilityModal] = useState(false);
  const [docNo, setDocNo] = useState<string | null>(null); // 재편집 문서의 확정 번호
  const [nextNo, setNextNo] = useState<string | null>(null); // 신규 작성 시 채번 예정 번호
  const [fileAttachments, setFileAttachments] = useState<{ name: string; key: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingHtmlRef = useRef<string | null>(null);

  // 하단 메일 표기 — 기본값은 접속 사용자의 메일함 주소, '직접 입력' 체크 시 자유 입력(사용자 확정)
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [emailManual, setEmailManual] = useState(false);

  // 채번 예정 번호(신규 작성) — 확정은 상신 시(allocateDocNo). 재편집 문서는 확정 번호 우선.
  useEffect(() => {
    fetch("/api/letters/next-no", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.nextNo && setNextNo(d.nextNo))
      .catch(() => {});
    fetch("/api/mail/mailbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.address) setMyEmail(String(d.address));
      })
      .catch(() => {});
  }, []);

  // 사용자 메일 도착 시 — 직접 입력 모드가 아니면 하단 메일 표기를 내 주소로.
  // 재편집 문서도 저장값이 내 주소와 같으면 자동 모드로 되돌린다.
  useEffect(() => {
    if (!myEmail) return;
    if (!emailManual && !editDocId) setContactEmail(myEmail);
    setContactEmail((cur) => {
      if (cur === myEmail) setEmailManual(false);
      return cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEmail]);

  // 착수계·준공계 연계(D3) — 산출물 PDF 를 첨부로 등록하고 제목·본문·붙임·수신처를 채운다.
  // 본문이 정형화돼 있어 템플릿을 미리 넣어 두고, 사용자가 그대로 수정할 수 있다.
  useEffect(() => {
    if (!deliverableId || editDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contracts/deliverables/${encodeURIComponent(deliverableId)}/attach`, { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error ?? "착수계·준공계를 불러오지 못했습니다.");
        if (cancelled) return;
        setSubject(d.subject ?? "");
        setAttachItems(Array.isArray(d.attachItems) ? d.attachItems : []);
        if (d.attachment?.key) {
          setFileAttachments((prev) => (prev.some((f) => f.key === d.attachment.key) ? prev : [...prev, d.attachment]));
        } else if (d.storageError) {
          alert(`착수계·준공계 PDF 보관에 실패해 자동 첨부되지 않았습니다. 파일을 직접 첨부해 주세요.\n(${d.storageError})`);
        }
        if (d.recipient?.name) {
          setRecipients((prev) => (prev.length ? prev : [{ name: String(d.recipient.name), address: d.recipient.address || undefined }]));
        }
        pendingHtmlRef.current = d.bodyHtml ?? "";
        if (editorRef.current) editorRef.current.innerHTML = d.bodyHtml ?? "";
      } catch (err) {
        alert((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverableId]);

  // 재편집(임시저장/반려 문서) — field_values 복원
  useEffect(() => {
    if (!editDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/approval/docs/${encodeURIComponent(editDocId)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "문서를 불러오지 못했습니다.");
        if (cancelled) return;
        const d = data.doc;
        const v = (d.fieldValues ?? {}) as Partial<LetterFieldValues>;
        setDocNo(d.docNo ?? null);
        setFileAttachments(Array.isArray(v.file_attachments) ? v.file_attachments : []);
        setSubject(d.title ?? "");
        setLetterKind(v.letter_kind === "proof" ? "proof" : "general");
        setRecipients(Array.isArray(v.recipients) ? v.recipients : []);
        setCcRefs(Array.isArray(v.cc_refs) ? v.cc_refs : []);
        if (v.proof_sender) setProofSender(v.proof_sender);
        if (v.proof_receiver) setProofReceiver(v.proof_receiver);
        setAttachItems(Array.isArray(v.attachments_list) ? v.attachments_list.map((a) => a.text) : []);
        setStampOn(v.stamp !== 0);
        setIncludeHwpx(v.include_hwpx === 1);
        setOverrides(v.layout_overrides ?? {});
        setContactPhone(v.contact_phone || COMPANY_PHONE);
        setContactEmail(v.contact_email || COMPANY_CONTACT_EMAIL);
        if (v.contact_email) setEmailManual(true); // 재편집 — 저장값 유지(내 메일 도착 후 판별은 아래 effect)
        pendingHtmlRef.current = v.body_html ?? "";
        if (editorRef.current) editorRef.current.innerHTML = v.body_html ?? "";
        setLine(
          (d.steps ?? []).map((s: { stepType: string; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }) => ({
            stepType: s.stepType === "agree" ? "agree" : "approve",
            assigneeUserId: s.assigneeUserId,
            assigneeName: s.assigneeName ?? "",
            assigneePosition: s.assigneePosition,
          }))
        );
        setWatchers(
          (d.watchers ?? []).map((w: { userId: string; name: string | null; kind: string }) => ({
            userId: w.userId,
            name: w.name ?? "",
            kind: w.kind === "view" ? "view" : "ref",
          }))
        );
      } catch (err) {
        alert((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editDocId]);

  // 에디터 마운트 후 본문 주입(재편집 로드가 먼저 끝난 경우)
  useEffect(() => {
    if (!loading && pendingHtmlRef.current != null && editorRef.current && !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = pendingHtmlRef.current;
      pendingHtmlRef.current = null;
    }
  }, [loading]);

  // 결재선 프리셋 (ApprovalDraftBoard 이식)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/approval/line-presets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.presets)) setPresets(d.presets);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPreset = (p: LinePreset) => {
    setLine(
      p.steps.map((s) => ({
        stepType: s.stepType === "agree" ? "agree" : "approve",
        assigneeUserId: s.assigneeUserId,
        assigneeName: s.assigneeName ?? "",
        assigneePosition: s.assigneePosition,
      }))
    );
    setWatchers(p.watchers.map((w) => ({ userId: w.userId, name: w.name ?? "", kind: w.kind === "view" ? "view" : "ref" })));
  };

  const saveAsPreset = async () => {
    if (line.length === 0) {
      alert("저장할 결재선이 없습니다.");
      return;
    }
    const name = window.prompt("결재선 프리셋 이름을 입력하세요.", "");
    if (name == null) return;
    try {
      const res = await fetch("/api/approval/line-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          steps: line.map((s) => ({ stepType: s.stepType, assigneeUserId: s.assigneeUserId, assigneeName: s.assigneeName, assigneePosition: s.assigneePosition })),
          watchers: watchers.map((w) => ({ userId: w.userId, name: w.name, kind: w.kind })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "프리셋 저장 실패");
      const listRes = await fetch("/api/approval/line-presets", { cache: "no-store" });
      if (listRes.ok) setPresets((await listRes.json()).presets ?? []);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const deletePreset = async (presetId: string) => {
    try {
      await fetch(`/api/approval/line-presets?presetId=${encodeURIComponent(presetId)}`, { method: "DELETE" });
      setPresets((prev) => prev.filter((p) => p.presetId !== presetId));
    } catch {
      // 무시
    }
  };

  /** 본문 에디터 커서 위치에 HTML 삽입(공문 관용구 버튼) — MailEditor 의 insertHTML 관행. */
  const insertBodyHtml = (html: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    // 커서가 에디터 밖이면 끝으로 이동
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    document.execCommand("insertHTML", false, html);
  };

  const buildFieldValues = useCallback((): LetterFieldValues => {
    const values: LetterFieldValues = {
      letter_kind: letterKind,
      recipients,
      cc_refs: ccRefs,
      subject,
      body_html: editorRef.current?.innerHTML ?? "",
      attachments_list: attachItems.map((t, i) => ({ no: i + 1, text: t })).filter((a) => a.text.trim()),
      stamp: stampOn ? 1 : 0,
      include_hwpx: includeHwpx ? 1 : 0,
      contact_phone: contactPhone,
      contact_email: contactEmail,
    };
    if (letterKind === "proof") {
      values.proof_sender = proofSender;
      values.proof_receiver = proofReceiver;
    }
    if (fileAttachments.length) values.file_attachments = fileAttachments;
    // 첨부된 착수계·준공계 — 발송 완료 시 lib/letter/send.ts 가 이 목록으로 상태를 역기록한다
    if (deliverableId) values.deliverable_ids = [deliverableId];
    if (Object.values(overrides).some((v) => v !== undefined && v !== null)) {
      values.layout_overrides = overrides;
    }
    values.recipients_display = recipientsDisplay(values);
    values.letter_kind_display = letterKind === "proof" ? "내용증명" : "일반";
    return values;
  }, [letterKind, recipients, ccRefs, subject, attachItems, stampOn, includeHwpx, contactPhone, contactEmail, proofSender, proofReceiver, overrides, fileAttachments, deliverableId]);

  const persist = useCallback(
    // docIdOverride: 같은 턴에서 save 직후 submit 할 때 — setDocId 는 비동기라 클로저의
    // docId 가 아직 null 이어서 새 문서가 하나 더 생긴다(⚠이중 상신·채번 이중 소모 실사고).
    async (action: "save" | "submit", docIdOverride?: string): Promise<{ docId: string; docNo?: string | null }> => {
      const res = await fetch("/api/approval/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          docId: docIdOverride ?? docId,
          formId: LETTER_FORM_ID,
          title: subject,
          urgent: false,
          fieldValues: buildFieldValues(),
          line,
          watchers: watchers.map((w) => ({ userId: w.userId, kind: w.kind })),
          refDocId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setDocId(data.docId);
      // 착수계·준공계 연계(D3) — 계약 메뉴 이력에서 이 공문을 역참조할 수 있게 연결해 둔다
      if (deliverableId) {
        void fetch(`/api/contracts/deliverables/${encodeURIComponent(deliverableId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ letterDocId: data.docId }),
        }).catch(() => {});
      }
      return { docId: data.docId, docNo: data.docNo };
    },
    [docId, subject, buildFieldValues, line, watchers, deliverableId]
  );

  const validate = useCallback((): string | null => {
    if (!subject.trim()) return "제목을 입력하세요.";
    if (recipients.length === 0) return "수신처(업체/기관)를 1건 이상 지정하세요.";
    if (!ccRefs.some((r) => (r.email ?? "").includes("@"))) return "참조 담당자에 메일주소가 1건 이상 필요합니다(승인 시 참조자 메일로 자동 발송).";
    const html = editorRef.current?.innerHTML ?? "";
    if (!html.replace(/<[^>]+>|&nbsp;/g, "").trim()) return "본문을 작성하세요.";
    if (letterKind === "proof" && (!proofReceiver.company.trim() || !proofReceiver.address.trim())) return "내용증명형은 수신 주소·회사명을 입력하세요.";
    if (line.length === 0) return "결재선에 결재자를 1명 이상 추가하세요.";
    return null;
  }, [subject, recipients, ccRefs, letterKind, proofReceiver, line]);

  /** 동봉 첨부 업로드 — DnD/파일 선택 공용. 업로드 순서 = 발송 첨부 순서. */
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      const res = await fetch("/api/letters/attachments", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "첨부 업로드 실패");
      setFileAttachments((prev) => [...prev, ...(data.items ?? [])]);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  }, []);

  /** 미리보기 렌더 — 모달 iframe 에 표시. 조정값 변경 시 디바운스 자동 갱신. */
  const refreshPreview = useCallback(async () => {
    setBusy("preview");
    try {
      const res = await fetch("/api/letters/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: buildFieldValues() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? "미리보기 생성 실패");
      }
      const fitted = res.headers.get("X-Letter-Fitted") !== "0";
      const blob = await res.blob();
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      if (!fitted) alert("⚠ 본문이 A4 1장을 초과합니다(최소 폰트·간격 기준). 본문을 줄여야 상신할 수 있습니다.");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [buildFieldValues]);

  const openPreview = useCallback(() => {
    setPreviewOpen(true);
    void refreshPreview();
  }, [refreshPreview]);

  // 미세조정 변경 → 미리보기 자동 갱신(600ms 디바운스, 모달 열려 있을 때만)
  useEffect(() => {
    if (!previewOpen) return;
    const t = setTimeout(() => void refreshPreview(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides]);

  const send = useCallback(
    async (action: "save" | "submit") => {
      if (action === "submit") {
        const msg = validate();
        if (msg) {
          alert(msg);
          return;
        }
      }
      setBusy(action);
      try {
        if (action === "submit") {
          // 상신 전 A4 1장 fit 검증(서버 렌더) — 실패 시 차단
          const res = await fetch("/api/letters/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fieldValues: buildFieldValues() }),
          });
          if (res.ok && res.headers.get("X-Letter-Fitted") === "0") {
            alert("본문이 A4 1장을 초과합니다. 본문 분량을 줄인 뒤 다시 상신하세요.");
            return;
          }
        }
        // 항상 save 먼저 — 반환된 docId 를 이어지는 submit 에 명시 전달(이중 문서 생성 방지)
        const saved = await persist("save");
        if (action === "save") {
          alert("임시저장되었습니다.");
          return;
        }
        const done = await persist("submit", saved.docId);
        alert(`상신되었습니다. 공문번호: ${done.docNo}\n결재 승인이 완료되면 참조자 메일로 자동 발송됩니다.`);
        router.push("/approval");
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [validate, persist, buildFieldValues, router]
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<FileText className="w-5 h-5" />}
        eyebrow="Approval · Official Letter"
        title="공문 작성"
        subtitle="결재 승인이 완료되면 자동 채번되어 수신처 메일로 PDF 공문이 발송됩니다."
        actions={
          <Link href="/approval" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> 전자결재 홈
          </Link>
        }
      />

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          {/* 좌: 공문 내용 — 폭은 전자결재 작성 양식(273mm)과 동일 수준(사용자 확정) */}
          <div className="cd-card rounded-3xl p-5 flex-1 min-w-0 max-w-[1032px] flex flex-col gap-4">
            {/* 작성 중 공문번호 — 신규는 채번 예정 번호(상신 시 확정), 재편집은 확정 번호 */}
            <div className="flex items-center gap-2 rounded-xl border cd-border-c px-3.5 py-2">
              <FileText className="w-4 h-4 cd-text-primary shrink-0" />
              <span className="text-[12.5px] cd-text">
                문서번호 <b className="font-mono">{docNo ?? nextNo ?? "조회 중..."}</b>
              </span>
              {!docNo && <span className="text-[10.5px] cd-text-faint">채번 예정 — 상신 시 확정됩니다(먼저 상신되는 문서가 이 번호를 가져갈 수 있음)</span>}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-[11px] cd-text-faint">공문 유형</span>
                {(
                  [
                    ["general", "일반"],
                    ["proof", "내용증명"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-[12.5px] cd-text cursor-pointer">
                    <input type="radio" name="letterKind" checked={letterKind === k} onChange={() => setLetterKind(k)} /> {label}
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer" title="법인 인감 이미지를 대표이사 성명에 날인합니다. 실물 날인 발송 시 해제.">
                <input type="checkbox" checked={stampOn} onChange={(e) => setStampOn(e.target.checked)} />
                <Stamp className="w-3.5 h-3.5 cd-text-primary" /> 인감 날인
              </label>
              <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer" title="발송 메일에 PDF 외 HWPX 원본도 첨부합니다.">
                <input type="checkbox" checked={includeHwpx} onChange={(e) => setIncludeHwpx(e.target.checked)} /> HWPX 동봉
              </label>
            </div>

            <FacilityRecipientPicker
              list={recipients}
              onChange={(next) => {
                setRecipients(next);
                // 내용증명형 수신 정보 자동 채움 — 첫 수신처의 소재지·사업자번호
                const first = next[0];
                if (first && letterKind === "proof" && !proofReceiver.company.trim()) {
                  setProofReceiver({ company: first.name, address: first.address ?? "", bizNo: first.bizNo ?? "", representative: "" });
                }
              }}
              onNewFacility={() => setFacilityModal(true)}
            />
            <RecipientPicker label="참조" hint="담당자 표기 + 승인 완료 시 이 메일주소로 공문 발송(To)" list={ccRefs} onChange={setCcRefs} />

            {letterKind === "proof" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                <ProofPartyInputs label="발신(당사)" value={proofSender} onChange={setProofSender} />
                <ProofPartyInputs label="수신(상대방)" value={proofReceiver} onChange={setProofReceiver} />
              </div>
            )}

            <label className="text-[11px] cd-text-faint flex flex-col gap-1">
              제목
              <input className="cd-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: ○○ 용역 기성금 청구 관련" />
            </label>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] cd-text-faint">본문 — A4 1장 기준으로 자동 조판됩니다(초과 시 폰트·간격 자동 축소, 그래도 넘치면 상신 불가)</span>
                {/* 공문 관용구 빠른 삽입 — 정렬(아래=가운데·단위=오른쪽)이 규격대로 적용된 요소를 커서 위치에 넣는다 */}
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px] cd-text-faint"
                    title="'- 아 래 -' 관용구를 커서 위치에 삽입(가운데 정렬)"
                    onClick={() => insertBodyHtml('<div><br></div><div style="text-align:center">-&nbsp;&nbsp;아&nbsp;&nbsp;&nbsp;래&nbsp;&nbsp;-</div>')}
                  >
                    ＋ 아래 표기
                  </button>
                  <button
                    type="button"
                    className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px] cd-text-faint"
                    title="'단위 : 원 (VAT 별도)' 표기를 커서 위치에 삽입(오른쪽 정렬 — 표 바로 위에 두세요)"
                    onClick={() => insertBodyHtml('<div style="text-align:right">단위 : 원 (VAT 별도)</div>')}
                  >
                    ＋ 단위 표기
                  </button>
                </span>
              </div>
              <div className="rounded-xl border cd-border-c overflow-hidden">
                <MailEditor ref={editorRef} onInput={() => {}} minHeightPx={340} />
              </div>
            </div>

            {/* 붙임 목록 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] cd-text-faint">붙임 (번호는 자동 부여·일렬종대 정렬)</span>
              {attachItems.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono cd-text-faint w-5 text-right">{i + 1}.</span>
                  <input
                    className="cd-input flex-1"
                    value={t}
                    placeholder="예: 대금청구서  1부"
                    onChange={(e) => setAttachItems((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                  />
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setAttachItems((prev) => prev.filter((_, xi) => xi !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint self-start" onClick={() => setAttachItems((prev) => [...prev, ""])}>
                ＋ 붙임 추가
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                하단 전화 표기
                <input className="cd-input" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </label>
              <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  하단 메일 표기
                  <span className="flex items-center gap-1 cd-text cursor-pointer" title="기본은 접속 계정의 메일 주소입니다">
                    <input
                      type="checkbox"
                      checked={emailManual}
                      onChange={(e) => {
                        setEmailManual(e.target.checked);
                        if (!e.target.checked && myEmail) setContactEmail(myEmail);
                      }}
                    />
                    직접 입력
                  </span>
                </span>
                <input
                  className="cd-input disabled:opacity-60"
                  value={contactEmail}
                  disabled={!emailManual}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </label>
            </div>

            {/* 첨부서류 — 공문과 함께 참조자 메일로 순서대로 발송. (추후 대금청구서·준공계·착수계 작성 기능 배치 예정) */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] cd-text-faint">
                첨부서류 — 공문 PDF 뒤에 첨부 순서대로 메일에 동봉됩니다. 총 7MB 초과 시 다운로드 링크(7일 유효)로 자동 전환 (총 200MB 까지)
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <label
                  className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center ${
                    dragOver ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                >
                  <Plus className="w-5 h-5 cd-text-faint" />
                  <span className="text-[12px] cd-text">{uploading ? "업로드 중..." : "파일을 끌어다 놓거나 클릭해 선택"}</span>
                  <span className="text-[10.5px] cd-text-faint">대금청구서·준공계 등 동봉 서류</span>
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div className="rounded-xl border cd-border-c p-2.5 min-h-[104px] flex flex-col gap-1 overflow-auto">
                  {fileAttachments.length === 0 ? (
                    <p className="text-[11.5px] cd-text-faint m-auto">첨부된 파일이 없습니다.</p>
                  ) : (
                    fileAttachments.map((f, i) => (
                      <div key={f.key} className="flex items-center gap-2 rounded-lg border cd-border-c px-2.5 py-1.5">
                        <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                        <span className="text-[12px] cd-text truncate flex-1" title={f.name}>{f.name}</span>
                        <span className="text-[10.5px] cd-text-faint shrink-0">{(f.size / 1024 / 1024).toFixed(2)}MB</span>
                        <button
                          type="button"
                          className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                          onClick={() => setFileAttachments((prev) => prev.filter((_, xi) => xi !== i))}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 우: 결재선(ApprovalDraftBoard 이식) */}
          <div className="cd-card rounded-3xl p-5 w-full xl:w-[320px] shrink-0 flex flex-col gap-3">
            <h3 className="font-bold cd-text text-sm flex items-center gap-2">
              <Users className="w-4 h-4 cd-text-primary" /> 결재선
              <span className="ml-auto text-[11px] font-normal cd-text-faint">기안 → 위에서 아래 순서</span>
            </h3>

            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10.5px] cd-text-faint mr-0.5">불러오기</span>
                {presets.map((p) => (
                  <span key={p.presetId} className="inline-flex items-center rounded-full border cd-border-c overflow-hidden">
                    <button type="button" className="text-[11px] px-2 py-0.5 hover:cd-tint-primary" onClick={() => applyPreset(p)} title="이 결재선 불러오기">
                      {p.name}
                    </button>
                    <button type="button" className="text-[10px] px-1 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => deletePreset(p.presetId)} title="프리셋 삭제">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {line.length === 0 && <p className="text-[12px] cd-text-faint">아래 버튼으로 합의/승인 결재자를 추가하세요.</p>}
            <div className="flex flex-col gap-1.5">
              {line.map((s, i) => (
                <div key={`${s.assigneeUserId}-${i}`} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                  <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                  <select
                    className="cd-select"
                    style={{ width: 70 }}
                    value={s.stepType}
                    onChange={(e) => setLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, stepType: e.target.value as "agree" | "approve" } : x)))}
                  >
                    <option value="agree">합의</option>
                    <option value="approve">승인</option>
                  </select>
                  <span className="text-[12.5px] cd-text truncate flex-1">
                    {s.assigneeName}
                    {s.assigneePosition ? <span className="cd-text-faint text-[11px]"> {s.assigneePosition}</span> : null}
                  </span>
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="제거" onClick={() => setLine((prev) => prev.filter((_, xi) => xi !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint flex-1" onClick={() => setOrgModal("approve")}>
                ＋ 결재자 추가
              </button>
              <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2 text-[11px] cd-text-faint flex items-center gap-1" onClick={saveAsPreset} title="현재 결재선·참조자를 프리셋으로 저장">
                <BookmarkPlus className="w-3.5 h-3.5" /> 프리셋 저장
              </button>
            </div>

            {/* 참조/열람자 */}
            <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
              <h4 className="font-bold cd-text text-[12.5px] flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 cd-text-primary" /> 참조 · 열람
                <span className="ml-auto text-[10px] font-normal cd-text-faint">사내 참조(결재 시스템)</span>
              </h4>
              {watchers.length === 0 ? (
                <p className="text-[11px] cd-text-faint">필요 시 사내 참조/열람자를 지정하세요(선택).</p>
              ) : (
                watchers.map((w, i) => (
                  <div key={`${w.userId}-${i}`} className="rounded-xl border cd-border-c px-3 py-1.5 flex items-center gap-2">
                    <select
                      className="cd-select"
                      style={{ width: 66 }}
                      value={w.kind}
                      onChange={(e) => setWatchers((prev) => prev.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as "ref" | "view" } : x)))}
                    >
                      <option value="ref">참조</option>
                      <option value="view">열람</option>
                    </select>
                    <span className="text-[12px] cd-text truncate flex-1">{w.name}</span>
                    <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="제거" onClick={() => setWatchers((prev) => prev.filter((_, xi) => xi !== i))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint" onClick={() => setOrgModal("ref")}>
                ＋ 참조/열람자 추가
              </button>
            </div>

            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("save")}
              >
                <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "임시저장"}
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={openPreview}
                title="현재 내용을 A4 공문 PDF 로 미리보기 — 인감 위치·폰트·줄 간격 미세조정 가능"
              >
                <FileText className="w-3.5 h-3.5" /> {busy === "preview" ? "생성 중..." : "미리보기·조정"}
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("submit")}
              >
                <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
              </button>
            </div>
            <p className="text-[10.5px] cd-text-faint">승인 완료 시 공문번호 채번 → PDF/HWPX 생성 → 기안자 명의 메일 자동 발송 순으로 처리됩니다.</p>
          </div>
        </div>
      )}

      {/* 미리보기 + 레이아웃 미세조정 모달 — 조정값은 저장/상신 시 문서에 실려 발송본에 반영 */}
      {previewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={() => setPreviewOpen(false)}>
          <div className="rounded-2xl bg-[color:var(--cd-card)] shadow-2xl w-full max-w-[1500px] h-[94vh] flex overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 min-w-0 bg-[color:var(--cd-surface)]">
              {previewUrl ? (
                <iframe title="공문 미리보기" src={previewUrl} className="w-full h-full" />
              ) : (
                <div className="flex items-center justify-center h-full cd-text-faint text-sm">미리보기 생성 중...</div>
              )}
            </div>
            <div className="w-[264px] shrink-0 border-l cd-border-c p-4 flex flex-col gap-3 overflow-auto">
              <div className="flex items-center">
                <h4 className="font-bold cd-text text-[13px]">레이아웃 미세조정</h4>
                <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c p-1.5" onClick={() => setPreviewOpen(false)}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10.5px] cd-text-faint">조정하면 미리보기가 자동 갱신됩니다. 조정값은 문서에 저장되어 승인 후 발송본(PDF·HWPX)에 동일 적용됩니다.</p>

              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold cd-text">인감 위치 (기준: 성명 오른쪽 끝)</span>
                <div className="grid grid-cols-3 gap-1 w-[132px] self-center">
                  <span />
                  <button type="button" className="cd-btn rounded-lg border cd-border-c py-1 text-[11px]" onClick={() => setOverrides((o) => ({ ...o, stampDy: (o.stampDy ?? 0) + 2 }))}>▲</button>
                  <span />
                  <button type="button" className="cd-btn rounded-lg border cd-border-c py-1 text-[11px]" onClick={() => setOverrides((o) => ({ ...o, stampDx: (o.stampDx ?? 0) - 2 }))}>◀</button>
                  <span className="text-[10px] cd-text-faint self-center text-center">2pt</span>
                  <button type="button" className="cd-btn rounded-lg border cd-border-c py-1 text-[11px]" onClick={() => setOverrides((o) => ({ ...o, stampDx: (o.stampDx ?? 0) + 2 }))}>▶</button>
                  <span />
                  <button type="button" className="cd-btn rounded-lg border cd-border-c py-1 text-[11px]" onClick={() => setOverrides((o) => ({ ...o, stampDy: (o.stampDy ?? 0) - 2 }))}>▼</button>
                  <span />
                </div>
                <span className="text-[10.5px] cd-text-faint text-center">
                  가로 {overrides.stampDx ?? 0}pt · 세로 {overrides.stampDy ?? 0}pt
                  <button type="button" className="ml-1.5 underline" onClick={() => setOverrides((o) => ({ ...o, stampDx: undefined, stampDy: undefined }))}>초기화</button>
                </span>
              </div>

              <label className="text-[11px] font-semibold cd-text flex flex-col gap-1">
                본문 글자 크기
                <select
                  className="cd-select"
                  value={overrides.bodyFontPt ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, bodyFontPt: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">자동 (A4 1장 맞춤)</option>
                  {[9, 9.5, 10, 10.5, 11, 11.5, 12].map((v) => (
                    <option key={v} value={v}>{v}pt</option>
                  ))}
                </select>
              </label>

              <label className="text-[11px] font-semibold cd-text flex flex-col gap-1">
                본문 줄 간격
                <select
                  className="cd-select"
                  value={overrides.lineSpacingPct ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, lineSpacingPct: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">자동 (기본)</option>
                  {[140, 150, 160, 170, 180, 190, 200].map((v) => (
                    <option key={v} value={v}>{v}%</option>
                  ))}
                </select>
              </label>

              <label className="text-[11px] font-semibold cd-text flex flex-col gap-1">
                서명줄 높이
                <select
                  className="cd-select"
                  value={overrides.gapLevel ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, gapLevel: e.target.value === "" ? undefined : (Number(e.target.value) as 0 | 1 | 2) }))}
                >
                  <option value="">자동</option>
                  <option value="0">기본 위치</option>
                  <option value="1">아래로(간격 축소)</option>
                  <option value="2">최하단</option>
                </select>
              </label>

              <label className="text-[11px] font-semibold cd-text flex flex-col gap-1">
                제목 글자 크기
                <select
                  className="cd-select"
                  value={overrides.subjectPt ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, subjectPt: e.target.value ? Number(e.target.value) : undefined }))}
                >
                  <option value="">자동 (자간→크기 축소)</option>
                  {[8, 8.5, 9, 9.5, 10, 10.5, 11].map((v) => (
                    <option key={v} value={v}>{v}pt</option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1.5 mt-auto pt-2">
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex-1" onClick={() => setOverrides({})}>
                  전체 초기화
                </button>
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-2 text-xs flex-1 disabled:opacity-50" disabled={busy === "preview"} onClick={() => void refreshPreview()}>
                  {busy === "preview" ? "갱신 중..." : "새로고침"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 사업장 간편 등록(수신처) — 영업 사업장 정보 신규 등록 이식 */}
      {facilityModal && (
        <QuickFacilityModal
          theme={theme}
          onClose={() => setFacilityModal(false)}
          onCreated={(r) => {
            setRecipients((prev) => [...prev, r]);
            if (letterKind === "proof" && !proofReceiver.company.trim()) {
              setProofReceiver({ company: r.name, address: r.address ?? "", bizNo: r.bizNo ?? "", representative: "" });
            }
          }}
        />
      )}

      {/* 조직도 선택 모달(공용) */}
      <OrgPickerModal
        open={orgModal != null}
        title={orgModal === "ref" ? "참조/열람자 추가 — 조직도에서 선택" : "결재자 추가 — 조직도에서 선택"}
        hint={orgModal === "ref" ? "인원을 클릭하면 참조/열람자로 추가됩니다." : "인원을 클릭하면 결재선 맨 뒤에 추가됩니다. 타입(합의/승인)은 목록에서 변경하세요."}
        onClose={() => setOrgModal(null)}
        onSelect={(emp) => {
          if (!orgModal) return;
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          const userId = emp.userId;
          if (orgModal === "ref") {
            setWatchers((prev) => (prev.some((w) => w.userId === userId) ? prev : [...prev, { userId, name: emp.name, kind: "ref" }]));
          } else {
            setLine((prev) =>
              prev.some((s) => s.assigneeUserId === userId)
                ? prev
                : [...prev, { stepType: "approve", assigneeUserId: userId, assigneeName: emp.name, assigneePosition: emp.positionName }]
            );
          }
        }}
      />
    </div>
  );
}

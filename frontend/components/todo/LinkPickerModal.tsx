"use client";

// 관련(연결) 선택 모달 — 할 일 상세 '관련' 프레임의 연결 추가·변경. 사용자는 개별 ID를 모르므로 종류별 검색·목록에서 고른다.
// 종류: 계약(ContractPicker 공용) · 사업장(/api/facilities?q=) · 결재 문서(/api/approval/docs box=4종 합집합을 클라이언트 필터)
//      · 영업(/api/sales/projects?q=) · 업무추진계획(/api/work-plan/my-tasks + dept-tasks 합집합) · URL(주소+표시명).
// 지시(directive)는 목록 API 가 부서 id 필수라 여기서 제외한다. 결과 onPick({ linkKind, linkId, linkLabel }) — 저장 계약은 PATCH /api/todo/items/[id] 그대로.
// 권한이 없는 종류(결재·영업·업무추진계획은 401/403 가능)는 "권한이 없어 검색할 수 없습니다"로 남긴다.

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Building2, ClipboardList, FileCheck2, FileSignature, Link2, Search } from "lucide-react";
import { CdButton, CdInput, CdModal } from "@/components/cdash";
import { DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import { SALES_STAGE_LABELS, type SalesProject } from "@/lib/sales/types";
import { TODO_LINK_KIND_LABELS, type TodoLinkKind } from "@/lib/todo/types";
import { ContractPicker } from "./ContractPicker";

// mail·chat(§26-1)은 메일/메신저 화면의 [할 일로]에서만 붙는다 — 피커 대상이 아니다.
export type LinkPickKind = Exclude<TodoLinkKind, "directive" | "mail" | "chat">;
export const LINK_PICK_KINDS: LinkPickKind[] = ["contract", "facility", "approval_doc", "sales_project", "work_task", "url"];

const KIND_ICONS: Record<LinkPickKind, typeof Link2> = {
  contract: FileSignature,
  facility: Building2,
  approval_doc: FileCheck2,
  sales_project: Briefcase,
  work_task: ClipboardList,
  url: Link2,
};

const PLACEHOLDER: Record<Exclude<LinkPickKind, "contract" | "url">, string> = {
  facility: "회사명·사업장명으로 검색 (비우면 이름순 상위 30건)",
  approval_doc: "제목·문서번호·양식명으로 검색 (내 기안·결재 문서)",
  sales_project: "영업건·업체명으로 검색 (비우면 진행 중 상위 30건)",
  work_task: "Task 이름·분류로 검색 (내 Task·부서 Task)",
};

export interface LinkPick {
  linkKind: TodoLinkKind;
  linkId: string | null;
  linkLabel: string | null;
}

interface Hit {
  id: string;
  title: string;
  sub: string;
}

interface FacilityRow {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  industryName: string | null;
}
interface DocRow {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  status: string;
  drafterName: string | null;
  updatedAt: string;
}
interface TaskRow {
  taskId: string;
  taskName: string;
  categoryName: string | null;
  status: string;
  lastStage: string | null;
  completed: boolean;
}

class DeniedError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new DeniedError("권한이 없어 검색할 수 없습니다.");
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) || `요청에 실패했습니다 (${res.status})`);
  return data as T;
}

const joinSub = (parts: (string | null | undefined)[]): string => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
const LIMIT = 30;

export function LinkPickerModal({ open, onClose, onPick, initialKind }: { open: boolean; onClose: () => void; onPick: (pick: LinkPick) => void; initialKind?: TodoLinkKind | null }) {
  const [kind, setKind] = useState<LinkPickKind>("contract");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [sel, setSel] = useState<Hit | null>(null);
  const [url, setUrl] = useState("");
  const [urlLabel, setUrlLabel] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  // 결재·업무추진계획은 서버 검색이 없어 한 번 받은 전체를 두고 클라이언트에서 거른다(모달 열림 동안 유지).
  const docsCache = useRef<DocRow[] | null>(null);
  const tasksCache = useRef<TaskRow[] | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind && initialKind !== "directive" && initialKind !== "mail" && initialKind !== "chat" ? initialKind : "contract");
    setQ("");
    setHits([]);
    setSel(null);
    setError(null);
    setDenied(false);
    setUrl("");
    setUrlLabel("");
    setUrlError(null);
    docsCache.current = null;
    tasksCache.current = null;
  }, [open, initialKind]);

  const changeKind = (k: LinkPickKind) => {
    setKind(k);
    setQ("");
    setHits([]);
    setSel(null);
    setError(null);
    setDenied(false);
  };

  // 검색(디바운스 300ms) — 빈 검색은 상위 30건, 1자는 대기, 2자 이상 검색.
  useEffect(() => {
    if (!open || kind === "contract" || kind === "url") return;
    const term = q.trim();
    if (term.length === 1) return;
    const id = ++reqId.current;
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        let out: Hit[] = [];
        if (kind === "facility") {
          const d = await getJson<{ items?: FacilityRow[] }>(`/api/facilities?q=${encodeURIComponent(term)}&limit=${LIMIT}&sort=name`);
          out = (d.items ?? []).map((f) => ({
            id: f.facilityId,
            title: f.companyName,
            sub: joinSub([[f.regionSido, f.regionSigungu].filter(Boolean).join(" ") || f.siteAddress, f.industryName]),
          }));
        } else if (kind === "approval_doc") {
          if (!docsCache.current) {
            const boxes = ["in_progress", "completed", "pending", "acted"];
            const lists = await Promise.all(boxes.map((b) => getJson<{ docs?: DocRow[] }>(`/api/approval/docs?box=${b}`)));
            const seen = new Set<string>();
            const all: DocRow[] = [];
            for (const l of lists) for (const d of l.docs ?? []) if (!seen.has(d.docId)) {
              seen.add(d.docId);
              all.push(d);
            }
            all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
            docsCache.current = all.slice(0, 100);
          }
          const s = term.toLowerCase();
          out = docsCache.current
            .filter((d) => !s || `${d.title} ${d.docNo ?? ""} ${d.formName}`.toLowerCase().includes(s))
            .slice(0, LIMIT)
            .map((d) => ({ id: d.docId, title: d.docNo ? `${d.title} (${d.docNo})` : d.title, sub: joinSub([d.formName, d.docNo, DOC_STATUS_LABEL[d.status] ?? d.status, d.drafterName]) }));
        } else if (kind === "sales_project") {
          const d = await getJson<{ projects?: SalesProject[] }>(term ? `/api/sales/projects?q=${encodeURIComponent(term)}` : "/api/sales/projects?status=open");
          out = (d.projects ?? []).slice(0, LIMIT).map((p) => ({
            id: p.projectId,
            title: joinSub([p.title, p.facilityName]),
            sub: joinSub([SALES_STAGE_LABELS[p.stage] ?? p.stage, p.status === "closed" ? "종결" : null, p.ownerEmployeeName ?? p.leadMemberName]),
          }));
        } else if (kind === "work_task") {
          if (!tasksCache.current) {
            const mine = await getJson<{ tasks?: TaskRow[] }>("/api/work-plan/my-tasks");
            // 부서 Task 는 보조(실패해도 내 Task 만으로 진행)
            const dept = await getJson<{ tasks?: TaskRow[] }>("/api/work-plan/dept-tasks").catch(() => ({ tasks: [] as TaskRow[] }));
            const seen = new Set<string>();
            const all: TaskRow[] = [];
            for (const t of [...(mine.tasks ?? []), ...(dept.tasks ?? [])]) if (!seen.has(t.taskId)) {
              seen.add(t.taskId);
              all.push(t);
            }
            tasksCache.current = all;
          }
          const s = term.toLowerCase();
          out = tasksCache.current
            .filter((t) => !s || `${t.taskName} ${t.categoryName ?? ""}`.toLowerCase().includes(s))
            .slice(0, LIMIT)
            .map((t) => ({ id: t.taskId, title: t.taskName, sub: joinSub([t.completed ? "완료" : t.status === "active" ? "진행" : t.status, t.categoryName, t.lastStage]) }));
        }
        if (reqId.current === id) setHits(out);
      } catch (e) {
        if (reqId.current !== id) return;
        setHits([]);
        if (e instanceof DeniedError) setDenied(true);
        else setError((e as Error).message);
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, kind, q]);

  const preview = useMemo(() => {
    if (kind === "url") return url.trim() ? { k: "링크", t: urlLabel.trim() || url.trim() } : null;
    return sel ? { k: TODO_LINK_KIND_LABELS[kind], t: sel.title } : null;
  }, [kind, sel, url, urlLabel]);

  const submit = () => {
    if (kind === "url") {
      const u = url.trim();
      if (!/^https?:\/\//i.test(u)) {
        setUrlError("주소는 http:// 또는 https:// 로 시작해야 합니다.");
        return;
      }
      onPick({ linkKind: "url", linkId: u, linkLabel: urlLabel.trim() || u });
      return;
    }
    if (!sel) return;
    onPick({ linkKind: kind, linkId: sel.id, linkLabel: sel.title });
  };

  const Icon = KIND_ICONS[kind];
  const term = q.trim();

  const list = () => {
    if (denied) return <div className="todo-lp-denied">권한이 없어 검색할 수 없습니다.</div>;
    if (error) return <div className="todo-lp-denied cd-error-text">{error}</div>;
    if (loading && hits.length === 0)
      return (
        <div className="todo-lp-skel" aria-busy="true" aria-label="불러오는 중">
          <i />
          <i />
          <i />
        </div>
      );
    if (term.length === 1) return <div className="todo-empty">2자 이상 입력하세요.</div>;
    if (hits.length === 0) return <div className="todo-empty">검색 결과가 없습니다.</div>;
    return hits.map((h) => (
      <button key={h.id} type="button" role="option" aria-selected={sel?.id === h.id} className="todo-lp-row" onClick={() => setSel(h)}>
        <Icon aria-hidden="true" />
        <span className="todo-lp-tx">
          <span className="todo-lp-t">{h.title}</span>
          {h.sub && <span className="todo-lp-s">{h.sub}</span>}
        </span>
      </button>
    ));
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="연결 선택"
      size="lg"
      closeOnBackdrop={false}
      footer={
        <>
          {preview ? (
            <span className="todo-lp-pv mr-auto" aria-live="polite">
              <span className="todo-lp-pvk">연결 · {preview.k}</span>
              <b>{preview.t}</b>
            </span>
          ) : (
            <span className="todo-lp-pv mr-auto">
              <span className="todo-lp-pvk">{kind === "url" ? "주소를 입력하세요" : "목록에서 고르세요"}</span>
            </span>
          )}
          <CdButton variant="ghost" onClick={onClose}>
            취소
          </CdButton>
          <CdButton variant="primary" disabled={kind === "url" ? !url.trim() : !sel} onClick={submit}>
            연결
          </CdButton>
        </>
      }
    >
      <div className="todo-vars todo-modal todo-lp">
        <div className="todo-modal-seg overflow-hidden" role="radiogroup" aria-label="연결 종류">
          {LINK_PICK_KINDS.map((k) => {
            const KIcon = KIND_ICONS[k];
            return (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className="cd-choice" data-active={kind === k ? "true" : undefined} onClick={() => changeKind(k)}>
                <KIcon aria-hidden="true" />
                {TODO_LINK_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>

        {/* 본문 고정 높이(todo-lp-body 370px, 측정값은 todo.css 주석) — 종류를 바꿔도 모달 높이가 변하지 않는다. 짧은 탭(링크)은 위 정렬. */}
        <div className="todo-lp-body">
          {kind === "contract" && (
            <ContractPicker active={open && kind === "contract"} selectedId={sel?.id ?? null} onSelect={(c) => setSel({ id: c.contractId, title: c.contractTitle, sub: c.counterpartyName })} />
          )}

          {kind === "url" && (
            <>
              <CdInput
                label="주소"
                required
                placeholder="https://…"
                value={url}
                error={urlError ?? undefined}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <CdInput label="표시 이름(선택)" placeholder="비우면 주소가 그대로 보입니다" value={urlLabel} maxLength={120} onChange={(e) => setUrlLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            </>
          )}

          {kind !== "contract" && kind !== "url" && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" aria-hidden="true" />
                <input className="cd-input !pl-8" value={q} placeholder={PLACEHOLDER[kind]} aria-label={`${TODO_LINK_KIND_LABELS[kind]} 검색`} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              <div className="todo-lp-list" role="listbox" aria-label={`${TODO_LINK_KIND_LABELS[kind]} 목록`}>
                {list()}
              </div>
            </>
          )}
        </div>
      </div>
    </CdModal>
  );
}

"use client";

// 프로젝트 보드 생성 모달(§19-11) — 상단 세그먼트 3개: 계약관리에서 선택 / 직접 입력 / 자체 수행 프로젝트.
// (a) 계약 선택: ContractPicker(트리 또는 후보 검색 폴백 — LinkPickerModal 과 공용). 선택 시 미리보기(용역명·발주처·사업장·수행인력 자동 멤버·기존 보드 안내).
// (b) 직접 입력: 프로젝트명(필수)·업체명·사업장(/api/facilities?q= 자동완성, 선택). (c) 자체 수행: 프로젝트명만.
// 공통: 색 견본(파스텔 8색, 기본 자동)·보드 종류(프로젝트/부서 — 부서는 서버가 거절하면 안내). 생성 → POST /api/todo/boards → onCreated(board).

import { useEffect, useMemo, useState } from "react";
import { Building2, Check, FileSignature, Folder, PenLine, Search } from "lucide-react";
import { CdButton, CdInput, CdModal, useCdToast } from "@/components/cdash";
import {
  TODO_BOARD_COLORS,
  TODO_BOARD_COLOR_KEYS,
  TODO_BOARD_COLOR_LABELS,
  TODO_BOARD_MODES,
  type TodoBoard,
  type TodoBoardColorKey,
  type TodoBoardCreateInput,
  type TodoBoardMode,
  type TodoCompleteRules,
  type TodoContractCandidate,
} from "@/lib/todo/types";
import { ContractPicker, type TreeContract } from "./ContractPicker";
import { CompleteRulesFields } from "./CompleteRulesFields";
import { apiCall } from "./useTodoData";

/** /api/facilities 응답 행({ items: FacilityListItem[] }, camelCase) — LinkPickerModal 의 사업장 탭과 같은 shape. */
interface FacilityHit {
  facilityId: string;
  companyName: string;
  regionSido?: string | null;
  regionSigungu?: string | null;
  siteAddress?: string | null;
}

export interface BoardCreateModalProps {
  open: boolean;
  boards: TodoBoard[];
  onClose: () => void;
  onCreated: (board: TodoBoard) => void;
  /** "이미 보드가 있습니다 → 열기" */
  onOpenBoard: (boardId: string) => void;
}

const MODE_LABELS: Record<TodoBoardMode, string> = { contract: "계약관리에서 선택", manual: "직접 입력", internal: "자체 수행 프로젝트" };
const MODE_ICONS: Record<TodoBoardMode, typeof FileSignature> = { contract: FileSignature, manual: PenLine, internal: Folder };

export function BoardCreateModal({ open, boards, onClose, onCreated, onOpenBoard }: BoardCreateModalProps) {
  const { toast } = useCdToast();
  const [mode, setMode] = useState<TodoBoardMode>("contract");
  const [kind, setKind] = useState<"project" | "dept">("project");
  const [color, setColor] = useState<TodoBoardColorKey | null>(null);
  const [name, setName] = useState("");
  const [defaultRules, setDefaultRules] = useState<TodoCompleteRules>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (a) 계약 선택 — 트리·검색은 ContractPicker 가 맡고 여기는 선택 결과만 든다
  const [selected, setSelected] = useState<TreeContract | null>(null);
  const [cand, setCand] = useState<TodoContractCandidate | null>(null);

  // (b) 직접 입력
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [facilityQ, setFacilityQ] = useState("");
  const [facility, setFacility] = useState<FacilityHit | null>(null);
  const [facilityHits, setFacilityHits] = useState<FacilityHit[]>([]);

  useEffect(() => {
    if (!open) return;
    setMode("contract");
    setKind("project");
    setColor(null);
    setName("");
    setDefaultRules({});
    setError(null);
    setSelected(null);
    setCand(null);
    setProjectName("");
    setClientName("");
    setFacilityQ("");
    setFacility(null);
    setFacilityHits([]);
  }, [open]);

  // 트리에서 고른 계약의 보강 정보(사업장·수행인력·기존 보드)는 후보 API 에서 가져온다
  useEffect(() => {
    if (!selected) {
      setCand(null);
      return;
    }
    let cancelled = false;
    apiCall<{ contracts: TodoContractCandidate[] }>(`/api/todo/boards/contract-candidates?q=${encodeURIComponent(selected.contractTitle)}&limit=20`)
      .then((d) => {
        if (cancelled) return;
        setCand((d.contracts ?? []).find((c) => c.contractId === selected.contractId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setCand(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // 사업장 자동완성 — 계약 등록 모달과 같은 /api/facilities?q=
  useEffect(() => {
    const s = facilityQ.trim();
    if (!open || mode !== "manual" || s.length < 2 || facility) {
      setFacilityHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/facilities?q=${encodeURIComponent(s)}&limit=8&sort=name`, { cache: "no-store" });
        const data = await res.json();
        // 실제 응답은 { items: [...] } camelCase(facilityId·companyName) — 예전엔 data.facilities/facility_id 로 읽어 항상 비어 보였다.
        const rows: FacilityHit[] = Array.isArray(data?.items) ? data.items : [];
        setFacilityHits(rows.filter((f) => f && typeof f.facilityId === "string" && typeof f.companyName === "string").slice(0, 8));
      } catch {
        setFacilityHits([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [open, mode, facilityQ, facility]);

  const existingBoardId = useMemo(() => {
    if (cand?.existingBoardId) return cand.existingBoardId;
    if (!selected) return null;
    return boards.find((b) => b.contractId === selected.contractId && !b.archivedAt)?.boardId ?? null;
  }, [cand, selected, boards]);

  const canSubmit = mode === "contract" ? !!selected && !existingBoardId : mode === "manual" ? projectName.trim().length > 0 : projectName.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const body: TodoBoardCreateInput = { kind, color, name: name.trim() || null, defaultCompleteRules: defaultRules };
    if (kind === "project") body.mode = mode;
    if (mode === "contract" && selected) {
      body.contractId = selected.contractId;
      body.projectName = selected.contractTitle;
      body.clientName = selected.counterpartyName;
      body.facilityId = cand?.facilityId ?? null;
    } else if (mode === "manual") {
      body.projectName = projectName.trim();
      body.clientName = clientName.trim() || null;
      body.facilityId = facility?.facilityId ?? null;
    } else {
      body.projectName = projectName.trim();
      body.clientName = null;
    }
    try {
      const d = await apiCall<{ board: TodoBoard }>("/api/todo/boards", { method: "POST", body: JSON.stringify(body) });
      toast("보드를 만들었습니다", "success");
      onCreated(d.board);
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setError(kind === "dept" && /부서|403|권한/.test(msg) ? `${msg} 프로젝트 보드로 만들거나 부서장에게 요청하세요.` : msg);
    } finally {
      setBusy(false);
    }
  };

  const preview = selected && (
    <div className="cd-card todo-preview" aria-label="선택한 용역">
      <b>{selected.contractTitle}</b>
      <span className="todo-mu">
        발주처 {selected.counterpartyName}
        {cand?.facilityName ? ` · 사업장 ${cand.facilityName}` : ""}
        {selected.serviceSubtype ? ` · ${selected.serviceSubtype}` : ""}
        {selected.contractDate ? ` · 계약일 ${selected.contractDate}` : ""}
      </span>
      <span className="todo-mu">수행인력은 멤버로 자동 추가됩니다{cand && !cand.isParticipant ? " (나는 수행인력이 아니므로 소유자로만 참여합니다)" : ""}.</span>
      {existingBoardId && (
        <span className="todo-preview-warn">
          이 용역의 보드가 이미 있습니다.
          <button
            type="button"
            onClick={() => {
              onOpenBoard(existingBoardId);
              onClose();
            }}
          >
            열기
          </button>
        </span>
      )}
    </div>
  );

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="새 프로젝트 보드"
      size="lg"
      closeOnBackdrop={false}
      footer={
        <>
          {error && <span className="todo-field-err mr-auto">{error}</span>}
          <CdButton variant="ghost" onClick={onClose}>
            취소
          </CdButton>
          <CdButton variant="primary" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            보드 만들기
          </CdButton>
        </>
      }
    >
      <div className="todo-vars todo-modal">
        <div className="todo-modal-seg overflow-hidden" role="radiogroup" aria-label="보드 생성 방식">
          {TODO_BOARD_MODES.map((m) => {
            const Icon = MODE_ICONS[m];
            return (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className="cd-choice" data-active={mode === m ? "true" : undefined} onClick={() => setMode(m)}>
                <Icon aria-hidden="true" />
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>

        {mode === "contract" && (
          <>
            <ContractPicker
              active={open && mode === "contract"}
              selectedId={selected?.contractId ?? null}
              onSelect={(c, hit) => {
                setSelected(c);
                if (hit) setCand(hit);
              }}
            />
            {preview}
          </>
        )}

        {mode === "manual" && (
          <>
            <CdInput label="프로젝트명" required value={projectName} maxLength={120} onChange={(e) => setProjectName(e.target.value)} placeholder="예: 한빛제지 군산공장 통합허가 변경" error={projectName.trim() ? undefined : "프로젝트명을 입력하세요."} />
            <CdInput label="업체명(발주처)" value={clientName} maxLength={120} onChange={(e) => setClientName(e.target.value)} placeholder="선택 — 사업장 마스터에 없어도 됩니다" />
            <div className="todo-field relative">
              <span className="todo-field-lb">사업장(선택)</span>
              {facility ? (
                <span className="todo-chip self-start pl-2">
                  <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                  {facility.companyName}
                  <button
                    type="button"
                    aria-label="사업장 해제"
                    onClick={() => {
                      setFacility(null);
                      setFacilityQ("");
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : (
                <>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" aria-hidden="true" />
                    <input className="cd-input !pl-8" value={facilityQ} placeholder="사업장 이름 2자 이상" aria-label="사업장 검색" onChange={(e) => setFacilityQ(e.target.value)} />
                  </div>
                  {facilityHits.length > 0 && (
                    <div className="todo-hits" role="listbox" aria-label="사업장 후보">
                      {facilityHits.map((f) => {
                        const region = [f.regionSido, f.regionSigungu].filter(Boolean).join(" ");
                        return (
                          <button
                            key={f.facilityId}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => {
                              setFacility(f);
                              setFacilityHits([]);
                              if (!clientName.trim()) setClientName(f.companyName);
                            }}
                          >
                            {f.companyName}
                            {region && <span className="todo-mu"> · {region}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <span className="todo-field-hint">사업장을 고르면 할 일 상세의 '관련'에 사업장 링크가 붙습니다.</span>
            </div>
          </>
        )}

        {mode === "internal" && <CdInput label="프로젝트명" required value={projectName} maxLength={120} onChange={(e) => setProjectName(e.target.value)} placeholder="예: 견적 요율표 2027 개정" hint="발주처가 없는 사내 프로젝트입니다." error={projectName.trim() ? undefined : "프로젝트명을 입력하세요."} />}

        <div className="todo-field">
          <span className="todo-field-lb">보드 색</span>
          <div className="todo-swatches" role="radiogroup" aria-label="보드 색">
            <button type="button" role="radio" aria-checked={color == null} aria-pressed={color == null} className="todo-swatch" data-auto="true" onClick={() => setColor(null)}>
              자동
            </button>
            {TODO_BOARD_COLOR_KEYS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={color === k} aria-pressed={color === k} className="todo-swatch" style={{ ["--todo-tint" as string]: TODO_BOARD_COLORS[k] }} title={TODO_BOARD_COLOR_LABELS[k]} aria-label={TODO_BOARD_COLOR_LABELS[k]} onClick={() => setColor(k)}>
                {color === k && <Check strokeWidth={3} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <span className="todo-field-hint">자동이면 가장 적게 쓰인 파스텔 색이 배정됩니다. 색은 목록 행·카드의 좌측 띠와 맥락 점에 쓰입니다.</span>
        </div>

        <div className="todo-field">
          <span className="todo-field-lb">보드 종류</span>
          <div className="todo-modal-seg overflow-hidden" role="radiogroup" aria-label="보드 종류">
            {(["project", "dept"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className="cd-choice" data-active={kind === k ? "true" : undefined} onClick={() => setKind(k)}>
                {k === "project" ? "프로젝트" : "부서"}
              </button>
            ))}
          </div>
          <span className="todo-field-hint">{kind === "dept" ? "부서 보드는 부서장·임원·관리자만 만들 수 있습니다. 권한이 없으면 서버가 거절합니다." : "프로젝트 보드는 누구나 만들 수 있고, 멤버에게만 보입니다."}</span>
        </div>

        <CdInput label="보드 이름(선택)" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={mode === "contract" ? "비우면 용역명" : "비우면 프로젝트명"} />

        <div className="todo-field">
          <span className="todo-field-lb">기본 완료 조건</span>
          <CompleteRulesFields value={defaultRules} onChange={setDefaultRules} />
          <span className="todo-field-hint">이 보드에서 만드는 할 일에 자동으로 붙는 완료 조건입니다. 완료 전에 확인 창이 떠 조건을 점검합니다(나중에 보드 ⋯ 메뉴에서 바꿀 수 있습니다).</span>
        </div>
      </div>
    </CdModal>
  );
}

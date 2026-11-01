"use client";

// 통합허가 업종(/admin/permit-industries) — 통합허가 대상 업종 단일 원천(permit_industries, 325, 2026-11-01).
// 여기서 추가·수정·사용 중지하면 사업장 마스터(업종 필터·통계·내보내기)·계약관리(업종 옵션·프리필·수주 현황)·
// 영업/마케팅(영업 발굴·브리핑 업종 선택·입찰 서류·회사소개서)·AI 분류 프롬프트가 같은 목록을 읽는다.
// 삭제 대신 사용 중지 — 저장 데이터(업종 id·이름)의 이름표를 지키기 위해서다. ID 는 만든 뒤 바꿀 수 없다.

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Factory, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { CdInput, CdTextarea } from "@/components/cdash/CdField";
import { CdIconButton } from "@/components/cdash/CdButton";
import { useCdToast } from "@/components/cdash/CdToast";
import { refreshPermitIndustries } from "@/lib/ieps/use-permit-industries";
import type { IntegratedPermitIndustry } from "@/lib/ieps/integrated-permit-industries";
import "@/components/cdash/cdash.css";

interface Draft {
  creating: boolean;
  id: string;
  label: string;
  exactCodes: string;
  prefixCodes: string;
  keywords: string;
  aliases: string;
  note: string;
}

const EMPTY_DRAFT: Draft = { creating: true, id: "", label: "", exactCodes: "", prefixCodes: "", keywords: "", aliases: "", note: "" };

function toDraft(item: IntegratedPermitIndustry): Draft {
  return {
    creating: false,
    id: item.id,
    label: item.label,
    exactCodes: item.exactCodes.join(", "),
    prefixCodes: item.prefixCodes.join(", "),
    keywords: item.keywords.join(", "),
    aliases: item.aliases.join(", "),
    note: item.note ?? "",
  };
}

function codesText(item: IntegratedPermitIndustry): string {
  return [...item.exactCodes, ...item.prefixCodes.map((p) => `${p}*`)].join(", ");
}

export function PermitIndustriesBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [items, setItems] = useState<IntegratedPermitIndustry[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [fromTable, setFromTable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/permit-industries", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "업종 목록을 불러오지 못했습니다.");
      setItems(data.industries ?? []);
      setCounts(data.facilityCounts ?? {});
      setFromTable(data.fromTable !== false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/permit-industries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "HTTP " + res.status);
      await Promise.all([load(), refreshPermitIndustries()]);
      return true;
    } catch (err) {
      toast((err as Error).message, "error");
      setDraftError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setDraftError(null);
    const industry = {
      id: draft.id.trim(),
      label: draft.label.trim(),
      exactCodes: draft.exactCodes,
      prefixCodes: draft.prefixCodes,
      keywords: draft.keywords,
      aliases: draft.aliases,
      note: draft.note,
    };
    if (await post({ action: draft.creating ? "create" : "update", industry })) {
      toast(draft.creating ? "업종을 추가했습니다." : "업종을 저장했습니다.", "success");
      setDraft(null);
    }
  };

  const setActive = async (item: IntegratedPermitIndustry, active: boolean) => {
    if (!active && !window.confirm(`'${item.label}' 업종을 사용 중지할까요? 선택 목록·업종 분류에서 빠지고, 이미 저장된 계약·영업 기록의 업종 이름은 그대로 보입니다.`)) return;
    if (await post({ action: "setActive", id: item.id, active })) {
      toast(active ? "다시 사용합니다." : "사용 중지했습니다.", "success");
    }
  };

  const move = async (index: number, delta: number) => {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    await post({ action: "reorder", ids: next.map((i) => i.id) });
  };

  const activeCount = items.filter((i) => i.active).length;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Factory className="w-5 h-5" />}
        title="통합허가 업종"
        meta={items.length ? `사용 중 ${activeCount}개${items.length > activeCount ? ` · 사용 중지 ${items.length - activeCount}개` : ""}` : undefined}
        helpTopic="admin.permit-industries"
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="새로고침" aria-label="새로고침" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5"
              disabled={!fromTable || busy}
              onClick={() => {
                setDraftError(null);
                setDraft(EMPTY_DRAFT);
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              업종 추가
            </button>
          </div>
        }
      />
      {error && <p className="text-sm text-[color:var(--cd-error)]">{error}</p>}
      {!fromTable && !loading && (
        <p className="text-sm cd-warn-text" role="status">
          업종 표(마이그레이션 325)가 아직 적용되지 않아 기본 20개 업종으로 동작 중입니다. 적용한 뒤 편집할 수 있습니다.
        </p>
      )}
      <p className="text-xs cd-text-faint">
        저장하면 사업장 업종 필터·통계, 계약 업종 옵션, 영업 발굴·브리핑 업종 선택, 입찰 서류·회사소개서 업종 표기, AI 업종 분류에 함께 반영됩니다(다른 서버는 최대 1분 뒤).
      </p>

      <div className="cd-card rounded-3xl p-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="cd-table-head">
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left w-16">순서</th>
                <th className="py-2 px-2 text-left">업종 · ID</th>
                <th className="py-2 px-2 text-left">KSIC 코드</th>
                <th className="py-2 px-2 text-right w-20">사업장</th>
                <th className="py-2 px-2 text-left w-24">상태</th>
                <th className="py-2 px-2 text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center cd-text-faint">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
                    불러오는 중…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center cd-text-faint">등록된 업종이 없습니다.</td>
                </tr>
              ) : (
                items.map((item, index) => (
                  <tr key={item.id} className={`border-b cd-border-c ${item.active ? "" : "opacity-60"}`}>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        <CdIconButton size="sm" label={`${item.label} 위로`} disabled={!fromTable || busy || index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp className="w-3.5 h-3.5" />
                        </CdIconButton>
                        <CdIconButton size="sm" label={`${item.label} 아래로`} disabled={!fromTable || busy || index === items.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown className="w-3.5 h-3.5" />
                        </CdIconButton>
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-[11px] cd-text-faint">
                        <span className="font-mono">{item.id}</span>
                        {item.aliases.length > 0 && <> · 옛 이름 {item.aliases.join(", ")}</>}
                      </div>
                    </td>
                    <td className="py-2 px-2 font-mono text-xs">{codesText(item) || <span className="cd-warn-text">코드 없음 — 사업장 분류 안 됨</span>}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{(counts[item.id] ?? 0).toLocaleString()}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`cd-pill ${item.active ? "cd-pill-success" : "cd-pill-idle"} text-[11px]`}>{item.active ? "사용 중" : "사용 중지"}</span>
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-xs font-semibold inline-flex items-center gap-1"
                        disabled={!fromTable || busy}
                        onClick={() => {
                          setDraftError(null);
                          setDraft(toDraft(item));
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                        수정
                      </button>
                      <button
                        type="button"
                        className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-xs font-semibold"
                        disabled={!fromTable || busy}
                        onClick={() => setActive(item, !item.active)}
                      >
                        {item.active ? "사용 중지" : "다시 사용"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CdModal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.creating ? "업종 추가" : "업종 수정"}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="cd-btn cd-btn-ghost rounded-lg px-4 py-2 text-sm font-semibold" onClick={() => setDraft(null)}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-sm font-semibold" disabled={busy} onClick={save}>
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <CdInput
                label="업종 이름"
                required
                value={draft.label}
                placeholder="예: 데이터센터"
                hint={draft.creating ? "계약 업종에는 '이름(통합허가)'로 표시됩니다." : "이름을 바꾸면 옛 이름이 자동으로 옛 이름 목록에 남습니다."}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
              <CdInput
                label="업종 ID"
                required={draft.creating}
                value={draft.id}
                disabled={!draft.creating}
                placeholder="예: data-center"
                hint={draft.creating ? "영문 소문자·숫자·하이픈. 저장 데이터의 키라 만든 뒤 바꿀 수 없습니다." : "ID 는 바꿀 수 없습니다."}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <CdInput
                label="KSIC 정확 일치(5자리)"
                value={draft.exactCodes}
                placeholder="예: 35300, 38210"
                hint="쉼표로 구분합니다."
                onChange={(e) => setDraft({ ...draft, exactCodes: e.target.value })}
              />
              <CdInput
                label="KSIC 앞자리 일치"
                value={draft.prefixCodes}
                placeholder="예: 241, 3511"
                hint="입력한 숫자로 시작하는 코드를 모두 포함합니다."
                onChange={(e) => setDraft({ ...draft, prefixCodes: e.target.value })}
              />
            </div>
            <CdInput
              label="업종 키워드"
              value={draft.keywords}
              placeholder="예: 반도체, 웨이퍼"
              hint="계약 업종 분류·사업장 업종명에 이 말이 들어 있으면 이 업종으로 봅니다(입찰 서류·회사소개서·계약 다운로드)."
              onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
            />
            <CdInput
              label="옛 이름·다른 표기"
              value={draft.aliases}
              placeholder="예: 정밀화학"
              hint="이전에 저장된 계약 업종 이름을 이 업종으로 읽습니다."
              onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
            />
            <CdTextarea
              label="AI 분류 힌트(선택)"
              rows={2}
              value={draft.note}
              placeholder="예: 데이터센터 냉각·전력설비 포함"
              hint="뉴스·공시·환경영향평가 업종 분류 프롬프트에 함께 넣습니다."
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
            {draftError && <p className="text-sm cd-error-text">{draftError}</p>}
          </div>
        )}
      </CdModal>
    </div>
  );
}

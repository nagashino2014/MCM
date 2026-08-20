"use client";

// 법인카드 내역 불러오기 모달 (블루프린트 P1 F1/F2)
// 지출결의서·출장보고서 기안 화면에서 미사용 매입건을 다중 선택해 지출 내역 표로 넘긴다.
// - 목록 = 결의서 미귀속(doc_id null)·미제외·승인 건. 이미 이 문서 표에 담긴 건은 선택 불가 표시.
// - 분류는 3단 자동(학습→상호 키워드→업태 규칙) 결과를 배지로 보여주고, 실패 건은 표에서 직접 선택.
// - 실측 안내: 매입내역은 카드 사용 후 확정까지 2~5일 지연될 수 있다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, Search } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { DigitDateInput } from "@/components/finance/DigitDateInput";
import { DEPT_CARD_RULES } from "@/lib/finance/card-dept";

export interface CardPickerItem {
  cardTxnId: string;
  cardLabel: string;
  approvedAt: string;
  useDate: string;
  amountTotal: number;
  storeName: string | null;
  storeBizType: string | null;
  isPurchased: boolean;
  categoryKey: string | null;
  categoryLabel: string | null;
  categorySource: string | null;
  /** 사전 생성된 전자 전표 PDF key(null = 아직 미생성 — 담을 때 서버가 만든다) */
  slipKey: string | null;
  slipName: string;
  formOption: string | null;
}

/** 피커 상단 카드 태그 — 부서별로 묶어 보여 준다(내 부서 먼저). */
interface CardOption {
  cardId: string;
  label: string;
  deptId: string | null;
  companyName: string;
  last4: string;
}

const ymdInput = (d: Date) => d.toISOString().slice(0, 10);

/** 오늘 기준 n일 전 — "1주"·"1개월" 빠른 기간 태그. */
const daysAgo = (n: number) => ymdInput(new Date(Date.now() - n * 86400000));

const deptShort = (deptId: string | null) =>
  DEPT_CARD_RULES.find((r) => r.deptId === deptId)?.short ?? "기타";

export function CardPickerModal({
  open,
  onClose,
  formId,
  existingIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  /** 이미 이 문서의 지출 내역 표에 담긴 카드 건(_cardTxnId) */
  existingIds: string[];
  onPick: (items: CardPickerItem[]) => void;
}) {
  const [from, setFrom] = useState(() => ymdInput(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => ymdInput(new Date()));
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<CardPickerItem[]>([]);
  const [cards, setCards] = useState<CardOption[]>([]);
  const [myDept, setMyDept] = useState<{ deptId: string; deptName: string } | null>(null);
  /** 선택한 카드(빈 값 = 내 부서 카드 기본 적용, 그것도 없으면 전체) */
  const [cardFilter, setCardFilter] = useState<Set<string>>(new Set());
  /** 타 부서 카드 태그를 펼쳐 볼 부서 */
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ formId, from, to });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (cardFilter.size) params.set("cardIds", [...cardFilter].join(","));
      const res = await fetch(`/api/finance/card-picker?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "카드 내역을 불러오지 못했습니다.");
      setItems(data.items ?? []);
      setCards(data.cards ?? []);
      setMyDept(data.myDept ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [formId, from, to, keyword, cardFilter]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      load();
    }
  }, [open, load]);

  // 첫 응답에서 내 부서 카드를 기본 필터로 건다(사용자가 태그를 만지면 그 뒤로는 관여하지 않는다).
  const [autoApplied, setAutoApplied] = useState(false);
  useEffect(() => {
    if (!open) setAutoApplied(false);
  }, [open]);
  useEffect(() => {
    if (!open || autoApplied || !cards.length) return;
    setAutoApplied(true);
    const mine = cards.filter((c) => myDept && c.deptId === myDept.deptId).map((c) => c.cardId);
    if (mine.length) setCardFilter(new Set(mine));
  }, [open, autoApplied, cards, myDept]);

  const myCards = useMemo(() => cards.filter((c) => myDept && c.deptId === myDept.deptId), [cards, myDept]);
  /** 내 부서를 뺀 나머지 — 부서(미지정은 "기타")별로 묶는다. */
  const otherDepts = useMemo(() => {
    const map = new Map<string, CardOption[]>();
    for (const c of cards) {
      if (myDept && c.deptId === myDept.deptId) continue;
      const key = c.deptId ?? "__none__";
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    return [...map.entries()].map(([deptId, list]) => ({
      deptId,
      label: deptId === "__none__" ? "미지정" : deptShort(deptId),
      cards: list,
    }));
  }, [cards, myDept]);

  const toggleCard = (cardId: string) =>
    setCardFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });

  const existing = useMemo(() => new Set(existingIds), [existingIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 채널 가드(§13.3, 경고만): 지출결의서에 출장성 분류(교통·숙박) 건을 담으면 안내.
  const tripLikeSelected =
    formId === "frm-expense-report" &&
    items.some((i) => selected.has(i.cardTxnId) && (i.categoryKey === "travel" || i.categoryKey === "lodging" || i.categoryKey === "fuel"));

  const submit = () => {
    const picked = items.filter((i) => selected.has(i.cardTxnId));
    if (!picked.length) return;
    onPick(picked);
    onClose();
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="법인카드 내역 불러오기"
      size="xl"
      footer={
        <>
          <span className="text-xs cd-text-muted mr-auto">{selected.size}건 선택</span>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={selected.size === 0} onClick={submit}>
            표에 추가
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="cd-label text-xs">기간</label>
          {/* YYYYMMDD 자동완성 — 종전 <input type="date"> 는 폭을 줄일 수 없었다. */}
          <DigitDateInput value={from} onChange={setFrom} className="cd-input text-center" style={{ width: 116 }} />
          <span className="cd-text-muted">~</span>
          <DigitDateInput value={to} onChange={setTo} className="cd-input text-center" style={{ width: 116 }} />
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => { setFrom(daysAgo(7)); setTo(ymdInput(new Date())); }}>
            1주
          </button>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => { setFrom(daysAgo(30)); setTo(ymdInput(new Date())); }}>
            1개월
          </button>
          <span className="relative flex items-center">
            <Search className="w-3.5 h-3.5 cd-text-faint absolute left-2" />
            <input
              className="cd-input text-[13px]"
              style={{ width: 168, paddingLeft: 26 }}
              placeholder="매입처 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </span>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> 조회
          </button>
          <span className="text-[11px] cd-text-faint ml-auto">
            매입내역은 카드 사용 후 확정까지 2~5일 걸릴 수 있습니다
          </span>
        </div>

        {/* 카드 태그 — 내 부서 카드를 먼저, 그 아래 타 부서(태그를 누르면 그 부서 카드가 펼쳐진다).
            옆 부서 카드를 빌려 쓰는 경우가 있어 다른 부서도 고를 수 있어야 한다(사용자 요구). */}
        {cards.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border cd-border-c px-3 py-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold cd-text whitespace-nowrap">{myDept?.deptName ?? "내 부서"}</span>
              {myCards.length ? (
                myCards.map((c) => (
                  <button
                    key={c.cardId}
                    type="button"
                    className={`cd-btn cd-btn-sm ${cardFilter.has(c.cardId) ? "cd-btn-primary" : "cd-btn-soft"}`}
                    onClick={() => toggleCard(c.cardId)}
                  >
                    {c.label}
                  </button>
                ))
              ) : (
                <span className="text-[11px] cd-text-faint">부서로 등록된 카드가 없습니다 — 재무 &gt; 연결 관리에서 카드 별칭을 넣어 주세요.</span>
              )}
              {cardFilter.size > 0 && (
                <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => setCardFilter(new Set())}>
                  전체 보기
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] cd-text-faint whitespace-nowrap">다른 부서</span>
              {otherDepts.map((d) => (
                <button
                  key={d.deptId}
                  type="button"
                  className={`cd-btn cd-btn-sm ${openDept === d.deptId ? "cd-btn-soft font-bold" : "cd-btn-ghost"}`}
                  onClick={() => setOpenDept((prev) => (prev === d.deptId ? null : d.deptId))}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {openDept && (
              <div className="flex items-center gap-1.5 flex-wrap pl-1">
                {(otherDepts.find((d) => d.deptId === openDept)?.cards ?? []).map((c) => (
                  <button
                    key={c.cardId}
                    type="button"
                    className={`cd-btn cd-btn-sm ${cardFilter.has(c.cardId) ? "cd-btn-primary" : "cd-btn-soft"}`}
                    onClick={() => toggleCard(c.cardId)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <div className="cd-error-text text-sm">{error}</div>}
        {tripLikeSelected && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            출장성 지출(교통·숙박·유류)이 선택돼 있습니다 — 출장 경비는 출장보고서의 경비 내역 사용을 권장합니다.
          </div>
        )}

        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border cd-border-c rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
              <tr className="cd-text-muted text-left">
                <th className="py-2 px-3 font-normal w-8"></th>
                <th className="py-2 pr-3 font-normal">사용일</th>
                <th className="py-2 pr-3 font-normal">카드</th>
                <th className="py-2 pr-3 font-normal">상호</th>
                <th className="py-2 pr-3 font-normal text-right">금액</th>
                <th className="py-2 pr-3 font-normal">자동 분류</th>
                <th className="py-2 font-normal">매입</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const used = existing.has(item.cardTxnId);
                return (
                  <tr
                    key={item.cardTxnId}
                    className={`border-t cd-hairline-row-c ${used ? "opacity-45" : "cursor-pointer cd-row-hover"}`}
                    onClick={() => !used && toggle(item.cardTxnId)}
                  >
                    <td className="py-1.5 px-3">
                      <input type="checkbox" checked={selected.has(item.cardTxnId)} disabled={used} readOnly />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.useDate}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.cardLabel}</td>
                    <td className="py-1.5 pr-3 max-w-[220px] truncate" title={item.storeName ?? ""}>
                      {item.storeName ?? "-"}
                      {used && <span className="ml-1.5 text-[10px] cd-text-faint">(이미 담김)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{item.amountTotal.toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3">
                      {item.categoryLabel ? (
                        <span className="cd-pill cd-pill-info" title={`업태: ${item.storeBizType ?? "-"} · 근거: ${item.categorySource}`}>
                          {item.formOption ?? item.categoryLabel}
                        </span>
                      ) : (
                        <span className="cd-pill cd-pill-idle">미분류</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <span className={`cd-pill ${item.isPurchased ? "cd-pill-success" : "cd-pill-idle"}`}>{item.isPurchased ? "완료" : "대기"}</span>
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">
                    선택 가능한 매입 내역이 없습니다. 기간을 넓히거나 재무 &gt; 연결 관리에서 수집 상태를 확인하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </CdModal>
  );
}

"use client";

// 공공입찰(bid) 보드 — 나라장터 발주계획/사전규격/입찰공고 목록.
// 종류 탭 + 필터(키워드·업무구분·게시일 기간·예산 금액대·지역권·계약방법·용역 분류) +
// 서버 페이지네이션 테이블 + 상세 모달(발주계획↔사전규격↔입찰공고 연계 링크) + 분류 설정.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Gavel, Search, ExternalLink, Wand2, SlidersHorizontal, Tags, X, Link2, Plus, Trash2, Columns3, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ChevronUp, ChevronDown, Paperclip, BellRing, Pencil, ListOrdered, FileStack, Download } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { PaginationControls } from "@/components/ui/PaginationControls";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import "@/components/cdash/cdash.css";

type BidType = "order_plan" | "prior_spec" | "bid_notice";

interface BidRow {
  bidId: string;
  externalId: string;
  orgName: string | null;
  title: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  method: string | null;
  workType: string | null;
  category: string | null;
  url: string | null;
  /** 발주계획 전용 — 발주년도-발주월(예: 2026-07). */
  orderPeriod: string | null;
  /** 커스텀 열 값(columns 순서와 동일, 서버 계산). */
  cells?: (string | null)[];
}

interface ViewColumn {
  label: string;
  parts: string[];
  mode: "single" | "join" | "calc";
  sep?: string;
  op?: "+" | "-" | "*" | "/";
  format?: "text" | "money" | "date" | "link";
  sortable?: boolean;
}

interface FieldCandidate {
  name: string;
  nameKo?: string;
}

interface BidDetail extends BidRow {
  raw: Record<string, unknown>;
}

interface RelatedBid {
  bidType: BidType;
  bidId: string;
  title: string | null;
  orgName: string | null;
  postedAt: string | null;
}

/** 분류 조건 그룹 — 그룹 내 op(AND/OR/NOR), 그룹 간 AND (lib/bid/match 와 동일 구조). */
interface RuleGroup {
  op: "and" | "or" | "not" | "nor";
  keywords: string[];
  /** 제외 그룹 전용 — 제외어 판정 전 사업명에서 가릴 문구(부분문자열 오탐 방지). */
  except?: string[];
}

interface BidCategory {
  categoryId: string;
  name: string;
  keywords: string[];
  rule?: RuleGroup[] | null;
  enabled: boolean;
}

type NotifyChannel = "kakao" | "email" | "app";

interface NotifyRecipient {
  employeeId: string;
  name: string;
  channels: NotifyChannel[];
}

interface NotifyContentField {
  name: string;
  label: string;
}

interface BidNotifySettings {
  enabled: boolean;
  sendTime: string;
  recipients: NotifyRecipient[];
  /** 발송 대상 종류. */
  bidTypes: BidType[];
  /** 종류별 발송 본문 항목(위→아래 순서). 없으면 기본(분류·사업명·기관·마감·링크). */
  contentFields: Partial<Record<BidType, NotifyContentField[]>>;
  /** 마감 임박 알림 기준일(D-N, 앱 푸시 전용). 0 이면 사용하지 않는다. */
  deadlineDays: number;
}

const CHANNEL_LABELS: { key: NotifyChannel; label: string }[] = [
  { key: "kakao", label: "카카오톡" },
  { key: "email", label: "메일" },
  { key: "app", label: "앱 푸시" },
];
const OP_LABELS: { key: RuleGroup["op"]; label: string; desc: string }[] = [
  { key: "and", label: "AND", desc: "모두 포함" },
  { key: "or", label: "OR", desc: "하나라도 포함" },
  { key: "not", label: "NOT", desc: "모두 동시 포함만 제외" },
  { key: "nor", label: "NOR", desc: "모두 미포함(제외)" },
];
// 영업 스케쥴 모달과 동일한 담당자 필터 — 직급 rank 60 이상만 조직도에 표시.
const MIN_NOTIFY_RANK = 60;
const NOTIFY_EXCLUDE_NAMES = ["한상순"];

/** 규칙 요약 — 예: [통합환경∨통합허가] AND [¬(조성공사∨개선공사)] */
function ruleSummaryText(c: BidCategory): string {
  const groups = c.rule?.length ? c.rule : c.keywords.length ? [{ op: "or" as const, keywords: c.keywords }] : [];
  if (!groups.length) return "(조건 없음)";
  return groups
    .map((g) => {
      const kw = g.keywords.join(g.op === "and" || g.op === "not" ? " ∧ " : " ∨ ");
      if (g.op !== "not" && g.op !== "nor") return `[${kw}]`;
      const ex = g.except?.length ? `, 단 ${g.except.join(" ∨ ")} 은 통과` : "";
      return g.op === "not" ? `[동시 제외: ${kw}${ex}]` : `[제외: ${kw}${ex}]`;
    })
    .join(" AND ");
}

const TABS: { key: BidType; label: string }[] = [
  { key: "bid_notice", label: "입찰공고" },
  { key: "prior_spec", label: "사전규격" },
  { key: "order_plan", label: "발주계획" },
];
const TYPE_LABEL: Record<BidType, string> = { order_plan: "발주계획", prior_spec: "사전규격", bid_notice: "입찰공고" };
const REGION_GROUPS = ["수도권", "강원권", "충청권", "경북권", "경남권", "전라권", "제주권"];
const PAGE_SIZE = 20;

function fmtMoney(n: number | null): string {
  if (!n || n <= 0) return "-";
  const eok = Math.floor(n / 1e8);
  const man = Math.round((n - eok * 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok}억 ${man.toLocaleString("ko-KR")}만` : `${eok}억`;
  if (man > 0) return `${man.toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}
const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

/**
 * raw 응답에서 첨부파일(URL+파일명) 쌍 추출 — 나라장터 표준: ntceSpecDocUrl{N}↔ntceSpecFileNm{N},
 * stdNtceDocUrl 등 "…DocUrl{N}" 패턴 전반(사전규격도 동일 규칙). URL 은 g2b 직다운로드 링크.
 */
function extractAttachments(raw: Record<string, unknown> | undefined): { name: string; url: string }[] {
  if (!raw) return [];
  const out: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(raw)) {
    const m = k.match(/^(.*)DocUrl(\d*)$/);
    if (!m) continue;
    const url = String(raw[k] ?? "").trim();
    if (!/^https?:\/\//.test(url)) continue;
    const nameKey = `${m[1]}FileNm${m[2]}`;
    const name = String(raw[nameKey] ?? "").trim() || `첨부파일${m[2] ? ` ${m[2]}` : ""}`;
    const sig = `${name}|${url}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ name, url });
  }
  return out;
}

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export function BidBoard() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme } = useCdashTheme();

  const [bidType, setBidType] = useState<BidType>("bid_notice");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [workType, setWorkType] = useState("");
  // 확장 필터
  const [showFilters, setShowFilters] = useState(false);
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");
  const [budgetMinMan, setBudgetMinMan] = useState(""); // 만원 단위 입력
  const [budgetMaxMan, setBudgetMaxMan] = useState("");
  const [regionGroup, setRegionGroup] = useState("");
  const [method, setMethod] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [categories, setCategories] = useState<BidCategory[]>([]);
  /** 계약방법 옵션 — 해당 종류의 실데이터 distinct(서버 제공). */
  const [methodOptions, setMethodOptions] = useState<string[]>([]);
  /** 커스텀 열 구성(서버 제공, 없으면 기본). */
  const [columns, setColumns] = useState<ViewColumn[]>([]);
  /** 헤더 클릭 정렬 — 열 인덱스 기준(desc→asc→기본 토글). */
  const [sortCol, setSortCol] = useState<number>(-1);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<BidRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 입찰 서류 생성 진행 중 패키지(메인 상단 바로가기) — output = 최근 생성본 보관 메타(P4)
  const [activePackages, setActivePackages] = useState<
    {
      bidType: string;
      bidId: string;
      title: string;
      orgName: string;
      deadline: string | null;
      updatedAt: string;
      output: { fileName: string; generatedAt: string; warningCount: number } | null;
    }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sales/bids/package/active", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d?.packages) setActivePackages(d.packages);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 상세 모달
  const [detail, setDetail] = useState<BidDetail | null>(null);
  const [detailType, setDetailType] = useState<BidType>("bid_notice");
  const [related, setRelated] = useState<RelatedBid[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 분류 설정 모달 — 조건 그룹(AND/OR/NOR) 에디터
  const [catModal, setCatModal] = useState(false);
  const [catName, setCatName] = useState("");
  const [catGroups, setCatGroups] = useState<RuleGroup[]>([{ op: "or", keywords: [] }]);
  const [kwDrafts, setKwDrafts] = useState<string[]>([""]);
  /** 조건별 예외 키워드 입력 중 값(제외 그룹 전용). */
  const [exDrafts, setExDrafts] = useState<string[]>([""]);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  /** 분류 모달 내 안내/오류 — 모달이 화면을 덮어 상단 에러 배너가 안 보이므로 별도. */
  const [catError, setCatError] = useState<string | null>(null);

  // 매칭 알림 설정 모달
  const [notifyModal, setNotifyModal] = useState(false);
  const [notifySettings, setNotifySettings] = useState<BidNotifySettings>({
    enabled: false,
    sendTime: "08:30",
    recipients: [],
    bidTypes: ["order_plan", "prior_spec", "bid_notice"],
    contentFields: {},
    deadlineDays: 3,
  });
  const [notifyPending, setNotifyPending] = useState(0);
  const [notifyLastSentAt, setNotifyLastSentAt] = useState<string | null>(null);
  const [orgSnapshot, setOrgSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);

  // 발송 항목 구성 모달 — 종류별 후보(수집된 전체 파라미터) ↔ 포함 항목(순서)
  const [fieldModal, setFieldModal] = useState(false);
  const [fieldBidType, setFieldBidType] = useState<BidType>("bid_notice");
  const [fieldCandCache, setFieldCandCache] = useState<Partial<Record<BidType, FieldCandidate[]>>>({});
  const [fieldBusy, setFieldBusy] = useState(false);
  const [fieldLeftSel, setFieldLeftSel] = useState<string | null>(null);
  const [fieldRightSel, setFieldRightSel] = useState<number>(-1);

  // 열 설정 모달
  const [colModal, setColModal] = useState(false);
  const [colDraft, setColDraft] = useState<ViewColumn[]>([]);
  const [colCandidates, setColCandidates] = useState<FieldCandidate[]>([]);
  const [colIsDefault, setColIsDefault] = useState(true);
  const [colBusy, setColBusy] = useState(false);
  // 새 열 폼
  const [ncLabel, setNcLabel] = useState("");
  const [ncParts, setNcParts] = useState<string[]>([]);
  const [ncPartSel, setNcPartSel] = useState("");
  const [ncMode, setNcMode] = useState<"single" | "join" | "calc">("single");
  const [ncSep, setNcSep] = useState("/");
  const [ncOp, setNcOp] = useState<"+" | "-" | "*" | "/">("+");
  const [ncFormat, setNcFormat] = useState<"text" | "money" | "date" | "link">("text");
  const [ncSortable, setNcSortable] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(
    () => setOffset(0),
    [bidType, qDebounced, workType, postedFrom, postedTo, budgetMinMan, budgetMaxMan, regionGroup, method, categoryId, sortCol, sortDir]
  );
  useEffect(() => setSortCol(-1), [bidType]);

  const loadCategories = useCallback(async () => {
    try {
      const d = await jfetch("/api/sales/bids/categories");
      setCategories((d.categories ?? []).filter((c: BidCategory) => c.enabled));
    } catch {
      // 분류는 부가 기능 — 실패해도 목록은 동작
    }
  }, []);
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ bidType, limit: String(PAGE_SIZE), offset: String(offset) });
      if (qDebounced) p.set("q", qDebounced);
      if (workType) p.set("workType", workType);
      if (postedFrom) p.set("postedFrom", postedFrom);
      if (postedTo) p.set("postedTo", postedTo);
      const bmin = Number(budgetMinMan);
      const bmax = Number(budgetMaxMan);
      if (Number.isFinite(bmin) && bmin > 0) p.set("budgetMin", String(bmin * 10000));
      if (Number.isFinite(bmax) && bmax > 0) p.set("budgetMax", String(bmax * 10000));
      if (regionGroup) p.set("regionGroup", regionGroup);
      if (method) p.set("method", method);
      if (categoryId) p.set("categoryId", categoryId);
      // 정렬 — 열의 첫 필드 기준, money/calc 열은 숫자 캐스팅
      const sc = sortCol >= 0 ? columns[sortCol] : null;
      if (sc?.parts?.[0]) {
        p.set("sortField", sc.parts[0]);
        p.set("sortDir", sortDir);
        if (sc.format === "money" || sc.mode === "calc") p.set("sortNumeric", "1");
      }
      const res = await fetch(`/api/sales/bids?${p.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRows(d.items ?? []);
      setTotal(d.total ?? 0);
      if (Array.isArray(d.methods)) setMethodOptions(d.methods);
      if (Array.isArray(d.columns)) setColumns(d.columns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
    // columns 는 응답으로 갱신되므로 deps 에 넣지 않는다(재조회 루프 방지) — 정렬 시점엔 이미 로드됨.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidType, qDebounced, workType, postedFrom, postedTo, budgetMinMan, budgetMaxMan, regionGroup, method, categoryId, sortCol, sortDir, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (type: BidType, bidId: string) => {
    setDetailLoading(true);
    setDetail(null);
    setRelated([]);
    setDetailType(type);
    try {
      const d = await jfetch(`/api/sales/bids/${bidId}/related?bidType=${type}`);
      setDetail(d.detail ?? null);
      setRelated(d.related ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── 분류 조건 그룹 에디터 ──
  const resetCatForm = () => {
    setCatName("");
    setCatGroups([{ op: "or", keywords: [] }]);
    setKwDrafts([""]);
    setExDrafts([""]);
    setEditingCatId(null);
    setCatError(null);
  };

  const startEditCategory = (c: BidCategory) => {
    setCatName(c.name);
    const groups = c.rule?.length
      ? c.rule.map((g) => ({ op: g.op, keywords: [...g.keywords], ...(g.except?.length ? { except: [...g.except] } : {}) }))
      : [{ op: "or" as const, keywords: [...c.keywords] }];
    setCatGroups(groups.length ? groups : [{ op: "or", keywords: [] }]);
    setKwDrafts(groups.map(() => ""));
    setExDrafts(groups.map(() => ""));
    setEditingCatId(c.categoryId);
    setCatError(null);
  };

  const addKeywordToGroup = (gi: number) => {
    const kw = (kwDrafts[gi] ?? "").trim();
    if (!kw) return;
    setCatGroups((prev) =>
      prev.map((g, i) => (i === gi && !g.keywords.includes(kw) ? { ...g, keywords: [...g.keywords, kw] } : g))
    );
    setKwDrafts((prev) => prev.map((v, i) => (i === gi ? "" : v)));
  };

  const addExceptToGroup = (gi: number) => {
    const kw = (exDrafts[gi] ?? "").trim();
    if (!kw) return;
    setCatGroups((prev) =>
      prev.map((g, i) =>
        i === gi && !(g.except ?? []).includes(kw) ? { ...g, except: [...(g.except ?? []), kw] } : g
      )
    );
    setExDrafts((prev) => prev.map((v, i) => (i === gi ? "" : v)));
  };

  /** 입력창에 남아 있는(칩으로 확정 전) 키워드·예외를 각 그룹에 반영 — 미확정 텍스트가 조용히 사라지지 않도록. */
  const mergeDrafts = (groups: RuleGroup[], drafts: string[], exs: string[]): RuleGroup[] =>
    groups.map((g, i) => {
      const draft = (drafts[i] ?? "").trim();
      const keywords = g.keywords.filter(Boolean);
      const exDraft = (exs[i] ?? "").trim();
      const except = (g.except ?? []).filter(Boolean);
      const merged = exDraft && !except.includes(exDraft) ? [...except, exDraft] : except;
      // 예외는 제외 그룹에서만 유지(op 를 포함 조건으로 되돌리면 버린다).
      const keepEx = (g.op === "not" || g.op === "nor") && merged.length;
      return {
        ...g,
        keywords: draft && !keywords.includes(draft) ? [...keywords, draft] : keywords,
        ...(keepEx ? { except: merged } : { except: undefined }),
      };
    });

  const saveCategory = async () => {
    if (!catName.trim()) return;
    const rule = mergeDrafts(catGroups, kwDrafts, exDrafts);
    // 빈 조건은 조용히 버리지 않고 알린다 — 예전엔 무시돼 "일부 조건만 적용"으로 보였다.
    const emptyIdx = rule.findIndex((g) => !g.keywords.length);
    if (emptyIdx >= 0) {
      setCatError(`조건 ${emptyIdx + 1} 의 키워드가 비어 있습니다. 키워드를 입력한 뒤 저장하세요.`);
      return;
    }
    if (!rule.length) return;
    setCatError(null);
    setCatGroups(rule);
    setKwDrafts(rule.map(() => ""));
    setExDrafts(rule.map(() => ""));
    setCatBusy(true);
    try {
      if (editingCatId) {
        await jfetch(`/api/sales/bids/categories/${editingCatId}`, {
          method: "PUT",
          body: JSON.stringify({ name: catName.trim(), rule }),
        });
      } else {
        await jfetch("/api/sales/bids/categories", {
          method: "POST",
          body: JSON.stringify({ name: catName.trim(), rule }),
        });
      }
      resetCatForm();
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCatBusy(false);
    }
  };

  // ── 매칭 알림 설정 ──
  const openNotifyModal = async () => {
    setNotifyModal(true);
    setNotifyBusy(true);
    try {
      const [d, org] = await Promise.all([
        jfetch("/api/sales/bids/notify-settings"),
        orgSnapshot ? Promise.resolve(null) : jfetch("/api/sales/org"),
      ]);
      if (d?.settings) setNotifySettings(d.settings);
      setNotifyPending(Number(d?.pending ?? 0));
      setNotifyLastSentAt(d?.lastSentAt ?? null);
      if (org) setOrgSnapshot(org as OrganizationSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNotifyBusy(false);
    }
  };

  const saveNotifySettings = async () => {
    setNotifyBusy(true);
    try {
      const d = await jfetch("/api/sales/bids/notify-settings", {
        method: "PUT",
        body: JSON.stringify(notifySettings),
      });
      if (d?.settings) setNotifySettings(d.settings);
      setNotifyModal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNotifyBusy(false);
    }
  };

  const toggleRecipient = (emp: OrganizationEmployeeRow) => {
    setNotifySettings((prev) => {
      const exists = prev.recipients.some((r) => r.employeeId === emp.employeeId);
      return {
        ...prev,
        recipients: exists
          ? prev.recipients.filter((r) => r.employeeId !== emp.employeeId)
          : [...prev.recipients, { employeeId: emp.employeeId, name: emp.name, channels: ["kakao"] }],
      };
    });
  };

  const toggleRecipientChannel = (employeeId: string, ch: NotifyChannel) => {
    setNotifySettings((prev) => ({
      ...prev,
      recipients: prev.recipients.map((r) =>
        r.employeeId === employeeId
          ? { ...r, channels: r.channels.includes(ch) ? r.channels.filter((c) => c !== ch) : [...r.channels, ch] }
          : r
      ),
    }));
  };

  const toggleNotifyBidType = (t: BidType) => {
    setNotifySettings((prev) => ({
      ...prev,
      bidTypes: prev.bidTypes.includes(t) ? prev.bidTypes.filter((x) => x !== t) : [...prev.bidTypes, t],
    }));
  };

  // ── 발송 항목 구성 — 후보는 열 설정과 동일 소스(view-config: 표준 컬럼 + 최근 raw 키 + 한글명) ──
  const loadFieldCandidates = useCallback(
    async (t: BidType) => {
      if (fieldCandCache[t]) return;
      setFieldBusy(true);
      try {
        const d = await jfetch(`/api/sales/bids/view-config?bidType=${t}`);
        setFieldCandCache((prev) => ({ ...prev, [t]: Array.isArray(d.candidates) ? d.candidates : [] }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setFieldBusy(false);
      }
    },
    [fieldCandCache]
  );

  const openFieldModal = () => {
    const t = notifySettings.bidTypes[0] ?? "bid_notice";
    setFieldBidType(t);
    setFieldLeftSel(null);
    setFieldRightSel(-1);
    setFieldModal(true);
    loadFieldCandidates(t);
  };

  const fieldSelected = notifySettings.contentFields[fieldBidType] ?? [];
  const setFieldSelected = (next: NotifyContentField[]) =>
    setNotifySettings((prev) => ({
      ...prev,
      contentFields: { ...prev.contentFields, [fieldBidType]: next },
    }));

  const fieldMoveRight = () => {
    if (!fieldLeftSel) return;
    if (fieldSelected.some((f) => f.name === fieldLeftSel)) return;
    const cand = (fieldCandCache[fieldBidType] ?? []).find((c) => c.name === fieldLeftSel);
    setFieldSelected([...fieldSelected, { name: fieldLeftSel, label: cand?.nameKo ?? fieldLeftSel }]);
    setFieldLeftSel(null);
  };

  const fieldMoveLeft = () => {
    if (fieldRightSel < 0 || fieldRightSel >= fieldSelected.length) return;
    setFieldSelected(fieldSelected.filter((_, i) => i !== fieldRightSel));
    setFieldRightSel(-1);
  };

  const fieldMove = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fieldSelected.length) return;
    const next = [...fieldSelected];
    [next[i], next[j]] = [next[j], next[i]];
    setFieldSelected(next);
    setFieldRightSel(j);
  };

  // ── 열 설정 ──
  const openColModal = async () => {
    setColModal(true);
    setColBusy(true);
    try {
      const d = await jfetch(`/api/sales/bids/view-config?bidType=${bidType}`);
      setColDraft(Array.isArray(d.columns) ? d.columns : []);
      setColCandidates(Array.isArray(d.candidates) ? d.candidates : []);
      setColIsDefault(!!d.isDefault);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setColBusy(false);
    }
  };

  const saveColConfig = async (cols: ViewColumn[]) => {
    setColBusy(true);
    try {
      const d = await jfetch("/api/sales/bids/view-config", {
        method: "PUT",
        body: JSON.stringify({ bidType, columns: cols }),
      });
      setColDraft(Array.isArray(d.columns) ? d.columns : []);
      setColIsDefault(!!d.isDefault);
      setColModal(false);
      setSortCol(-1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setColBusy(false);
    }
  };

  const koOf = (name: string) => colCandidates.find((c) => c.name === name)?.nameKo;

  const addColumn = () => {
    if (!ncLabel.trim() || ncParts.length === 0) return;
    const col: ViewColumn = {
      label: ncLabel.trim(),
      parts: ncParts,
      mode: ncParts.length > 1 ? ncMode : "single",
      ...(ncMode === "join" && ncParts.length > 1 ? { sep: ncSep } : {}),
      ...(ncMode === "calc" && ncParts.length > 1 ? { op: ncOp } : {}),
      ...(ncFormat !== "text" ? { format: ncFormat } : {}),
      ...(ncSortable ? { sortable: true } : {}),
    };
    setColDraft((p) => [...p, col]);
    setNcLabel("");
    setNcParts([]);
    setNcMode("single");
    setNcSortable(false);
    setNcFormat("text");
  };

  const removeCategory = async (c: BidCategory) => {
    if (!confirm(`분류 "${c.name}"를 삭제할까요?`)) return;
    setCatBusy(true);
    try {
      await jfetch(`/api/sales/bids/categories/${c.categoryId}`, { method: "DELETE" });
      if (categoryId === c.categoryId) setCategoryId("");
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCatBusy(false);
    }
  };

  // 알림 수신자 조직도 — 영업 스케쥴 모달과 동일하게 담당자(rank>=60)만 남기고 빈 부서 축소.
  const notifyTreeSnapshot = useMemo<OrganizationSnapshot | null>(() => {
    if (!orgSnapshot) return null;
    const emps = orgSnapshot.employees.filter(
      (e) => (e.positionRankOrder ?? 0) >= MIN_NOTIFY_RANK && !NOTIFY_EXCLUDE_NAMES.includes(e.name)
    );
    const byId = new Map(orgSnapshot.departments.map((d) => [d.deptId, d]));
    const keep = new Set<string>();
    for (const e of emps) {
      let cur: string | null = e.deptId ?? null;
      while (cur && !keep.has(cur)) {
        keep.add(cur);
        cur = byId.get(cur)?.parentDeptId ?? null;
      }
    }
    return { ...orgSnapshot, employees: emps, departments: orgSnapshot.departments.filter((d) => keep.has(d.deptId)) };
  }, [orgSnapshot]);

  // 상세 모달의 주요 raw 필드(있을 때만 표시)
  const rawExtras: { label: string; key: string }[] = [
    { label: "담당부서", key: "deptNm" },
    { label: "담당자", key: "ofclNm" },
    { label: "전화", key: "telNo" },
    { label: "공사지역", key: "cnstwkRgnNm" },
    { label: "발주년도", key: "orderYear" },
    { label: "발주월", key: "orderMnth" },
    { label: "총괄기관", key: "totlmngInsttNm" },
  ];

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Gavel className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="공공입찰"
        titleSuffix={`${total.toLocaleString()}건`}
        subtitle="나라장터(조달청) 발주계획·사전규격·입찰공고를 수집해 종류별로 조회합니다."
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" className="cd-chip" onClick={openColModal}>
                <Columns3 className="w-3.5 h-3.5" /> 열 설정
              </button>
              <button type="button" className="cd-chip" onClick={() => setCatModal(true)}>
                <Tags className="w-3.5 h-3.5" /> 분류 설정
              </button>
              <button type="button" className="cd-chip" onClick={openNotifyModal}>
                <BellRing className="w-3.5 h-3.5" /> 매칭 알림
              </button>
              <Link href="/sales/bids/sources" className="cd-chip">
                <Wand2 className="w-3.5 h-3.5" /> 공공입찰 소스
              </Link>
            </div>
          ) : undefined
        }
      />

      {/* 입찰 서류 생성 진행 중 — 저장된 패키지 작업으로 바로가기 */}
      {activePackages.length > 0 && (
        <section className="cd-solid-bg rounded-2xl border cd-border-c p-3">
          <h3 className="text-[12px] font-bold cd-text flex items-center gap-1.5 mb-2">
            <FileStack className="w-4 h-4 cd-text-primary" /> 입찰 서류 생성 진행 중
            <span className="text-[10px] font-normal cd-text-faint">{activePackages.length}건</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {activePackages.map((p) => (
              <div
                key={`${p.bidType}-${p.bidId}`}
                className="rounded-xl border cd-border-c flex items-center max-w-[460px] overflow-hidden"
              >
                <Link
                  href={`/sales/bids/package?bidType=${encodeURIComponent(p.bidType)}&bidId=${encodeURIComponent(p.bidId)}`}
                  className="px-3 py-2 hover:bg-[color:var(--cd-surface)] flex items-center gap-2 min-w-0"
                >
                  <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary shrink-0">{TYPE_LABEL[p.bidType as BidType] ?? p.bidType}</span>
                  <span className="text-[12px] cd-text truncate">{p.title || p.bidId}</span>
                  <span className="text-[10px] cd-text-faint font-mono shrink-0">
                    {p.deadline ? `마감 ${short(p.deadline)}` : short(p.updatedAt)}
                  </span>
                </Link>
                {p.output && (
                  <a
                    href={`/api/sales/bids/package/output?bidType=${encodeURIComponent(p.bidType)}&bidId=${encodeURIComponent(p.bidId)}`}
                    className="px-2.5 py-2 border-l cd-border-c hover:bg-[color:var(--cd-surface)] shrink-0 cd-text-primary"
                    title={`최근 생성본 다운로드 — ${short(p.output.generatedAt)} 생성 · 경고 ${p.output.warningCount}건`}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="cd-solid-bg rounded-2xl border cd-border-c p-4">
        {/* 종류 탭 */}
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {TABS.map((t) => (
            <button key={t.key} className="cd-chip cd-chip-sm" data-active={bidType === t.key} onClick={() => setBidType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 기본 필터 */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-1.5">
            <Search className="w-4 h-4 cd-text-faint" />
            <input className="cd-input" style={{ width: 220 }} placeholder="사업명·발주기관 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="cd-select" style={{ width: "auto" }} value={workType} onChange={(e) => setWorkType(e.target.value)}>
            <option value="">업무구분 전체</option>
            <option value="용역">용역</option>
            <option value="공사">공사</option>
            <option value="물품">물품</option>
            <option value="외자">외자</option>
          </select>
          <select className="cd-select" style={{ width: "auto" }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">용역 분류 전체</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
            ))}
          </select>
          <select className="cd-select" style={{ width: "auto" }} value={regionGroup} onChange={(e) => setRegionGroup(e.target.value)}>
            <option value="">지역권 전체</option>
            {REGION_GROUPS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select className="cd-select" style={{ width: "auto" }} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">계약방법 전체</option>
            {methodOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {method && !methodOptions.includes(method) && <option value={method}>{method}</option>}
          </select>
          <button type="button" className="cd-chip cd-chip-sm" data-active={showFilters} onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> 기간·금액
          </button>
        </div>

        {/* 확장 필터: 게시일 기간 + 예산 금액대 */}
        {showFilters && (
          <div className="flex items-center gap-3 flex-wrap mb-3 rounded-lg border cd-border-c px-3 py-2 text-[12px] cd-text-muted">
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              게시일
              <input type="date" className="cd-input text-[12px]" style={{ width: 140 }} value={postedFrom} onChange={(e) => setPostedFrom(e.target.value)} />
              ~
              <input type="date" className="cd-input text-[12px]" style={{ width: 140 }} value={postedTo} onChange={(e) => setPostedTo(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              예산
              <input type="number" min={0} className="cd-input text-[12px]" style={{ width: 110 }} placeholder="최소(만원)" value={budgetMinMan} onChange={(e) => setBudgetMinMan(e.target.value)} />
              ~
              <input type="number" min={0} className="cd-input text-[12px]" style={{ width: 110 }} placeholder="최대(만원)" value={budgetMaxMan} onChange={(e) => setBudgetMaxMan(e.target.value)} />
              만원
            </label>
            <button
              type="button"
              className="cd-btn cd-btn-soft text-[11px]"
              onClick={() => {
                setPostedFrom("");
                setPostedTo("");
                setBudgetMinMan("");
                setBudgetMaxMan("");
              }}
            >
              초기화
            </button>
          </div>
        )}

        {/* 테이블 — 커스텀 열 구성(columns) 기반 동적 렌더. 헤더 클릭 정렬(sortable 열). */}
        <div className="overflow-x-auto">
          <table className="cd-table text-[13px] w-full">
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={`${c.label}-${i}`}
                    className={(c.format === "money" ? "text-right " : "text-left ") + (c.sortable ? "cursor-pointer select-none" : "")}
                    onClick={
                      c.sortable
                        ? () => {
                            if (sortCol !== i) {
                              setSortCol(i);
                              setSortDir("desc");
                            } else if (sortDir === "desc") {
                              setSortDir("asc");
                            } else {
                              setSortCol(-1); // 기본 정렬로 복귀
                            }
                          }
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {c.label}
                      {sortCol === i && (sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bidId} className="cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => openDetail(bidType, r.bidId)}>
                  {columns.map((c, i) => {
                    const v = r.cells?.[i] ?? null;
                    if (c.format === "link") {
                      return (
                        <td key={i} onClick={(e) => e.stopPropagation()}>
                          {v ? (
                            <a href={v} target="_blank" rel="noreferrer" className="cd-text-muted hover:cd-text">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                      );
                    }
                    if (c.format === "money") {
                      return <td key={i} className="text-right font-mono tabular-nums">{fmtMoney(v != null ? Number(v) : null)}</td>;
                    }
                    if (c.format === "date") {
                      return <td key={i} className="font-mono text-[12px] cd-text-faint">{short(v)}</td>;
                    }
                    return <td key={i} className="truncate max-w-[280px]">{v ?? "-"}</td>;
                  })}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="text-center py-8 cd-text-faint">
                    {error ? "불러오지 못했습니다." : "수집된 공고가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          total={total}
          limit={PAGE_SIZE}
          offset={offset}
          loading={loading}
          onPageChange={setOffset}
        />
      </section>

      {/* 상세 모달 (인라인 오버레이 — .cdash 내부라 토큰 유지) */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setDetail(null)}>
          <div className="cd-solid-bg rounded-2xl border cd-border-c w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {detailLoading && <p className="text-[13px] cd-text-faint py-8 text-center">불러오는 중…</p>}
            {detail && (
              <>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold" style={{ color: "var(--cd-primary)" }}>{TYPE_LABEL[detailType]}</div>
                    <h3 className="text-[15px] font-bold cd-text">{detail.title ?? "-"}</h3>
                    <div className="text-[12px] cd-text-muted">{detail.orgName ?? "-"}</div>
                  </div>
                  <button type="button" className="cd-btn cd-btn-soft text-[12px] shrink-0" onClick={() => setDetail(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
                  <div><span className="cd-text-faint">공고번호</span><div className="cd-text font-mono">{detail.externalId}</div></div>
                  <div><span className="cd-text-faint">예산</span><div className="cd-text">{fmtMoney(detail.budget)}</div></div>
                  <div><span className="cd-text-faint">게시일</span><div className="cd-text font-mono">{short(detail.postedAt)}</div></div>
                  {detailType === "order_plan" ? (
                    <div><span className="cd-text-faint">발주시기</span><div className="cd-text font-mono">{detail.orderPeriod ?? "-"}</div></div>
                  ) : (
                    <div><span className="cd-text-faint">마감</span><div className="cd-text font-mono">{short(detail.deadline)}</div></div>
                  )}
                  <div><span className="cd-text-faint">조달방식</span><div className="cd-text">{detail.method ?? "-"}</div></div>
                  <div><span className="cd-text-faint">업무구분</span><div className="cd-text">{detail.workType ?? "-"}</div></div>
                  {rawExtras.map(({ label, key }) => {
                    const v = detail.raw?.[key];
                    if (v == null || v === "") return null;
                    return (
                      <div key={key}><span className="cd-text-faint">{label}</span><div className="cd-text truncate">{String(v)}</div></div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  {detail.url && (
                    <a href={detail.url} target="_blank" rel="noreferrer" className="cd-chip" style={{ color: "var(--cd-primary)" }}>
                      <ExternalLink className="w-3.5 h-3.5" /> 원문 보기
                    </a>
                  )}
                  {/* 입찰 증빙서류 패키지 생성(전용 페이지) — docs/bid-package-blueprint.md */}
                  <Link
                    href={`/sales/bids/package?bidType=${encodeURIComponent(detailType)}&bidId=${encodeURIComponent(detail.bidId)}`}
                    className="cd-chip"
                    style={{ color: "var(--cd-primary)" }}
                  >
                    <FileStack className="w-3.5 h-3.5" /> 입찰 서류 생성
                  </Link>
                </div>

                {/* 첨부파일 — raw 의 …DocUrl{N}/…FileNm{N} 쌍(공고문·과업지시서·제안요청서 등 직다운로드) */}
                {(() => {
                  const atts = extractAttachments(detail.raw);
                  if (!atts.length) return null;
                  return (
                    <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
                      <h4 className="text-[12px] font-bold cd-text flex items-center gap-1">
                        <Paperclip className="w-3.5 h-3.5" /> 첨부파일 ({atts.length})
                      </h4>
                      {atts.map((a, i) => (
                        <a
                          key={`${a.url}-${i}`}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] cd-text-muted hover:cd-text flex items-center gap-1.5 min-w-0"
                        >
                          <Paperclip className="w-3 h-3 shrink-0 cd-text-faint" />
                          <span className="truncate">{a.name}</span>
                        </a>
                      ))}
                    </div>
                  );
                })()}

                {/* 연계 공고 — 발주계획↔사전규격↔입찰공고 */}
                <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
                  <h4 className="text-[12px] font-bold cd-text flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" /> 같은 사업의 연계 공고
                  </h4>
                  {related.length === 0 && <p className="text-[12px] cd-text-faint">연계된 발주계획·사전규격·입찰공고를 찾지 못했습니다.</p>}
                  {related.map((r) => (
                    <button
                      key={`${r.bidType}-${r.bidId}`}
                      type="button"
                      onClick={() => openDetail(r.bidType, r.bidId)}
                      className="text-left rounded-lg border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-surface)] flex items-center gap-2"
                    >
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary shrink-0">{TYPE_LABEL[r.bidType]}</span>
                      <span className="text-[12px] cd-text truncate flex-1">{r.title ?? "-"}</span>
                      <span className="text-[11px] cd-text-faint font-mono shrink-0">{short(r.postedAt)}</span>
                    </button>
                  ))}
                </div>

                <details>
                  <summary className="text-[11px] cd-text-faint cursor-pointer">원본 데이터(전체 필드)</summary>
                  <pre className="text-[11px] cd-text-muted bg-[color:var(--cd-surface)] rounded p-2 overflow-x-auto max-h-60 mt-1">
                    {JSON.stringify(detail.raw, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </div>
        </div>
      )}

      {/* 열 설정 모달 — 탭(종류)별 표시 열 구성: 순서·조합(구분자/사칙연산)·형식·정렬 여부 */}
      {colModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setColModal(false)}>
          <div className="cd-solid-bg rounded-2xl border cd-border-c w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex items-center gap-1.5 flex-1">
                <Columns3 className="w-4 h-4" /> 열 설정 — {TABS.find((t) => t.key === bidType)?.label}
                {colIsDefault && <span className="text-[11px] cd-text-faint">(기본 구성)</span>}
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setColModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] cd-text-faint">
              엔드포인트가 수집하는 필드로 열을 구성합니다. 여러 필드를 한 열에 조합(구분자 결합·사칙연산)할 수 있고, 순서와 정렬 가능 여부를 지정합니다.
            </p>

            {/* 현재 열 목록 */}
            <div className="flex flex-col gap-1.5">
              {colDraft.map((c, i) => (
                <div key={`${c.label}-${i}`} className="rounded-lg border cd-border-c px-3 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] cd-text font-semibold">{c.label}</div>
                    <div className="text-[11px] cd-text-faint truncate font-mono">
                      {c.parts.join(c.mode === "calc" ? ` ${c.op ?? "+"} ` : c.mode === "join" ? ` ${c.sep ?? ", "} ` : ", ")}
                      {c.format && c.format !== "text" ? ` · ${c.format}` : ""}
                    </div>
                  </div>
                  <label className="text-[11px] cd-text-muted flex items-center gap-1 whitespace-nowrap cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!c.sortable}
                      onChange={() => setColDraft((p) => p.map((x, j) => (j === i ? { ...x, sortable: !x.sortable } : x)))}
                    />
                    정렬
                  </label>
                  <button type="button" disabled={i === 0} className="cd-btn cd-btn-soft text-[11px] disabled:opacity-40"
                    onClick={() => setColDraft((p) => { const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" disabled={i === colDraft.length - 1} className="cd-btn cd-btn-soft text-[11px] disabled:opacity-40"
                    onClick={() => setColDraft((p) => { const n = [...p]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n; })}>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="cd-btn cd-btn-soft text-[11px]" onClick={() => setColDraft((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {colDraft.length === 0 && <p className="text-[12px] cd-text-faint">열이 없습니다 — 저장하면 기본 구성으로 복귀합니다.</p>}
            </div>

            {/* 열 추가 */}
            <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
              <div className="text-[11px] font-bold cd-text-faint">열 추가</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input className="cd-input text-[13px]" style={{ width: 140 }} placeholder="열 이름 (예: 발주시기)" value={ncLabel} onChange={(e) => setNcLabel(e.target.value)} />
                <select className="cd-select text-[12px]" style={{ width: 220 }} value={ncPartSel} onChange={(e) => setNcPartSel(e.target.value)}>
                  <option value="">필드 선택…</option>
                  {colCandidates.map((f) => (
                    <option key={f.name} value={f.name}>{f.nameKo ? `${f.nameKo} (${f.name})` : f.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cd-btn cd-btn-soft text-[12px]"
                  disabled={!ncPartSel || ncParts.includes(ncPartSel) || ncParts.length >= 5}
                  onClick={() => { setNcParts((p) => [...p, ncPartSel]); setNcPartSel(""); }}
                >
                  <Plus className="w-3.5 h-3.5" /> 필드 추가
                </button>
              </div>
              {ncParts.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {ncParts.map((p) => (
                    <span key={p} className="cd-chip cd-chip-sm font-mono">
                      {koOf(p) ? `${koOf(p)}(${p})` : p}
                      <button type="button" className="ml-1" onClick={() => setNcParts((prev) => prev.filter((x) => x !== p))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap text-[12px] cd-text-muted">
                {ncParts.length > 1 && (
                  <>
                    <select className="cd-select text-[12px]" value={ncMode} onChange={(e) => setNcMode(e.target.value as typeof ncMode)}>
                      <option value="join">구분자로 결합</option>
                      <option value="single">첫 값만</option>
                      <option value="calc">사칙연산</option>
                    </select>
                    {ncMode === "join" && (
                      <input className="cd-input text-[12px] font-mono" style={{ width: 64 }} placeholder="구분자" title="구분자 (예: / 또는 ,)" value={ncSep} onChange={(e) => setNcSep(e.target.value)} />
                    )}
                    {ncMode === "calc" && (
                      <select className="cd-select text-[12px]" value={ncOp} onChange={(e) => setNcOp(e.target.value as typeof ncOp)}>
                        <option value="+">+ 더하기</option>
                        <option value="-">− 빼기</option>
                        <option value="*">× 곱하기</option>
                        <option value="/">÷ 나누기</option>
                      </select>
                    )}
                  </>
                )}
                <select className="cd-select text-[12px]" value={ncFormat} onChange={(e) => setNcFormat(e.target.value as typeof ncFormat)}>
                  <option value="text">형식: 텍스트</option>
                  <option value="money">형식: 금액(억/만)</option>
                  <option value="date">형식: 일시</option>
                  <option value="link">형식: 링크</option>
                </select>
                <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={ncSortable} onChange={(e) => setNcSortable(e.target.checked)} /> 정렬 가능
                </label>
                <button type="button" className="cd-btn cd-btn-primary text-[12px] disabled:opacity-50" disabled={!ncLabel.trim() || ncParts.length === 0} onClick={addColumn}>
                  <Plus className="w-3.5 h-3.5" /> 열 추가
                </button>
              </div>
            </div>

            <div className="border-t cd-border-c pt-3 flex items-center gap-2">
              <button type="button" disabled={colBusy} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50" onClick={() => saveColConfig(colDraft)}>
                저장
              </button>
              <button type="button" disabled={colBusy} className="cd-btn cd-btn-soft text-[13px] disabled:opacity-50" onClick={() => saveColConfig([])}>
                기본값 복원
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 분류 설정 모달 — 조건 그룹(AND/OR/NOR) 에디터 */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => { setCatModal(false); resetCatForm(); }}>
          <div className="cd-solid-bg rounded-2xl border cd-border-c w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex items-center gap-1.5 flex-1">
                <Tags className="w-4 h-4" /> 용역 분류 설정
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => { setCatModal(false); resetCatForm(); }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] cd-text-faint">
              조건마다 키워드와 논리식(AND=모두 포함 / OR=하나라도 포함 / NOT=모두 동시 포함만 제외 / NOR=하나라도 있으면 제외)을 정하고, 조건 사이는 AND 로 결합됩니다.
              예: 조건1 [통합환경 OR 통합허가] + 조건2 [NOR 조성공사, 개선공사] → &quot;통합환경 조성공사&quot; 같은 무관 건 제외.
            </p>
            <div className="flex flex-col gap-2">
              {categories.map((c) => (
                <div key={c.categoryId} className="rounded-lg border cd-border-c px-3 py-2 flex items-center gap-2" data-active={editingCatId === c.categoryId}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] cd-text font-semibold">{c.name}</div>
                    <div className="text-[11px] cd-text-faint truncate">{ruleSummaryText(c)}</div>
                  </div>
                  <button type="button" disabled={catBusy} className="cd-btn cd-btn-soft text-[11px]" title="편집" onClick={() => startEditCategory(c)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" disabled={catBusy} className="cd-btn cd-btn-soft text-[11px]" title="삭제" onClick={() => removeCategory(c)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {categories.length === 0 && <p className="text-[12px] cd-text-faint">등록된 분류가 없습니다.</p>}
            </div>

            <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input className="cd-input text-[13px] flex-1" placeholder="분류명 (예: 통합허가)" value={catName} onChange={(e) => setCatName(e.target.value)} />
                {editingCatId && (
                  <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={resetCatForm}>
                    편집 취소
                  </button>
                )}
              </div>

              {catGroups.map((g, gi) => (
                <div key={gi}>
                  {gi > 0 && (
                    <div className="text-[11px] cd-text-faint font-semibold pl-2 py-0.5">AND</div>
                  )}
                  <div className="rounded-xl border cd-border-c px-3 py-2.5 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] cd-text font-semibold flex-1">조건 {gi + 1}</span>
                      {catGroups.length > 1 && (
                        <button
                          type="button"
                          className="cd-btn cd-btn-soft text-[11px]"
                          onClick={() => {
                            setCatGroups((prev) => prev.filter((_, i) => i !== gi));
                            setKwDrafts((prev) => prev.filter((_, i) => i !== gi));
                            setExDrafts((prev) => prev.filter((_, i) => i !== gi));
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {g.keywords.map((kw) => (
                        <span key={kw} className="cd-chip cd-chip-sm">
                          {kw}
                          <button
                            type="button"
                            className="ml-1"
                            onClick={() =>
                              setCatGroups((prev) =>
                                prev.map((gr, i) => (i === gi ? { ...gr, keywords: gr.keywords.filter((k) => k !== kw) } : gr))
                              )
                            }
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        className="cd-input text-[12px]"
                        style={{ width: 140 }}
                        placeholder="키워드 입력"
                        value={kwDrafts[gi] ?? ""}
                        onChange={(e) => setKwDrafts((prev) => prev.map((v, i) => (i === gi ? e.target.value : v)))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addKeywordToGroup(gi);
                          }
                        }}
                        onBlur={() => addKeywordToGroup(gi)}
                      />
                      <button type="button" className="cd-btn cd-btn-soft text-[11px]" onClick={() => addKeywordToGroup(gi)}>
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {OP_LABELS.map((op) => (
                        <button
                          key={op.key}
                          type="button"
                          className="cd-chip cd-chip-sm"
                          data-active={g.op === op.key}
                          title={op.desc}
                          onClick={() => setCatGroups((prev) => prev.map((gr, i) => (i === gi ? { ...gr, op: op.key } : gr)))}
                        >
                          {op.label}
                        </button>
                      ))}
                      <span className="text-[10px] cd-text-faint">{OP_LABELS.find((o) => o.key === g.op)?.desc}</span>
                    </div>
                    {/* 예외 — 제외 그룹에서만. 제외어 판정 전에 사업명에서 이 문구를 가린다(부분문자열 오탐 방지). */}
                    {(g.op === "not" || g.op === "nor") && (
                      <div className="flex items-center gap-1.5 flex-wrap border-t cd-border-c pt-2">
                        <span className="text-[11px] cd-text-faint whitespace-nowrap">예외</span>
                        {(g.except ?? []).map((kw) => (
                          <span key={kw} className="cd-chip cd-chip-sm">
                            {kw}
                            <button
                              type="button"
                              className="ml-1"
                              onClick={() =>
                                setCatGroups((prev) =>
                                  prev.map((gr, i) =>
                                    i === gi ? { ...gr, except: (gr.except ?? []).filter((k) => k !== kw) } : gr
                                  )
                                )
                              }
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        <input
                          className="cd-input text-[12px]"
                          style={{ width: 140 }}
                          placeholder="예: 하수도시설"
                          value={exDrafts[gi] ?? ""}
                          onChange={(e) => setExDrafts((prev) => prev.map((v, i) => (i === gi ? e.target.value : v)))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addExceptToGroup(gi);
                            }
                          }}
                          onBlur={() => addExceptToGroup(gi)}
                        />
                        <button type="button" className="cd-btn cd-btn-soft text-[11px]" onClick={() => addExceptToGroup(gi)}>
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] cd-text-faint">
                          이 문구는 제외 검사에서 가려집니다 — &quot;하수도시설&quot;을 넣으면 제외어 &quot;수도시설&quot;에 걸리지 않습니다.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="cd-btn cd-btn-soft text-[12px] self-start"
                onClick={() => {
                  // 입력 중이던 키워드를 먼저 확정한 뒤 새 조건을 추가한다.
                  const merged = mergeDrafts(catGroups, kwDrafts, exDrafts);
                  setCatGroups([...merged, { op: "or", keywords: [] }]);
                  setKwDrafts([...merged.map(() => ""), ""]);
                  setExDrafts([...merged.map(() => ""), ""]);
                  setCatError(null);
                }}
              >
                <Plus className="w-3.5 h-3.5" /> 조건 추가 (AND)
              </button>

              <p className="text-[11px] cd-text-faint">
                적용될 조건식: <b>{ruleSummaryText({ categoryId: "", name: catName, keywords: [], rule: mergeDrafts(catGroups, kwDrafts, exDrafts).filter((g) => g.keywords.length), enabled: true })}</b>
              </p>
              {catError && <p className="text-[11px] cd-error-text">{catError}</p>}

              <button
                type="button"
                disabled={catBusy || !catName.trim() || !mergeDrafts(catGroups, kwDrafts, exDrafts).some((g) => g.keywords.length)}
                className="cd-btn cd-btn-primary text-[13px] self-start disabled:opacity-50"
                onClick={saveCategory}
              >
                <Plus className="w-4 h-4" /> {editingCatId ? "분류 수정" : "분류 추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 매칭 알림 설정 모달 — 수신자(조직도)·채널·발송 시각 */}
      {notifyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setNotifyModal(false)}>
          <div className="cd-solid-bg rounded-2xl border cd-border-c w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex items-center gap-1.5 flex-1">
                <BellRing className="w-4 h-4" /> 사업분야 매칭 알림 설정
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setNotifyModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] cd-text-faint">
              신규 수집 공고가 용역 분류 조건에 매칭되면 아래 수신자에게 매일 발송 시각에 요약을 전송합니다.
              카카오톡(알림톡)·메일은 발송 계정 설정 후 활성화됩니다. 앱 푸시는 모바일 앱에 로그인한
              기기로 전송되며, 직원 프로필에 로그인 계정이 연결돼 있어야 합니다.
              {notifyPending > 0 && <> · 발송 대기 <b>{notifyPending}건</b></>}
              {notifyLastSentAt && <> · 최근 발송 {short(notifyLastSentAt)}</>}
            </p>

            <div className="flex items-center gap-4 flex-wrap rounded-lg border cd-border-c px-3 py-2">
              <label className="flex items-center gap-2 text-[13px] cd-text">
                <input
                  type="checkbox"
                  checked={notifySettings.enabled}
                  onChange={(e) => setNotifySettings((p) => ({ ...p, enabled: e.target.checked }))}
                />
                알림 활성화
              </label>
              <label className="flex items-center gap-2 text-[13px] cd-text whitespace-nowrap">
                발송 시각
                <input
                  type="time"
                  className="cd-input text-[13px]"
                  style={{ width: 110 }}
                  value={notifySettings.sendTime}
                  onChange={(e) => setNotifySettings((p) => ({ ...p, sendTime: e.target.value }))}
                />
              </label>
              <span className="flex items-center gap-2 text-[13px] cd-text whitespace-nowrap">
                발송 대상
                {TABS.map((t) => (
                  <label key={t.key} className="flex items-center gap-1 text-[12px] cd-text-muted whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={notifySettings.bidTypes.includes(t.key)}
                      onChange={() => toggleNotifyBidType(t.key)}
                    />
                    {t.label}
                  </label>
                ))}
              </span>
              <label className="flex items-center gap-2 text-[13px] cd-text whitespace-nowrap">
                마감 임박 알림
                <select
                  className="cd-input text-[13px]"
                  style={{ width: 96 }}
                  value={String(notifySettings.deadlineDays)}
                  onChange={(e) => setNotifySettings((p) => ({ ...p, deadlineDays: Number(e.target.value) }))}
                >
                  <option value="0">사용 안 함</option>
                  <option value="1">D-1</option>
                  <option value="3">D-3</option>
                  <option value="5">D-5</option>
                  <option value="7">D-7</option>
                </select>
              </label>
              <button type="button" className="cd-chip cd-chip-sm" onClick={openFieldModal}>
                <ListOrdered className="w-3.5 h-3.5" /> 발송 항목 구성
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg border cd-border-c p-2 min-h-[260px]">
                <div className="text-[12px] cd-text-faint mb-1 px-1">조직도에서 수신자를 클릭해 추가/제거</div>
                {notifyTreeSnapshot ? (
                  <OrganizationTree snapshot={notifyTreeSnapshot} embedded hideHeader onSelectEmployee={toggleRecipient} />
                ) : (
                  <p className="text-[12px] cd-text-faint p-2">{notifyBusy ? "조직도 불러오는 중…" : "조직도를 불러오지 못했습니다."}</p>
                )}
              </div>
              <div className="rounded-lg border cd-border-c p-2 flex flex-col gap-1.5">
                <div className="text-[12px] cd-text-faint px-1">수신자 {notifySettings.recipients.length}명 — 인원별 알림 수단</div>
                {notifySettings.recipients.map((r) => (
                  <div key={r.employeeId} className="rounded-lg border cd-border-c px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] cd-text font-semibold">{r.name}</span>
                    <span className="flex items-center gap-2 flex-1 flex-wrap">
                      {CHANNEL_LABELS.map((ch) => (
                        <label key={ch.key} className="flex items-center gap-1 text-[11px] cd-text-muted whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={r.channels.includes(ch.key)}
                            onChange={() => toggleRecipientChannel(r.employeeId, ch.key)}
                          />
                          {ch.label}
                        </label>
                      ))}
                    </span>
                    <button
                      type="button"
                      className="cd-btn cd-btn-soft text-[11px]"
                      onClick={() =>
                        setNotifySettings((p) => ({ ...p, recipients: p.recipients.filter((x) => x.employeeId !== r.employeeId) }))
                      }
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {notifySettings.recipients.length === 0 && (
                  <p className="text-[12px] cd-text-faint p-2">왼쪽 조직도에서 담당자를 클릭하세요.</p>
                )}
              </div>
            </div>

            <div className="border-t cd-border-c pt-3 flex items-center gap-2">
              <button type="button" disabled={notifyBusy} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50" onClick={saveNotifySettings}>
                저장
              </button>
              <button type="button" className="cd-btn cd-btn-soft text-[13px]" onClick={() => setNotifyModal(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 발송 항목 구성 모달 — 좌: 수집된 전체 파라미터, 우: 발송 포함 항목(위→아래 순서) */}
      {fieldModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setFieldModal(false)}>
          <div className="cd-solid-bg rounded-2xl border cd-border-c w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex items-center gap-1.5 flex-1">
                <ListOrdered className="w-4 h-4" /> 발송 항목 구성
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setFieldModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] cd-text-faint">
              종류별로 발송 본문에 포함할 항목을 선택하고 순서를 정합니다. 왼쪽(수집된 전체 항목)에서 선택 후 화살표로 이동하세요.
              항목을 구성하지 않은 종류는 기본 구성(분류·사업명·기관·마감·링크)으로 발송됩니다.
            </p>

            {/* 종류 탭 */}
            <div className="flex items-center gap-1 flex-wrap">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="cd-chip cd-chip-sm"
                  data-active={fieldBidType === t.key}
                  onClick={() => {
                    setFieldBidType(t.key);
                    setFieldLeftSel(null);
                    setFieldRightSel(-1);
                    loadFieldCandidates(t.key);
                  }}
                >
                  {t.label}
                  {(notifySettings.contentFields[t.key]?.length ?? 0) > 0 && (
                    <span className="ml-1 text-[10px]">({notifySettings.contentFields[t.key]!.length})</span>
                  )}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
              {/* 좌: 후보 전체 */}
              <div className="rounded-lg border cd-border-c p-2 flex flex-col gap-1 max-h-[380px] overflow-y-auto">
                <div className="text-[12px] cd-text-faint px-1 sticky top-0 cd-solid-bg">
                  수집된 항목 {fieldBusy ? "불러오는 중…" : `${(fieldCandCache[fieldBidType] ?? []).length}개`}
                </div>
                {(fieldCandCache[fieldBidType] ?? [])
                  .filter((c) => !fieldSelected.some((f) => f.name === c.name))
                  .map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className="rounded-md border cd-border-c px-2 py-1 text-left"
                      data-active={fieldLeftSel === c.name}
                      style={fieldLeftSel === c.name ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-tint, rgba(93,135,255,0.08))" } : undefined}
                      onClick={() => setFieldLeftSel(c.name)}
                      onDoubleClick={() => {
                        setFieldLeftSel(c.name);
                        const cand = (fieldCandCache[fieldBidType] ?? []).find((x) => x.name === c.name);
                        if (!fieldSelected.some((f) => f.name === c.name)) {
                          setFieldSelected([...fieldSelected, { name: c.name, label: cand?.nameKo ?? c.name }]);
                        }
                        setFieldLeftSel(null);
                      }}
                    >
                      <span className="text-[12px] cd-text">{c.nameKo ?? c.name}</span>
                      <span className="text-[10px] cd-text-faint ml-1.5">{c.name}</span>
                    </button>
                  ))}
              </div>

              {/* 가운데: 이동 버튼 */}
              <div className="flex flex-col items-center justify-center gap-2">
                <button type="button" className="cd-btn cd-btn-soft" title="포함" disabled={!fieldLeftSel} onClick={fieldMoveRight}>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button type="button" className="cd-btn cd-btn-soft" title="제외" disabled={fieldRightSel < 0} onClick={fieldMoveLeft}>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>

              {/* 우: 포함 항목(순서) */}
              <div className="rounded-lg border cd-border-c p-2 flex flex-col gap-1 max-h-[380px] overflow-y-auto">
                <div className="text-[12px] cd-text-faint px-1 sticky top-0 cd-solid-bg">발송 포함 항목 {fieldSelected.length}개 (위→아래 순서)</div>
                {fieldSelected.map((f, i) => (
                  <div
                    key={f.name}
                    className="rounded-md border cd-border-c px-2 py-1 flex items-center gap-1.5 cursor-pointer"
                    data-active={fieldRightSel === i}
                    style={fieldRightSel === i ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-tint, rgba(93,135,255,0.08))" } : undefined}
                    onClick={() => setFieldRightSel(i)}
                  >
                    <span className="text-[11px] cd-text-faint w-4 text-right">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate">
                      <span className="text-[12px] cd-text">{f.label}</span>
                      <span className="text-[10px] cd-text-faint ml-1.5">{f.name}</span>
                    </span>
                    <button type="button" className="cd-btn cd-btn-soft p-0.5" title="위로" onClick={(e) => { e.stopPropagation(); fieldMove(i, -1); }}>
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className="cd-btn cd-btn-soft p-0.5" title="아래로" onClick={(e) => { e.stopPropagation(); fieldMove(i, 1); }}>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="cd-btn cd-btn-soft p-0.5"
                      title="제외"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFieldSelected(fieldSelected.filter((_, j) => j !== i));
                        setFieldRightSel(-1);
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {fieldSelected.length === 0 && (
                  <p className="text-[12px] cd-text-faint p-2">기본 구성으로 발송됩니다. 왼쪽에서 항목을 추가하세요.</p>
                )}
              </div>
            </div>

            <div className="border-t cd-border-c pt-3 flex items-center gap-2">
              <button type="button" className="cd-btn cd-btn-primary text-[13px]" onClick={() => setFieldModal(false)}>
                적용
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-soft text-[13px]"
                onClick={() => setFieldSelected([])}
              >
                기본 구성으로
              </button>
              <span className="text-[11px] cd-text-faint">적용 후 알림 설정의 저장을 눌러야 반영됩니다.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

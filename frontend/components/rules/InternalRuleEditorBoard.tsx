"use client";

// 내부 규정 작성(/rules/internal/edit) — 사규 검수 화면(RuleAdminBoard)의 조문 트리 구조를 따라
// 장·조·항·호를 직접 편집하고, HWPX·DOCX·TXT·MD 가져오기로 기존 자료·LLM 초안을 바로 올린다(2026-09-22).
// 가져오기와 [번호 검증·교정]은 같은 규칙(lib/rules/normalize.ts)으로 장·조·항·호 번호 서열을 바로잡는다.
// 판 모델은 사규와 같다 — 작성 중(draft)만 조문을 고칠 수 있고, [시행]하면 판이 고정된다. 개정은 새 판.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, FilePlus2, FileUp, ListChecks, Loader2, Plus,
  Save, Send, Trash2, Wand2,
} from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdDateInput } from "@/components/cdash/CdField";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { InternalRuleView } from "@/components/rules/InternalRuleView";
import { circled, emptyInternalRuleBody, itemHead, normalizeRuleBody } from "@/lib/rules/normalize";
import {
  formatRegNo, type RuleArticle, type RuleBody, type RuleClause, type RuleDocumentRow, type RuleVersionRow,
} from "@/lib/rules/types";
import "@/components/cdash/cdash.css";

interface InternalDoc extends RuleDocumentRow {
  versions: RuleVersionRow[];
}

interface Meta {
  title: string;
  regNo: string; // 입력 중 문자열(숫자만)
  ownerDept: string;
  approver: string;
  enactedDate: string;
}

/** 트리 선택 — 본문 조(장 index·조 index) 또는 부칙 조 index */
type Sel = { part: "body"; ci: number; ai: number } | { part: "addendum"; ai: number } | null;

const EMPTY_META: Meta = { title: "", regNo: "", ownerDept: "", approver: "대표이사", enactedDate: "" };

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  in_consent: "동의 진행",
  published: "시행 중",
  superseded: "지난 판",
};

/** 편집 중 번호·키 재부여 — 내용은 건드리지 않는다(빈 항 제거 등은 [번호 검증·교정]에서). */
function reindex(body: RuleBody): RuleBody {
  const noChapter = body.chapters.length === 1 && body.chapters[0].no === 0;
  let chNo = 0;
  let artNo = 0;
  const chapters = body.chapters.map((ch, idx) => {
    const keepZero = noChapter || (idx === 0 && ch.no === 0);
    if (!keepZero) chNo += 1;
    return {
      ...ch,
      no: keepZero ? 0 : chNo,
      articles: ch.articles.map((a) => {
        artNo += 1;
        return { ...a, no: artNo, key: `art-${artNo}` };
      }),
    };
  });
  const numbered = body.addendum.length > 1 || body.addendum.some((a) => a.no > 0);
  const addendum = body.addendum.map((a, i) => ({ ...a, no: numbered ? i + 1 : 0, key: `addendum-${i + 1}` }));
  return { ...body, chapters, addendum };
}

/** 항이 둘 이상이면 모두 ①②… 기호, 하나면 기호 없음 */
function relabel(clauses: RuleClause[]): RuleClause[] {
  if (clauses.length <= 1) return clauses.map((c) => ({ ...c, label: "" }));
  return clauses.map((c, i) => ({ ...c, label: circled(i + 1) }));
}

function newArticle(): RuleArticle {
  return { key: "art-new", no: 0, title: "", clauses: [{ label: "", text: "", items: [] }], refs: [] };
}

export function InternalRuleEditorBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const [docs, setDocs] = useState<InternalDoc[]>([]);
  const [nextRegNo, setNextRegNo] = useState<number | null>(null);
  const [docId, setDocId] = useState<string | null>(sp.get("docId"));
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionRow, setVersionRow] = useState<RuleVersionRow | null>(null);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [body, setBody] = useState<RuleBody>(() => emptyInternalRuleBody());
  const [sel, setSel] = useState<Sel>({ part: "body", ci: 0, ai: 0 });
  const [corrections, setCorrections] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isNew = !docId;
  const editable = isNew || versionRow?.status === "draft";
  const currentDoc = useMemo(() => docs.find((d) => d.docId === docId) ?? null, [docs, docId]);
  const hasPublished = !!currentDoc?.versions.some((v) => v.status !== "draft");

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/rules/internal", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "내부 규정 목록을 불러오지 못했습니다.");
      setDocs(json.documents ?? []);
      setCanManage(json.canManage === true);
      setNextRegNo(json.nextRegNo ?? null);
      return (json.documents ?? []) as InternalDoc[];
    } catch (err) {
      setError(err instanceof Error ? err.message : "내부 규정 목록을 불러오지 못했습니다.");
      return [];
    }
  }, []);

  const resetNew = useCallback((regNo: number | null) => {
    setDocId(null);
    setVersionId(null);
    setVersionRow(null);
    setMeta({ ...EMPTY_META, regNo: regNo ? String(regNo).padStart(4, "0") : "" });
    setEffectiveDate("");
    setRevisionNote("");
    setBody(emptyInternalRuleBody());
    setSel({ part: "body", ci: 0, ai: 0 });
    setCorrections([]);
    setWarnings([]);
    setDirty(false);
  }, []);

  /** 판 열기 — 작성 중 판이 있으면 그것, 없으면 시행 중 판(읽기 전용) */
  const openDoc = useCallback(async (doc: InternalDoc, preferVersionId?: string) => {
    setError("");
    const v =
      doc.versions.find((x) => x.versionId === preferVersionId) ??
      doc.versions.find((x) => x.status === "draft") ??
      doc.versions.find((x) => x.status === "published") ??
      doc.versions[0];
    setDocId(doc.docId);
    setMeta({
      title: doc.title,
      regNo: doc.regNo ? String(doc.regNo).padStart(4, "0") : "",
      ownerDept: doc.ownerDept ?? "",
      approver: doc.approver ?? "",
      enactedDate: doc.enactedDate ?? "",
    });
    setCorrections([]);
    setDirty(false);
    if (!v) return;
    setBusy("불러오는 중");
    try {
      const res = await fetch(`/api/rules/versions/${v.versionId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "판을 불러오지 못했습니다.");
      setVersionId(v.versionId);
      setVersionRow(json.version);
      setBody(json.version.body);
      setWarnings(json.warnings ?? []);
      setEffectiveDate(json.version.effectiveDate ?? "");
      setRevisionNote(json.version.revisionNote ?? "");
      setSel(json.version.body.chapters[0]?.articles.length ? { part: "body", ci: 0, ai: 0 } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "판을 불러오지 못했습니다.");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await loadDocs();
      const want = sp.get("docId");
      const d = want ? list.find((x) => x.docId === want) : null;
      if (d) await openDoc(d);
      else setDocId(null); // 없는 규정 id 로 들어오면 새 규정 작성으로
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 신규 작성 — 다음 규정번호를 기본값으로
  useEffect(() => {
    if (isNew && nextRegNo && !meta.regNo && !dirty) setMeta((m) => ({ ...m, regNo: String(nextRegNo).padStart(4, "0") }));
  }, [isNew, nextRegNo, meta.regNo, dirty]);

  // 저장 안 한 변경이 있으면 이탈 경고
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const confirmDiscard = () => !dirty || window.confirm("저장하지 않은 변경이 있습니다. 버리고 계속할까요?");

  // ── 본문 편집 ──

  const patchBody = (next: RuleBody) => {
    setBody(reindex(next));
    setDirty(true);
  };

  const patchMeta = (patch: Partial<Meta>) => {
    setMeta((m) => ({ ...m, ...patch }));
    setDirty(true);
  };

  const selected: RuleArticle | null =
    sel?.part === "body" ? body.chapters[sel.ci]?.articles[sel.ai] ?? null : sel?.part === "addendum" ? body.addendum[sel.ai] ?? null : null;

  const replaceSelected = (next: RuleArticle) => {
    if (!sel) return;
    if (sel.part === "body") {
      patchBody({
        ...body,
        chapters: body.chapters.map((ch, ci) =>
          ci === sel.ci ? { ...ch, articles: ch.articles.map((a, ai) => (ai === sel.ai ? next : a)) } : ch,
        ),
      });
    } else {
      patchBody({ ...body, addendum: body.addendum.map((a, ai) => (ai === sel.ai ? next : a)) });
    }
  };

  const addChapter = () => {
    const chapters = [...body.chapters];
    // 장 없는 규정(장 미지정 하나)에 장을 추가하면 기존 조문을 제1장으로 올린다
    if (chapters.length === 1 && chapters[0].no === 0) chapters[0] = { ...chapters[0], no: 1, title: chapters[0].title === "(장 미지정)" ? "" : chapters[0].title };
    chapters.push({ no: chapters.length + 1, title: "", articles: [] });
    patchBody({ ...body, chapters });
  };

  const addArticle = (ci: number) => {
    let chapters = body.chapters;
    if (!chapters.length) chapters = [{ no: 0, title: "", articles: [] }];
    const target = Math.min(ci, chapters.length - 1);
    const at = sel?.part === "body" && sel.ci === target ? sel.ai + 1 : chapters[target].articles.length;
    patchBody({
      ...body,
      chapters: chapters.map((ch, i) =>
        i === target ? { ...ch, articles: [...ch.articles.slice(0, at), newArticle(), ...ch.articles.slice(at)] } : ch,
      ),
    });
    setSel({ part: "body", ci: target, ai: at });
    setTab("edit");
  };

  const addAddendum = () => {
    const at = body.addendum.length;
    patchBody({ ...body, addendum: [...body.addendum, { ...newArticle(), key: "addendum-new" }] });
    setSel({ part: "addendum", ai: at });
    setTab("edit");
  };

  /** 조 이동 — 장 경계를 넘으면 이웃 장의 끝/처음으로 옮긴다 */
  const moveArticle = (dir: -1 | 1) => {
    if (sel?.part !== "body") return;
    const chapters = body.chapters.map((ch) => ({ ...ch, articles: [...ch.articles] }));
    const list = chapters[sel.ci].articles;
    const [item] = list.splice(sel.ai, 1);
    let ci = sel.ci;
    let ai = sel.ai + dir;
    if (ai < 0) {
      if (ci === 0) return;
      ci -= 1;
      ai = chapters[ci].articles.length;
    } else if (ai > list.length) {
      if (ci === chapters.length - 1) return;
      ci += 1;
      ai = 0;
    }
    chapters[ci].articles.splice(ai, 0, item);
    patchBody({ ...body, chapters });
    setSel({ part: "body", ci, ai });
  };

  const deleteSelected = () => {
    if (!sel || !selected) return;
    if (!window.confirm(`${sel.part === "addendum" ? "부칙 " : ""}${selected.no ? `제${selected.no}조` : "이 조문"}${selected.title ? `(${selected.title})` : ""}을 삭제할까요?`)) return;
    if (sel.part === "body") {
      patchBody({
        ...body,
        chapters: body.chapters.map((ch, ci) => (ci === sel.ci ? { ...ch, articles: ch.articles.filter((_, ai) => ai !== sel.ai) } : ch)),
      });
    } else {
      patchBody({ ...body, addendum: body.addendum.filter((_, ai) => ai !== sel.ai) });
    }
    setSel(null);
  };

  const patchChapter = (ci: number, patch: { title?: string }) => {
    patchBody({ ...body, chapters: body.chapters.map((ch, i) => (i === ci ? { ...ch, ...patch } : ch)) });
  };

  const moveChapter = (ci: number, dir: -1 | 1) => {
    const to = ci + dir;
    if (to < 0 || to >= body.chapters.length) return;
    const chapters = [...body.chapters];
    [chapters[ci], chapters[to]] = [chapters[to], chapters[ci]];
    patchBody({ ...body, chapters });
    setSel(null);
  };

  const deleteChapter = (ci: number) => {
    const ch = body.chapters[ci];
    const chapters = body.chapters.map((c) => ({ ...c, articles: [...c.articles] }));
    const moveTo = ci > 0 ? ci - 1 : ci + 1;
    if (ch.articles.length) {
      if (!chapters[moveTo]) {
        window.alert("조문이 있는 유일한 장은 삭제할 수 없습니다. 장 표제만 비워 두세요.");
        return;
      }
      if (!window.confirm(`제${ch.no}장 ${ch.title}을 삭제합니다. 이 장의 조문 ${ch.articles.length}개는 ${moveTo < ci ? "앞 장 끝으로" : "다음 장 앞으로"} 옮깁니다. 계속할까요?`)) return;
      if (moveTo < ci) chapters[moveTo].articles.push(...ch.articles);
      else chapters[moveTo].articles.unshift(...ch.articles);
    }
    chapters.splice(ci, 1);
    patchBody({ ...body, chapters });
    setSel(null);
  };

  // 조문 편집기 — 항·호
  const setClauses = (clauses: RuleClause[]) => selected && replaceSelected({ ...selected, clauses: relabel(clauses) });

  // ── 검증·교정 ──

  const runNormalize = () => {
    const r = normalizeRuleBody(body);
    setBody(r.body);
    setCorrections(r.corrections);
    setWarnings(r.warnings);
    setDirty(true);
    setNotice(
      r.corrections.length
        ? `번호 서열을 ${r.corrections.length}건 교정했습니다.${r.warnings.length ? ` 확인할 항목 ${r.warnings.length}건이 있습니다.` : ""}`
        : r.warnings.length
          ? `교정할 번호는 없습니다. 확인할 항목 ${r.warnings.length}건이 있습니다.`
          : "번호 서열에 문제가 없습니다.",
    );
  };

  // ── 가져오기 ──

  async function handleImport(file: File) {
    if (!confirmDiscard()) return;
    const hasContent = body.chapters.some((c) => c.articles.some((a) => a.title || a.clauses.some((x) => x.text)));
    if (editable && !isNew && hasContent && !window.confirm("현재 작성 중인 판의 조문을 가져온 내용으로 바꿉니다. 계속할까요?")) return;
    setBusy("가져오는 중");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/rules/internal/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "가져오지 못했습니다.");
      // 시행된 판을 보고 있었다면 새 규정으로 가져온다(시행 판은 고칠 수 없다)
      if (!editable) resetNew(nextRegNo);
      const m = json.meta ?? {};
      setMeta((cur) => ({
        title: m.title || cur.title,
        regNo: m.regNo ? String(m.regNo).padStart(4, "0") : cur.regNo,
        ownerDept: m.ownerDept || cur.ownerDept,
        approver: m.approver || cur.approver,
        enactedDate: m.enactedDate || cur.enactedDate,
      }));
      if (m.effectiveDate) setEffectiveDate(m.effectiveDate);
      setBody(json.body);
      setCorrections(json.corrections ?? []);
      setWarnings(json.warnings ?? []);
      setSel(json.body.chapters[0]?.articles.length ? { part: "body", ci: 0, ai: 0 } : null);
      setDirty(true);
      const s = json.stats;
      setNotice(
        `${file.name} 가져옴 — ${s.chapters ? `${s.chapters}개 장 · ` : ""}${s.articles}개 조 · 부칙 ${s.addendum}개` +
          (json.corrections?.length ? ` · 번호 교정 ${json.corrections.length}건` : "") +
          " — 확인 후 [저장]하세요.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "가져오지 못했습니다.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ── 저장·시행·삭제 ──

  const metaPayload = () => ({
    title: meta.title.trim(),
    regNo: meta.regNo.trim() ? Number(meta.regNo) : null,
    ownerDept: meta.ownerDept.trim() || null,
    approver: meta.approver.trim() || null,
    enactedDate: meta.enactedDate || null,
  });

  const validateMeta = (): string | null => {
    if (!meta.title.trim()) return "규정 제목을 입력해 주세요.";
    if (meta.enactedDate && !/^\d{4}-\d{2}-\d{2}$/.test(meta.enactedDate)) return "제정일을 YYYY-MM-DD 형식으로 입력해 주세요.";
    if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return "시행일을 YYYY-MM-DD 형식으로 입력해 주세요.";
    return null;
  };

  async function handleSave(): Promise<boolean> {
    const msg = validateMeta();
    if (msg) {
      setError(msg);
      return false;
    }
    setBusy("저장 중");
    setError("");
    try {
      if (isNew) {
        const res = await fetch("/api/rules/internal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meta: metaPayload(), body, effectiveDate: effectiveDate || null, revisionNote: revisionNote || null, warnings }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "저장하지 못했습니다.");
        setDirty(false);
        const list = await loadDocs();
        const d = list.find((x) => x.docId === json.docId);
        if (d) await openDoc(d, json.versionId);
        router.replace(`/rules/internal/edit?docId=${encodeURIComponent(json.docId)}`);
      } else {
        const res = await fetch(`/api/rules/internal/${encodeURIComponent(docId!)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meta: metaPayload(),
            ...(editable && versionId
              ? { versionId, body, effectiveDate: effectiveDate || null, revisionNote: revisionNote || null, warnings }
              : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "저장하지 못했습니다.");
        setDirty(false);
        await loadDocs();
      }
      setNotice(editable ? "저장했습니다." : "머리 정보를 저장했습니다(시행 중인 판의 조문은 바뀌지 않습니다).");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function handlePublish() {
    if (!versionId || !editable || isNew) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setError("시행일을 입력해 주세요(YYYY-MM-DD).");
      return;
    }
    if (dirty && !(await handleSave())) return;
    const label = `${formatRegNo(meta.regNo ? Number(meta.regNo) : null)} 「${meta.title}」`;
    if (!window.confirm(`${label}을(를) ${effectiveDate}부터 시행합니다.\n시행 후에는 이 판의 조문을 수정할 수 없고, 바꿀 때는 개정안(새 판)을 만듭니다. 진행할까요?`)) return;
    setBusy("시행 처리 중");
    setError("");
    try {
      const res = await fetch(`/api/rules/versions/${versionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveDate }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "시행 처리하지 못했습니다.");
      setVersionRow(json.version);
      await loadDocs();
      setNotice("시행했습니다. 내부 규정 일람에서 전 임직원이 열람할 수 있습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "시행 처리하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function handleRevise() {
    if (!docId) return;
    setBusy("개정안 만드는 중");
    setError("");
    try {
      const res = await fetch(`/api/rules/internal/${encodeURIComponent(docId)}/revise`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "개정안을 만들지 못했습니다.");
      const list = await loadDocs();
      const d = list.find((x) => x.docId === docId);
      if (d) await openDoc(d, json.versionId);
      setNotice(json.existing ? "작성 중인 개정안을 열었습니다." : "시행 중인 판을 복사해 개정안(새 판)을 만들었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "개정안을 만들지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function handleDelete() {
    if (isNew) {
      if (confirmDiscard()) resetNew(nextRegNo);
      return;
    }
    const discardDraftOnly = hasPublished && editable && versionId;
    if (!window.confirm(discardDraftOnly ? "작성 중인 개정안을 폐기할까요? 시행 중인 판은 그대로 남습니다." : "이 규정을 삭제할까요? 되돌릴 수 없습니다.")) return;
    setBusy("삭제 중");
    setError("");
    try {
      const res = discardDraftOnly
        ? await fetch(`/api/rules/versions/${versionId}`, { method: "DELETE" })
        : await fetch(`/api/rules/internal/${encodeURIComponent(docId!)}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "삭제하지 못했습니다.");
      setDirty(false);
      const list = await loadDocs();
      const d = discardDraftOnly ? list.find((x) => x.docId === docId) : null;
      if (d) await openDoc(d);
      else {
        resetNew(null);
        router.replace("/rules/internal/edit");
      }
      setNotice(discardDraftOnly ? "개정안을 폐기했습니다." : "규정을 삭제했습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  // ── 렌더 ──

  const articleCount = body.chapters.reduce((n, c) => n + c.articles.length, 0);
  const regNoNum = meta.regNo.trim() ? Number(meta.regNo) : null;
  const regNoTaken = regNoNum != null && docs.some((d) => d.regNo === regNoNum && d.docId !== docId);
  const noChapter = body.chapters.length === 1 && body.chapters[0].no === 0;

  if (canManage === false) {
    return (
      <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
        <CdPageHeader breadcrumbs={[{ label: "사규·내규", href: "/rules" }, { label: "내부 규정 작성" }]} title="내부 규정 작성" />
        <div className="cd-card p-10 text-center text-sm cd-text-faint">
          내부 규정 작성 권한(사규 관리)이 없습니다. <Link href="/rules/internal" className="underline">내부 규정 일람</Link>에서 열람할 수 있습니다.
        </div>
      </div>
    );
  }

  const treeBtn = (active: boolean) =>
    `flex items-center gap-1 w-full px-2 py-1 text-left text-xs transition-colors cd-action ${active ? "font-semibold" : ""}`;

  return (
    <div className="cdash cd-fields-white min-h-screen p-4 md:p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "사규·내규", href: "/rules" }, { label: "내부 규정 작성" }]}
        title="내부 규정 작성"
        titleSuffix={
          versionRow ? (
            <span className="text-[12px] font-bold ml-2" style={{ color: versionRow.status === "draft" ? "var(--cd-warning)" : "var(--cd-success)" }}>
              제{versionRow.version}판 · {STATUS_LABEL[versionRow.status]}
            </span>
          ) : isNew ? (
            <span className="text-[12px] font-bold ml-2 cd-text-faint">새 규정</span>
          ) : null
        }
        meta={`${noChapter ? "" : `${body.chapters.length}개 장 · `}${articleCount}개 조 · 부칙 ${body.addendum.length}${dirty ? " · 저장 안 됨" : ""}`}
        help={
          <div className="flex flex-col gap-1.5 text-[12px] leading-relaxed">
            <p>좌측 트리에서 장·조를 추가·이동·삭제하고, 조를 누르면 제목·항(①②)·호(1. 가.)를 편집합니다. 조·항 번호는 순서대로 자동 부여됩니다.</p>
            <p>[가져오기]는 HWPX·DOCX·TXT·MD 파일의 &apos;제N장·제N조(제목)·①·1.·가.&apos; 표기를 읽어 트리로 만들고, 번호 서열(빠짐·중복·역순)을 자동으로 바로잡습니다. LLM 초안은 마크다운이나 텍스트로 저장해 올리면 됩니다.</p>
            <p>[시행]하면 판이 고정되어 일람에 공개됩니다. 이후 수정은 [개정안 만들기]로 새 판을 만들어 진행합니다. 머리 정보(번호·주관부서·승인·제정일)는 언제든 고칠 수 있습니다.</p>
          </div>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept=".hwpx,.docx,.txt,.md,.markdown"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
              }}
            />
            <select
              className="cd-select"
              style={{ width: 240 }}
              value={docId ?? ""}
              aria-label="편집할 규정"
              onChange={(e) => {
                if (!confirmDiscard()) return;
                const d = docs.find((x) => x.docId === e.target.value);
                if (d) {
                  void openDoc(d);
                  router.replace(`/rules/internal/edit?docId=${encodeURIComponent(d.docId)}`);
                } else {
                  resetNew(nextRegNo);
                  router.replace("/rules/internal/edit");
                }
              }}
            >
              <option value="">＋ 새 규정</option>
              {docs.map((d) => (
                <option key={d.docId} value={d.docId}>
                  {d.regNo ? `제${String(d.regNo).padStart(4, "0")}호 ` : ""}
                  {d.title}
                </option>
              ))}
            </select>
            <button type="button" className="cd-btn cd-action" onClick={() => fileRef.current?.click()} disabled={!!busy} title="HWPX · DOCX · TXT · MD">
              {busy === "가져오는 중" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} 가져오기
            </button>
            <Link href={docId ? `/rules/internal?docId=${encodeURIComponent(docId)}` : "/rules/internal"} className="cd-btn cd-action">
              <ListChecks className="w-4 h-4" /> 일람
            </Link>
          </div>
        }
      />

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className="mb-4 px-4 py-3 rounded-lg text-sm border"
          style={{ borderColor: error ? "var(--cd-error)" : "var(--cd-success)", color: error ? "var(--cd-error)" : "var(--cd-success)" }}
        >
          {error || notice}
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* 좌: 인덱스 트리 */}
        <div className="cd-card p-3 flex flex-col gap-2 self-start lg:sticky lg:top-4 overflow-auto" style={{ maxHeight: "calc(100vh - 140px)" }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold cd-text-faint">조문 트리</span>
            {editable && (
              <span className="ml-auto flex items-center gap-1">
                <button type="button" className="cd-btn cd-action px-2 py-1 text-[11px]" onClick={addChapter} title="장 추가">
                  <Plus className="w-3 h-3" /> 장
                </button>
                <button
                  type="button"
                  className="cd-btn cd-action px-2 py-1 text-[11px]"
                  onClick={() => addArticle(sel?.part === "body" ? sel.ci : body.chapters.length - 1)}
                  title="선택한 조 다음(없으면 마지막 장 끝)에 조 추가"
                >
                  <Plus className="w-3 h-3" /> 조
                </button>
              </span>
            )}
          </div>

          {body.chapters.map((ch, ci) => (
            <div key={`ch-${ci}`} className="mb-1">
              {!(noChapter || (ci === 0 && ch.no === 0)) ? (
                <div className="text-xs font-bold px-1 py-1 cd-text">
                  제{ch.no}장 {ch.title || <span className="cd-text-faint font-normal">(표제 없음)</span>}
                </div>
              ) : ci === 0 && ch.no === 0 && !noChapter ? (
                <div className="text-xs font-bold px-1 py-1" style={{ color: "var(--cd-warning)" }}>장 미지정</div>
              ) : null}
              {ch.articles.map((a, ai) => {
                const active = sel?.part === "body" && sel.ci === ci && sel.ai === ai;
                return (
                  <button
                    key={`${ci}-${ai}`}
                    type="button"
                    onClick={() => setSel({ part: "body", ci, ai })}
                    aria-current={active ? "true" : undefined}
                    className={treeBtn(active)}
                    style={{ background: active ? "var(--cd-primary-soft)" : "transparent", color: active ? "var(--cd-primary)" : "var(--cd-muted)" }}
                  >
                    <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                    <span className="truncate">
                      제{a.no}조 {a.title || <span className="opacity-60">(제목 없음)</span>}
                    </span>
                  </button>
                );
              })}
              {editable && !ch.articles.length && (
                <button type="button" className="text-[11px] px-2 py-1 cd-text-faint underline" onClick={() => addArticle(ci)}>
                  이 장에 조 추가
                </button>
              )}
            </div>
          ))}

          <div className="border-t pt-2 mt-1" style={{ borderColor: "var(--cd-border)" }}>
            <div className="flex items-center">
              <span className="text-xs font-bold px-1 py-1 cd-text">부칙</span>
              {editable && (
                <button type="button" className="ml-auto cd-btn cd-action px-2 py-1 text-[11px]" onClick={addAddendum} title="부칙 조 추가">
                  <Plus className="w-3 h-3" /> 부칙
                </button>
              )}
            </div>
            {body.addendum.map((a, ai) => {
              const active = sel?.part === "addendum" && sel.ai === ai;
              return (
                <button
                  key={`ad-${ai}`}
                  type="button"
                  onClick={() => setSel({ part: "addendum", ai })}
                  aria-current={active ? "true" : undefined}
                  className={treeBtn(active)}
                  style={{ background: active ? "var(--cd-primary-soft)" : "transparent", color: active ? "var(--cd-primary)" : "var(--cd-muted)" }}
                >
                  <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                  <span className="truncate">
                    {a.no ? `제${a.no}조 ${a.title}` : a.clauses[0]?.text.slice(0, 24) || "(부칙 문장)"}
                  </span>
                </button>
              );
            })}
          </div>

          {body.appendices.length > 0 && (
            <div className="border-t pt-2 mt-1 text-[11px] cd-text-faint" style={{ borderColor: "var(--cd-border)" }}>
              별표·별지 {body.appendices.length}개 — {body.appendices.map((ap) => ap.title || `별표 ${ap.no}`).join(", ")}
            </div>
          )}
        </div>

        {/* 우: 머리 정보 + 편집/미리보기 */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className="cd-card p-4 flex flex-col gap-3">
            <div className="grid gap-3 grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px]">
              <label className="text-[11px] font-bold cd-text-faint flex flex-col gap-1">
                <span>
                  규정 제목 <span style={{ color: "var(--cd-error)" }}>*</span>
                </span>
                <input
                  className="cd-input"
                  value={meta.title}
                  onChange={(e) => patchMeta({ title: e.target.value })}
                  placeholder="예: 녹색채권 외부검토 직업적·윤리적 원칙 및 독립성 규정"
                />
              </label>
              <label className="text-[11px] font-bold cd-text-faint flex flex-col gap-1">
                규정번호
                <span className="flex items-center gap-1.5 text-[12.5px] font-normal cd-text">
                  <span className="shrink-0">KESI 규정 제</span>
                  <input
                    className="cd-input font-mono text-center"
                    style={{ width: 76 }}
                    inputMode="numeric"
                    maxLength={4}
                    value={meta.regNo}
                    placeholder={nextRegNo ? String(nextRegNo).padStart(4, "0") : "0001"}
                    onChange={(e) => patchMeta({ regNo: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                    onBlur={() => meta.regNo && patchMeta({ regNo: String(Number(meta.regNo)).padStart(4, "0") })}
                    aria-invalid={regNoTaken || undefined}
                  />
                  <span className="shrink-0">호</span>
                </span>
                {regNoTaken && <span className="font-normal" style={{ color: "var(--cd-error)" }}>이미 쓰이는 번호입니다.</span>}
              </label>
            </div>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-[11px] font-bold cd-text-faint flex flex-col gap-1">
                주관부서
                <input className="cd-input" value={meta.ownerDept} onChange={(e) => patchMeta({ ownerDept: e.target.value })} placeholder="예: 외부검토 담당 조직" />
              </label>
              <label className="text-[11px] font-bold cd-text-faint flex flex-col gap-1">
                승인
                <input className="cd-input" value={meta.approver} onChange={(e) => patchMeta({ approver: e.target.value })} placeholder="예: 대표이사" />
              </label>
              <CdDateInput label="제정일" value={meta.enactedDate} onChange={(v) => patchMeta({ enactedDate: v })} placeholder="YYYY-MM-DD" />
              <CdDateInput
                label="시행일"
                value={effectiveDate}
                onChange={(v) => {
                  setEffectiveDate(v);
                  setDirty(true);
                }}
                placeholder="YYYY-MM-DD"
                disabled={!editable}
              />
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <label className="text-[11px] font-bold cd-text-faint flex flex-col gap-1 flex-1 min-w-[220px]">
                제정·개정 사유
                <input
                  className="cd-input"
                  value={revisionNote}
                  disabled={!editable}
                  onChange={(e) => {
                    setRevisionNote(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="예: 녹색채권 외부검토기관 등록요건 대응 제정"
                />
              </label>
              <button type="button" className="cd-btn cd-action" onClick={runNormalize} disabled={!!busy || !editable} title="장·조·항·호 번호 서열을 검사하고 순서대로 바로잡습니다">
                <Wand2 className="w-4 h-4" /> 번호 검증·교정
              </button>
              <button type="button" className="cd-btn cd-action" onClick={() => void handleSave()} disabled={!!busy}>
                {busy === "저장 중" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 저장
              </button>
              {editable && !isNew && (
                <button type="button" className="cd-btn cd-btn-primary cd-action" onClick={() => void handlePublish()} disabled={!!busy}>
                  <Send className="w-4 h-4" /> 시행
                </button>
              )}
              {!editable && !isNew && (
                <button type="button" className="cd-btn cd-btn-primary cd-action" onClick={() => void handleRevise()} disabled={!!busy}>
                  <FilePlus2 className="w-4 h-4" /> 개정안 만들기
                </button>
              )}
              {(editable || isNew) && (
                <button
                  type="button"
                  className="cd-btn cd-action"
                  onClick={() => void handleDelete()}
                  disabled={!!busy}
                  title={isNew ? "작성 내용 비우기" : hasPublished ? "개정안 폐기" : "규정 삭제"}
                  aria-label={isNew ? "작성 내용 비우기" : hasPublished ? "개정안 폐기" : "규정 삭제"}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {!editable && versionRow && (
              <div className="text-xs flex items-center gap-2 cd-text-faint">
                <CheckCircle2 className="w-4 h-4" style={{ color: "var(--cd-success)" }} />
                {STATUS_LABEL[versionRow.status]}인 판({versionRow.effectiveDate ?? "시행일 미정"} 시행)은 조문을 고칠 수 없습니다. 바꾸려면 [개정안 만들기]로 새 판을 만드세요.
              </div>
            )}
            {editable && !isNew && !effectiveDate && (
              <div className="text-[11px] cd-text-faint">시행하려면 시행일을 입력하세요.</div>
            )}
          </div>

          {(corrections.length > 0 || warnings.length > 0) && (
            <div className="cd-card p-4 grid gap-3 grid-cols-1 xl:grid-cols-2">
              {corrections.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold mb-2" style={{ color: "var(--cd-success)" }}>
                    <Wand2 className="w-4 h-4" /> 자동 교정 {corrections.length}건
                  </div>
                  <ul className="flex flex-col gap-1 text-xs cd-text-faint max-h-40 overflow-auto">
                    {corrections.map((c, i) => (
                      <li key={i}>· {c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold mb-2" style={{ color: "var(--cd-warning)" }}>
                    <AlertTriangle className="w-4 h-4" /> 확인 필요 {warnings.length}건
                  </div>
                  <ul className="flex flex-col gap-1 text-xs cd-text-faint max-h-40 overflow-auto">
                    {warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <CdTabs
            items={[
              { key: "edit", label: "조문 편집" },
              { key: "preview", label: "미리보기" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === "preview" ? (
            <div className="cd-card p-4 md:p-6">
              <InternalRuleView
                header={{
                  title: meta.title,
                  regNo: regNoNum,
                  ownerDept: meta.ownerDept || null,
                  approver: meta.approver || null,
                  enactedDate: meta.enactedDate || null,
                }}
                body={body}
              />
            </div>
          ) : (
            <>
              {selected ? (
                <div className="cd-card p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold cd-text-faint shrink-0">
                      {sel?.part === "addendum" ? "부칙 " : ""}
                      {selected.no ? `제${selected.no}조` : "조 없음"}
                    </span>
                    <input
                      className="cd-input flex-1 min-w-[180px]"
                      value={selected.title}
                      disabled={!editable}
                      placeholder={sel?.part === "addendum" ? "제목(부칙이 한 문장이면 비워 둠)" : "조문 제목 — 예: 목적"}
                      onChange={(e) => replaceSelected({ ...selected, title: e.target.value })}
                      aria-label="조문 제목"
                    />
                    {editable && sel?.part === "body" && (
                      <span className="flex items-center gap-1">
                        <button type="button" className="cd-btn cd-action p-2" onClick={() => moveArticle(-1)} title="위로" aria-label="조 위로 이동">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" className="cd-btn cd-action p-2" onClick={() => moveArticle(1)} title="아래로" aria-label="조 아래로 이동">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    )}
                    {editable && (
                      <button type="button" className="cd-btn cd-action p-2" onClick={deleteSelected} title="조 삭제" aria-label="조 삭제">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {selected.clauses.map((c, ci) => (
                    <div key={ci} className="flex flex-col gap-1.5 border-l-2 pl-3" style={{ borderColor: "var(--cd-border)" }}>
                      <div className="flex items-start gap-2">
                        <span className="text-sm font-bold pt-2 w-6 text-center shrink-0" title={c.label ? "항 번호(자동)" : "단항"}>
                          {c.label || "—"}
                        </span>
                        <textarea
                          className="cd-input flex-1"
                          rows={Math.max(2, Math.ceil(c.text.length / 60))}
                          value={c.text}
                          disabled={!editable}
                          placeholder="항 본문"
                          onChange={(e) => setClauses(selected.clauses.map((x, i) => (i === ci ? { ...x, text: e.target.value } : x)))}
                          aria-label={`${c.label || "본문"} 내용`}
                        />
                        {editable && selected.clauses.length > 1 && (
                          <button
                            type="button"
                            className="cd-btn cd-action p-2 mt-0.5"
                            onClick={() => setClauses(selected.clauses.filter((_, i) => i !== ci))}
                            title="항 삭제"
                            aria-label="항 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {c.items.map((it, ii) => {
                        const level = itemHead(it)?.level ?? 1;
                        return (
                          <div key={ii} className="flex items-start gap-2" style={{ paddingLeft: 32 + (level - 1) * 20 }}>
                            <textarea
                              className="cd-input flex-1"
                              rows={Math.max(1, Math.ceil(it.length / 60))}
                              value={it}
                              disabled={!editable}
                              placeholder="1. 호 내용 / 가. 목 내용"
                              onChange={(e) =>
                                setClauses(
                                  selected.clauses.map((x, i) =>
                                    i === ci ? { ...x, items: x.items.map((y, j) => (j === ii ? e.target.value : y)) } : x,
                                  ),
                                )
                              }
                              aria-label="호·목 내용"
                            />
                            {editable && (
                              <button
                                type="button"
                                className="cd-btn cd-action p-2 mt-0.5"
                                onClick={() =>
                                  setClauses(selected.clauses.map((x, i) => (i === ci ? { ...x, items: x.items.filter((_, j) => j !== ii) } : x)))
                                }
                                title="호 삭제"
                                aria-label="호 삭제"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {editable && (
                        <div className="flex items-center gap-1.5 pl-8">
                          <button
                            type="button"
                            className="cd-btn cd-action px-2 py-1 text-[11px]"
                            onClick={() => {
                              const nums = c.items.filter((x) => itemHead(x)?.level === 1).length;
                              setClauses(selected.clauses.map((x, i) => (i === ci ? { ...x, items: [...x.items, `${nums + 1}. `] } : x)));
                            }}
                          >
                            <Plus className="w-3 h-3" /> 호(1.)
                          </button>
                          <button
                            type="button"
                            className="cd-btn cd-action px-2 py-1 text-[11px]"
                            disabled={!c.items.length}
                            title="마지막 호 아래에 목(가. 나.) 추가"
                            onClick={() => {
                              let n = 0;
                              for (let j = c.items.length - 1; j >= 0; j -= 1) {
                                const lv = itemHead(c.items[j])?.level;
                                if (lv === 2) n += 1;
                                else if (lv === 1) break;
                              }
                              const mark = "가나다라마바사아자차카타파하"[n] ?? "가";
                              setClauses(selected.clauses.map((x, i) => (i === ci ? { ...x, items: [...x.items, `${mark}. `] } : x)));
                            }}
                          >
                            <Plus className="w-3 h-3" /> 목(가.)
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {editable && (
                    <button
                      type="button"
                      className="cd-btn cd-action px-3 py-1.5 text-[11px] self-start border-dashed"
                      onClick={() => setClauses([...selected.clauses, { label: "", text: "", items: [] }])}
                      title="항을 추가하면 ①②… 번호가 자동으로 붙습니다"
                    >
                      <Plus className="w-3 h-3" /> 항 추가
                    </button>
                  )}
                  {selected.tables?.length ? (
                    <div className="text-[11px] cd-text-faint">조문 안의 표 {selected.tables.length}개 — 가져온 그대로 보존되며 미리보기에서 확인할 수 있습니다.</div>
                  ) : null}
                </div>
              ) : (
                <div className="cd-card p-6 text-center text-sm cd-text-faint">
                  좌측 트리에서 조문을 선택하면 제목·항·호를 편집할 수 있습니다.
                </div>
              )}

              {!noChapter && (
                <div className="cd-card p-4">
                  <div className="text-[11px] font-bold mb-3 cd-text-faint">장 구성 {body.chapters.length}개</div>
                  <div className="flex flex-col gap-2">
                    {body.chapters.map((ch, i) => (
                      <div key={`chrow-${i}`} className="flex items-center gap-2 text-xs">
                        <span className="shrink-0 w-12 cd-text-faint">{ch.no ? `제${ch.no}장` : "미지정"}</span>
                        <input
                          className="cd-input flex-1"
                          value={ch.title}
                          disabled={!editable}
                          placeholder="장 표제 — 예: 총칙"
                          onChange={(e) => patchChapter(i, { title: e.target.value })}
                          aria-label={`제${ch.no}장 표제`}
                        />
                        <span className="shrink-0 cd-text-faint w-10 text-right">조 {ch.articles.length}</span>
                        {editable && (
                          <>
                            <button type="button" className="cd-btn cd-action p-1.5" onClick={() => moveChapter(i, -1)} disabled={i === 0} aria-label="장 위로 이동">
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="cd-btn cd-action p-1.5" onClick={() => moveChapter(i, 1)} disabled={i === body.chapters.length - 1} aria-label="장 아래로 이동">
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="cd-btn cd-action p-1.5" onClick={() => deleteChapter(i)} aria-label="장 삭제">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

// 채용공고 에디터 — 편집 화면이 곧 미리보기(인라인 WYSIWYG).
// 좌측: 문서 캔버스(텍스트 클릭 편집, 반복 항목 호버 컨트롤) / 우측: 테마·문서 설정 패널.
// 자동저장(디바운스) + 명시 "버전 저장"(스냅샷) + undo/redo + PNG/PDF 내보내기.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Pencil,
  Redo2,
  Undo2,
} from "lucide-react";
import { CdButton, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { DocNode, DocTheme, RecruitPostingRow } from "@/lib/recruit/types";
import { addRepeatItem, moveRepeatItem, removeRepeatItem, updateNodeText } from "@/lib/recruit/tree-ops";
import { exportElementPdf, exportElementPng } from "@/lib/recruit/export";
import { DocEditorProvider } from "./DocNodeView";
import { DocCanvas, DocEditorStyles } from "./DocCanvas";

const AUTOSAVE_DELAY = 1500;

export function RecruitEditorBoard({ postingId }: { postingId: string }) {
  const { theme: uiTheme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();

  const [posting, setPosting] = useState<RecruitPostingRow | null>(null);
  const [tree, setTree] = useState<DocNode | null>(null);
  const [docTheme, setDocTheme] = useState<DocTheme>({});
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"draft" | "final">("draft");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editable, setEditable] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);

  // undo/redo — 트리 스냅샷 스택(텍스트 커밋·항목 조작 단위)
  const [past, setPast] = useState<DocNode[]>([]);
  const [future, setFuture] = useState<DocNode[]>([]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/recruit/postings/${postingId}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "공고를 불러오지 못했습니다.");
        if (cancelled) return;
        const p = data.posting as RecruitPostingRow;
        setPosting(p);
        setTree(p.contentTree);
        setDocTheme(p.theme ?? {});
        setTitle(p.title);
        setStatus(p.status);
        // 첫 세팅이 자동저장을 트리거하지 않도록 다음 틱에 로드 완료 마킹
        setTimeout(() => { loadedRef.current = true; }, 0);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [postingId]);

  const save = useCallback(
    async (opts?: { snapshot?: boolean }) => {
      if (!tree) return;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/recruit/postings/${postingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, contentTree: tree, theme: docTheme, status, snapshot: opts?.snapshot === true }),
        });
        if (!res.ok) throw new Error((await res.json())?.error || "저장 실패");
        setSaveState("saved");
        if (opts?.snapshot) toast("버전을 저장했습니다.", "success");
      } catch (e) {
        setSaveState("error");
        toast((e as Error).message, "error");
      }
    },
    [postingId, tree, docTheme, title, status, toast]
  );

  // 자동저장 — 편집 후 잠잠해지면 저장(스냅샷 없음)
  useEffect(() => {
    if (!loadedRef.current || !tree) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void save(), AUTOSAVE_DELAY);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [tree, docTheme, title, status, save]);

  const applyTree = useCallback((next: DocNode) => {
    setTree((cur) => {
      if (!cur || next === cur) return cur;
      setPast((p) => [...p.slice(-49), cur]);
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      setTree((cur) => {
        if (cur) setFuture((f) => [cur, ...f]);
        return p[p.length - 1];
      });
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      setTree((cur) => {
        if (cur) setPast((p) => [...p, cur]);
        return f[0];
      });
      return f.slice(1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const callbacks = useMemo(
    () => ({
      editable,
      onCommitText: (id: string, text: string) => tree && applyTree(updateNodeText(tree, id, text)),
      onAddItem: (id: string) => tree && applyTree(addRepeatItem(tree, id)),
      onRemoveItem: (id: string) => tree && applyTree(removeRepeatItem(tree, id)),
      onMoveItem: (id: string, dir: -1 | 1) => tree && applyTree(moveRepeatItem(tree, id, dir)),
    }),
    [editable, tree, applyTree]
  );

  const doExport = useCallback(
    async (kind: "png" | "pdf") => {
      const el = canvasRef.current;
      if (!el) return;
      setExporting(kind);
      const wasEditable = editable;
      setEditable(false); // 캡처에 편집 표시가 섞이지 않게 잠시 읽기 모드
      try {
        await new Promise((r) => setTimeout(r, 60));
        const base = (title || "채용공고").replace(/[\\/:*?"<>|]/g, "_");
        if (kind === "png") await exportElementPng(el, base);
        else await exportElementPdf(el, base);
        toast(`${kind.toUpperCase()} 로 내보냈습니다.`, "success");
      } catch (e) {
        toast(`내보내기 실패: ${(e as Error).message}`, "error");
      } finally {
        setEditable(wasEditable);
        setExporting(null);
      }
    },
    [editable, title, toast]
  );

  const accentSwatches = useMemo(() => {
    const opts = docTheme.accentOptions ?? [];
    const cur = docTheme.accentColor;
    return cur && !opts.includes(cur) ? [...opts, cur] : opts;
  }, [docTheme.accentOptions, docTheme.accentColor]);

  if (loadError) {
    return (
      <div className="cdash cd-fields-white min-h-screen p-6" data-theme={uiTheme}>
        <div className="text-sm" style={{ color: "var(--cd-error)" }}>{loadError}</div>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white min-h-screen p-6 flex flex-col" data-theme={uiTheme}>
      <CdPageHeader
        breadcrumbs={[
          { label: "홍보·채용공고", href: "/admin/recruit" },
          { label: "공고 편집" },
        ]}
        title={title || "채용공고 편집"}
        meta={
          saveState === "saving" ? "저장 중…"
          : saveState === "saved" ? "모든 변경사항 저장됨"
          : saveState === "error" ? "저장 실패 — 네트워크 확인"
          : posting ? `템플릿: ${posting.templateName ?? "-"}` : ""
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <CdButton size="sm" icon={<Undo2 className="w-4 h-4" />} disabled={past.length === 0} onClick={undo}>
              실행취소
            </CdButton>
            <CdButton size="sm" icon={<Redo2 className="w-4 h-4" />} disabled={future.length === 0} onClick={redo}>
              다시실행
            </CdButton>
            <CdButton
              size="sm"
              variant="soft"
              icon={editable ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              onClick={() => setEditable((v) => !v)}
            >
              {editable ? "미리보기" : "편집"}
            </CdButton>
            <CdButton
              size="sm"
              variant="soft"
              icon={exporting === "png" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              disabled={exporting !== null}
              onClick={() => void doExport("png")}
            >
              PNG
            </CdButton>
            <CdButton
              size="sm"
              variant="soft"
              icon={exporting === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              disabled={exporting !== null}
              onClick={() => void doExport("pdf")}
            >
              PDF
            </CdButton>
            <CdButton size="sm" variant="primary" icon={<History className="w-4 h-4" />} onClick={() => void save({ snapshot: true })}>
              버전 저장
            </CdButton>
          </div>
        }
      />

      <div className="flex gap-5 items-start flex-1 min-h-0">
        {/* 문서 캔버스 — 데스크 배경 위 실제 크기 문서 */}
        <div
          className="flex-1 overflow-auto rounded-2xl border cd-border-c"
          style={{ background: docTheme.deskColor ?? "#E9ECEA", maxHeight: "calc(100vh - 150px)" }}
        >
          <DocEditorStyles />
          <div className="py-8 flex justify-center">
            {tree ? (
              <DocEditorProvider value={callbacks}>
                <div className="shadow-lg">
                  <DocCanvas ref={canvasRef} tree={tree} theme={docTheme} width={posting?.docWidth ?? 900} />
                </div>
              </DocEditorProvider>
            ) : (
              <div className="flex items-center gap-2 py-24 text-sm" style={{ color: "#5A635E" }}>
                <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
              </div>
            )}
          </div>
        </div>

        {/* 우측 설정 패널 */}
        <aside className="w-72 shrink-0 rounded-2xl border cd-border-c cd-card-bg p-5 flex flex-col gap-5" style={{ boxShadow: "var(--cd-shadow)" }}>
          <div>
            <label className="block text-xs font-bold mb-1.5 cd-text-muted">공고 제목(관리용)</label>
            <input
              className="cd-input w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 울산지사 통합환경허가 경력직"
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5 cd-text-muted">상태</label>
            <div className="flex gap-2">
              {(["draft", "final"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className="cd-btn cd-btn-sm flex-1"
                  style={
                    status === s
                      ? { background: "var(--cd-primary)", color: "#fff" }
                      : { background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                  }
                >
                  {status === s && <Check className="w-3.5 h-3.5" />} {s === "draft" ? "작성중" : "확정"}
                </button>
              ))}
            </div>
          </div>

          {(accentSwatches.length > 0 || docTheme.accentColor) && (
            <div>
              <label className="block text-xs font-bold mb-1.5 cd-text-muted">액센트 컬러</label>
              <div className="flex items-center gap-2 flex-wrap">
                {accentSwatches.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    onClick={() => setDocTheme((t) => ({ ...t, accentColor: hex }))}
                    className="w-7 h-7 rounded-full border-2"
                    style={{
                      background: hex,
                      borderColor: docTheme.accentColor === hex ? "var(--cd-primary)" : "transparent",
                      outline: "1px solid var(--cd-border)",
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={docTheme.accentColor ?? "#0F5C49"}
                  onChange={(e) => setDocTheme((t) => ({ ...t, accentColor: e.target.value }))}
                  title="직접 선택"
                  className="w-7 h-7 rounded cursor-pointer border cd-border-c bg-transparent"
                />
              </div>
              <p className="text-[11px] mt-1.5 cd-text-faint">색 하나로 헤더·배지·포인트가 함께 바뀝니다.</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold cd-text-muted">간격 축소(compact)</span>
            <button
              type="button"
              role="switch"
              aria-checked={docTheme.compact === true}
              onClick={() => setDocTheme((t) => ({ ...t, compact: !t.compact }))}
              className="relative w-9 h-5 rounded-full transition-colors"
              style={{ background: docTheme.compact ? "var(--cd-primary)" : "var(--cd-border)" }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                style={{ left: docTheme.compact ? 18 : 2 }}
              />
            </button>
          </div>

          <div className="border-t cd-border-c pt-4 text-[11px] leading-relaxed cd-text-faint">
            텍스트는 클릭해 바로 수정합니다. 목록·카드·전형 스텝 같은 반복 항목은 마우스를 올리면
            추가·이동·삭제 버튼이 나타납니다. 변경사항은 자동 저장되며, 중요한 시점엔 상단의
            <b> 버전 저장</b>으로 스냅샷을 남기세요.
          </div>

          <CdButton variant="ghost" size="sm" onClick={() => router.push("/admin/recruit")}>
            목록으로 돌아가기
          </CdButton>
        </aside>
      </div>
    </div>
  );
}

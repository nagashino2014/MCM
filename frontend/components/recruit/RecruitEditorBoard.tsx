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
  LayoutTemplate,
  Loader2,
  Pencil,
  Redo2,
  Undo2,
} from "lucide-react";
import { CdButton, CdModal, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { DocNode, DocTheme, RecruitPostingRow } from "@/lib/recruit/types";
import {
  addRepeatItem,
  duplicateNode,
  insertNodeAfter,
  moveNode,
  moveRepeatItem,
  nudgeNode,
  removeNode,
  removeRepeatItem,
  replaceNodeChildren,
  resizeNode,
  adjustBulletGap,
  insertFreeImage,
  setNodeFontSize,
  setNodePosition,
  toggleBulletNode,
  updateNodeText,
} from "@/lib/recruit/tree-ops";
import { exportElementPdf, exportElementPng } from "@/lib/recruit/export";
import { DocEditorProvider, type DocEditorCallbacks } from "./DocNodeView";
import { DocCanvas, DocEditorStyles } from "./DocCanvas";
import { EditorChrome, type ChromeOps } from "./EditorChrome";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplSaving, setTplSaving] = useState(false);

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

  // 편집 조작 적용 — 항상 "최신" 트리에 함수형으로 적용한다.
  // (문단 블록 blur 커밋 직후 같은 클릭으로 다른 조작이 이어져도 커밋이 유실되지 않게)
  const applyOp = useCallback((op: (cur: DocNode) => DocNode) => {
    setTree((cur) => {
      if (!cur) return cur;
      const next = op(cur);
      if (next === cur) return cur;
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

  const accentHex = docTheme.accentColor ?? docTheme.cssVars?.["--accent"] ?? "#0F5C49";

  const callbacks = useMemo<DocEditorCallbacks>(
    () => ({
      editable,
      accentHex,
      onReplaceChildren: (id, children) => applyOp((cur) => replaceNodeChildren(cur, id, children)),
      onCommitText: (id, text) => applyOp((cur) => updateNodeText(cur, id, text)),
    }),
    [editable, accentHex, applyOp]
  );

  const chromeOps = useMemo<ChromeOps>(
    () => ({
      addRepeatItem: (id) => applyOp((cur) => addRepeatItem(cur, id)),
      removeRepeatItem: (id) => applyOp((cur) => removeRepeatItem(cur, id)),
      moveRepeatItem: (id, dir) => applyOp((cur) => moveRepeatItem(cur, id, dir)),
      duplicateNode: (id) => applyOp((cur) => duplicateNode(cur, id)),
      removeNode: (id) => applyOp((cur) => removeNode(cur, id)),
      moveNode: (id, dir) => applyOp((cur) => moveNode(cur, id, dir)),
      nudgeNode: (id, dx, dy) => applyOp((cur) => nudgeNode(cur, id, dx, dy)),
      resizeNode: (id, size) => applyOp((cur) => resizeNode(cur, id, size)),
      toggleBullet: (id) => applyOp((cur) => toggleBulletNode(cur, id)),
      adjustBulletGap: (id, delta) => applyOp((cur) => adjustBulletGap(cur, id, delta)),
      setFontSize: (id, px) => applyOp((cur) => setNodeFontSize(cur, id, px)),
      insertFreeImage: (dataUri, left, top) => applyOp((cur) => insertFreeImage(cur, dataUri, left, top)),
      setNodePosition: (id, left, top) => applyOp((cur) => setNodePosition(cur, id, left, top)),
      insertImageBlock: (refId, dataUri) =>
        applyOp((cur) =>
          insertNodeAfter(cur, refId, {
            id: "tmp",
            tag: "img",
            src: dataUri,
            style: { display: "block", width: "160px", maxWidth: "100%" },
          })
        ),
    }),
    [applyOp]
  );

  // 현재 문서를 부문별 템플릿으로 저장 — 이후 "새 공고 작성"의 선택지로 나타난다.
  const saveAsTemplate = useCallback(async () => {
    if (!tree || !tplName.trim()) return;
    setTplSaving(true);
    try {
      const res = await fetch("/api/recruit/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tplName,
          description: tplDesc,
          tree,
          theme: docTheme,
          docWidth: posting?.docWidth ?? 900,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "템플릿 저장 실패");
      toast(`「${tplName.trim()}」 템플릿으로 저장했습니다.`, "success");
      setSaveTplOpen(false);
      setTplName("");
      setTplDesc("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTplSaving(false);
    }
  }, [tree, tplName, tplDesc, docTheme, posting, toast]);

  const doExport = useCallback(
    async (kind: "png" | "pdf", pngWidthPx?: number) => {
      const el = canvasRef.current;
      if (!el) return;
      setExporting(kind);
      const wasEditable = editable;
      setEditable(false); // 캡처에 편집 표시가 섞이지 않게 잠시 읽기 모드
      try {
        await new Promise((r) => setTimeout(r, 60));
        const base = (title || "채용공고").replace(/[\\/:*?"<>|]/g, "_");
        if (kind === "png") await exportElementPng(el, base, pngWidthPx);
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

  // PNG 해상도 선택 — 가로 px 를 입력하면 세로는 문서 비율로 자동 계산(사람인 최대 860×9000 대응).
  const [pngOpen, setPngOpen] = useState(false);
  const [pngWidth, setPngWidth] = useState("860");
  const [docRatio, setDocRatio] = useState(0); // 세로/가로 비율(모달 열 때 측정)

  const openPngModal = useCallback(() => {
    const el = canvasRef.current;
    if (el && el.offsetWidth > 0) setDocRatio(el.offsetHeight / el.offsetWidth);
    setPngOpen(true);
  }, []);

  const pngWidthNum = Math.min(Math.max(Number(pngWidth) || 0, 0), 4000);
  const pngHeightNum = docRatio > 0 ? Math.round(pngWidthNum * docRatio) : 0;

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
              onClick={openPngModal}
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

      <div className="flex gap-4 items-start flex-1 min-h-0">
        {/* 좌측 고정 도구 바 — 블록/텍스트 선택 시 해당 도구가 활성화된다 */}
        {editable && tree && (
          <EditorChrome
            containerRef={scrollRef}
            tree={tree}
            ctx={callbacks}
            ops={chromeOps}
            onError={(m) => toast(m, "error")}
          />
        )}

        {/* 문서 캔버스 — 데스크 배경 위 실제 크기 문서 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto rounded-2xl border cd-border-c relative"
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

          <div className="border-t cd-border-c pt-4">
            <CdButton
              variant="soft"
              size="sm"
              block
              icon={<LayoutTemplate className="w-4 h-4" />}
              onClick={() => { setTplName(title); setSaveTplOpen(true); }}
            >
              부문 템플릿으로 저장
            </CdButton>
            <p className="text-[11px] mt-1.5 cd-text-faint">
              현재 내용을 새 템플릿으로 등록합니다. 부문별(통합환경허가·화관법·ESG 등) 라인업을 만들 때 사용하세요.
            </p>
          </div>

          <div className="border-t cd-border-c pt-4 text-[11px] leading-relaxed cd-text-faint">
            <div className="font-bold mb-1.5 cd-text-muted">사용법</div>
            <ul className="flex flex-col gap-1 list-disc pl-4">
              <li><b>선택</b> — 블록을 클릭하면 왼쪽 도구 바에서 해당 기능이 활성화됩니다.</li>
              <li><b>텍스트</b> — 클릭해 바로 수정, Enter = 줄바꿈.</li>
              <li><b>서식</b> — 드래그 선택 후 굵게·밑줄·액센트 강조·글자 크기.</li>
              <li><b>기호</b> — Ω 버튼으로 커서 위치에 특수기호 삽입.</li>
              <li><b>글머리</b> — 도트 넣기/빼기, ≪ ≫ 로 여백 조절.</li>
              <li><b>크기</b> — 선택 테두리의 핸들을 끌어 너비/높이 조절.</li>
              <li><b>이동</b> — 선택 테두리를 잡아 드래그, 또는 화살표 키 1px(Shift 8px).</li>
              <li><b>삭제</b> — 선택 후 Delete 또는 휴지통 버튼.</li>
              <li><b>이미지</b> — 편집 중: 커서 위치 / 블록 선택: 아래 / 선택 없음: 자유 배치(드래그 이동).</li>
              <li><b>저장</b> — 자동 저장 + 상단 버전 저장으로 스냅샷.</li>
            </ul>
          </div>

          <CdButton variant="ghost" size="sm" onClick={() => router.push("/admin/recruit")}>
            목록으로 돌아가기
          </CdButton>
        </aside>
      </div>

      {/* PNG 내보내기 — 해상도 선택 */}
      <CdModal
        open={pngOpen}
        onClose={() => setPngOpen(false)}
        title="PNG 내보내기"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setPngOpen(false)}>취소</CdButton>
            <CdButton
              variant="primary"
              disabled={pngWidthNum < 100}
              onClick={() => {
                setPngOpen(false);
                void doExport("png", pngWidthNum);
              }}
            >
              내보내기
            </CdButton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-bold mb-1 cd-text-muted">가로 픽셀</label>
            <input
              className="cd-input w-full"
              inputMode="numeric"
              value={pngWidth}
              onChange={(e) => setPngWidth(e.target.value.replace(/[^0-9]/g, ""))}
            />
            <p className="text-[11px] mt-1 cd-text-faint">
              세로는 비율에 맞춰 자동:{" "}
              <b className="cd-text">{pngWidthNum >= 100 && pngHeightNum > 0 ? `${pngWidthNum} × ${pngHeightNum}px` : "-"}</b>
              {pngHeightNum > 9000 && (
                <span style={{ color: "var(--cd-warning)" }}> — 세로 9,000px 초과(사람인 제한). 가로를 줄이거나 내용을 줄여 주세요.</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            {[
              { label: "사람인 (860)", w: 860 },
              { label: "원본 (900)", w: 900 },
              { label: "고해상도 (1800)", w: 1800 },
            ].map((p) => (
              <button
                key={p.w}
                type="button"
                onClick={() => setPngWidth(String(p.w))}
                className="cd-btn cd-btn-sm flex-1"
                style={
                  pngWidthNum === p.w
                    ? { background: "var(--cd-primary)", color: "#fff" }
                    : { background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] cd-text-faint">사람인 게시 이미지 규격: 최대 가로 860 × 세로 9,000px · 4MB.</p>
        </div>
      </CdModal>

      {/* 부문 템플릿으로 저장 */}
      <CdModal
        open={saveTplOpen}
        onClose={() => setSaveTplOpen(false)}
        title="부문 템플릿으로 저장"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setSaveTplOpen(false)}>취소</CdButton>
            <CdButton variant="primary" loading={tplSaving} disabled={!tplName.trim()} onClick={() => void saveAsTemplate()}>
              템플릿 저장
            </CdButton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-bold mb-1 cd-text-muted">템플릿 이름 (부문명)</label>
            <input
              className="cd-input w-full"
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder="예: 화관법 컨설팅 채용공고"
            />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1 cd-text-muted">설명 (선택)</label>
            <textarea
              className="cd-input w-full resize-none"
              rows={3}
              value={tplDesc}
              onChange={(e) => setTplDesc(e.target.value)}
              placeholder="예: 에코씨앤엠 기술진단 신입/경력 공고용 — 본문 내용 포함"
            />
          </div>
          <p className="text-[11px] cd-text-faint">
            현재 문서의 내용·서식·테마가 그대로 템플릿이 되어, 새 공고 작성 시 선택지로 나타납니다.
          </p>
        </div>
      </CdModal>
    </div>
  );
}

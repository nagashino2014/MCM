"use client";

// QR 배포 이미지 편집기 — 좌측 필드 폼 / 우측 실시간 미리보기(실제 크기를 scale 로 축소).
// 로고를 올리면 CI 색상을 자동 검출해 상단 띠를 구성하고(1색=단색, 2색=2등분, 3색=3등분…),
// 설문 링크를 넣으면 서버에서 QR PNG 를 만들어 캔버스에 넣는다. 내보내기는 채용공고와 같은 캡처 경로.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Palette,
  QrCode,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { CdBadge, CdButton, CdInput, CdModal, CdPageHeader, CdSelect, CdTextarea, useCdashTheme, useCdToast } from "@/components/cdash";
import { exportNoticePng } from "@/lib/survey/export";
import { DEFAULT_BAND_COLORS, NOTICE_CANVAS, defaultNoticeFields } from "@/lib/survey/defaults";
import { detectLogoColors, fileToDataUrl } from "@/lib/survey/logo-colors";
import type { NoticeFields, NoticeLayout, NoticeTheme, SurveyNoticeRow } from "@/lib/survey/types";
import { NoticeCanvas } from "./NoticeCanvas";

const AUTOSAVE_DELAY = 1200;
const PREVIEW_WIDTH = 460; // 미리보기 표시 폭(px) — 실제 캔버스를 이 폭에 맞춰 축소한다

export function NoticeEditorBoard({ noticeId }: { noticeId: string }) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();

  const [notice, setNotice] = useState<SurveyNoticeRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<NoticeLayout>("phone");
  const [fields, setFields] = useState<NoticeFields>(defaultNoticeFields());
  const [bandColors, setBandColors] = useState<string[]>(DEFAULT_BAND_COLORS);
  const [detected, setDetected] = useState<string[] | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survey/notices/${noticeId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "배포 이미지를 불러오지 못했습니다.");
      const n = data.notice as SurveyNoticeRow;
      setNotice(n);
      setName(n.name);
      setLayout(n.layout);
      setFields(n.fields);
      setBandColors(n.theme.bandColors);
      loadedRef.current = true;
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [noticeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (body: Record<string, unknown>) => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/survey/notices/${noticeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "저장하지 못했습니다.");
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        toast((e as Error).message, "error");
      }
    },
    [noticeId, toast]
  );

  // 필드·테마 변경 디바운스 자동저장(첫 로드 세팅은 건너뛴다).
  useEffect(() => {
    if (!loadedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save({ name, layout, fields, theme: { bandColors } });
    }, AUTOSAVE_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [name, layout, fields, bandColors, save]);

  const setField = useCallback(<K extends keyof NoticeFields>(key: K, value: NoticeFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── 로고 업로드 → CI 색상 검출 ────────────────────
  const onLogoPicked = useCallback(
    async (file: File) => {
      try {
        const dataUrl = await fileToDataUrl(file);
        setField("logoDataUrl", dataUrl);
        const colors = await detectLogoColors(dataUrl);
        if (colors.length === 0) {
          toast("로고에서 색상을 찾지 못해 기본 색을 유지합니다.", "warn");
          setDetected([]);
          return;
        }
        const hexes = colors.map((c) => c.hex);
        setDetected(hexes);
        setBandColors(hexes);
        toast(`로고에서 ${hexes.length}개 색상을 검출해 상단 띠에 적용했습니다.`, "success");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [setField, toast]
  );

  // ── 링크 → QR ────────────────────────────────────
  const generateQr = useCallback(async () => {
    const url = (fields.qrTargetUrl ?? "").trim();
    if (!url) {
      toast("설문 링크를 입력하세요.", "error");
      return;
    }
    setQrBusy(true);
    try {
      const res = await fetch("/api/survey/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "QR 생성 실패");
      setField("qrDataUrl", data.dataUrl as string);
      toast("QR 코드를 생성했습니다.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setQrBusy(false);
    }
  }, [fields.qrTargetUrl, setField, toast]);

  // ── 내보내기 ─────────────────────────────────────
  const exportPng = useCallback(
    async (scale: 1 | 2) => {
      if (!canvasRef.current) return;
      setExporting(true);
      try {
        const suffix = layout === "phone" ? "스마트폰" : "메일첨부";
        await exportNoticePng(canvasRef.current, `${name || "설문 QR"}_${suffix}`, scale);
      } catch (e) {
        toast((e as Error).message || "이미지를 만들지 못했습니다.", "error");
      } finally {
        setExporting(false);
      }
    },
    [layout, name, toast]
  );

  const doDelete = useCallback(async () => {
    try {
      const res = await fetch(`/api/survey/notices/${noticeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error || "삭제 실패");
      toast("배포 이미지를 삭제했습니다.", "success");
      router.push("/survey/notices");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [noticeId, router, toast]);

  const previewScale = useMemo(() => PREVIEW_WIDTH / NOTICE_CANVAS[layout].width, [layout]);

  if (loadError) {
    return (
      <div className="cdash min-h-screen p-6" data-theme={theme}>
        <div className="rounded-2xl border cd-border-c cd-card-bg p-8 text-center">
          <p className="cd-text mb-4">{loadError}</p>
          <CdButton onClick={() => router.push("/survey/notices")}>목록으로</CdButton>
        </div>
      </div>
    );
  }

  if (!notice) {
    return (
      <div className="cdash min-h-screen p-6 flex items-center justify-center" data-theme={theme}>
        <span className="inline-flex items-center gap-2 text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </span>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "설문" }, { label: "QR 배포 이미지", href: "/survey/notices" }, { label: name }]}
        title={name || "QR 배포 이미지"}
        meta={
          saveState === "saving" ? (
            <span className="inline-flex items-center gap-1 text-xs cd-text-faint">
              <Loader2 className="w-3 h-3 animate-spin" /> 저장 중
            </span>
          ) : saveState === "saved" ? (
            <span className="inline-flex items-center gap-1 text-xs cd-text-faint">
              <Check className="w-3 h-3" /> 저장됨
            </span>
          ) : null
        }
        actions={
          <div className="flex gap-2">
            <CdButton variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push("/survey/notices")}>
              목록
            </CdButton>
            <CdButton variant="soft" icon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmDelete(true)}>
              삭제
            </CdButton>
            <CdButton variant="soft" disabled={exporting} onClick={() => void exportPng(1)}>
              PNG 1배
            </CdButton>
            <CdButton variant="primary" icon={<Download className="w-4 h-4" />} disabled={exporting} onClick={() => void exportPng(2)}>
              {exporting ? "생성 중…" : "PNG 2배 내려받기"}
            </CdButton>
          </div>
        }
      />

      <div className="flex gap-6 items-start flex-wrap">
        {/* 편집 폼 */}
        <div className="flex flex-col gap-4" style={{ width: 460, flexShrink: 0 }}>
          <div className="rounded-2xl border cd-border-c cd-card-bg p-5 flex flex-col gap-4">
            <CdInput label="이미지 이름" value={name} onChange={(e) => setName(e.target.value)} hint="목록에서 구분하는 이름(출력물에는 나오지 않음)" />
            <CdSelect label="출력 포맷" value={layout} onChange={(e) => setLayout(e.target.value as NoticeLayout)}>
              <option value="phone">스마트폰 배포용 (1080×1920)</option>
              <option value="mail">메일 첨부용 (1600×900)</option>
            </CdSelect>
          </div>

          {/* 로고 · CI 색상 */}
          <div className="rounded-2xl border cd-border-c cd-card-bg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="cd-label">대상 기관 로고</span>
              {fields.logoDataUrl && (
                <button type="button" className="text-xs cd-text-faint hover:cd-text" onClick={() => setField("logoDataUrl", null)}>
                  제거
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div
                className="rounded-xl border cd-border-c flex items-center justify-center"
                style={{ width: 96, height: 64, background: "#FFFFFF" }}
              >
                {fields.logoDataUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={fields.logoDataUrl} alt="로고 미리보기" style={{ maxWidth: "88%", maxHeight: "88%", objectFit: "contain" }} />
                ) : (
                  <span className="text-xs cd-text-faint">미등록</span>
                )}
              </div>
              <CdButton variant="soft" icon={<Upload className="w-4 h-4" />} onClick={() => fileRef.current?.click()}>
                로고 업로드
              </CdButton>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onLogoPicked(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="text-xs cd-text-faint -mt-2">
              배경이 투명한 PNG를 권장합니다. 업로드하면 CI 색상을 검출해 상단 띠에 적용합니다.
            </p>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="cd-label inline-flex items-center gap-1">
                  <Palette className="w-3.5 h-3.5" /> 상단 CI 띠 ({bandColors.length}색)
                </span>
                <div className="flex items-center gap-2">
                  {detected && detected.length > 0 && (
                    <button
                      type="button"
                      className="text-xs cd-text-primary inline-flex items-center gap-1"
                      onClick={() => setBandColors(detected)}
                      title="검출된 색으로 되돌리기"
                    >
                      <RefreshCw className="w-3 h-3" /> 검출값
                    </button>
                  )}
                  {bandColors.length < 4 && (
                    <button type="button" className="text-xs cd-text-primary" onClick={() => setBandColors([...bandColors, "#111111"])}>
                      + 색 추가
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {bandColors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input
                      type="color"
                      value={c}
                      className="w-9 h-9 rounded-lg border cd-border-c cursor-pointer bg-transparent"
                      onChange={(e) => setBandColors(bandColors.map((x, xi) => (xi === i ? e.target.value.toUpperCase() : x)))}
                      aria-label={`띠 색상 ${i + 1}`}
                    />
                    <input
                      className="cd-input w-28 text-xs"
                      value={c}
                      onChange={(e) => setBandColors(bandColors.map((x, xi) => (xi === i ? e.target.value.toUpperCase() : x)))}
                      aria-label={`띠 색상 ${i + 1} 코드`}
                    />
                    {/* 띠는 왼쪽부터 이 순서로 등분된다 — 로고 배치와 맞추려면 순서를 옮긴다 */}
                    <button
                      type="button"
                      className="p-1 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)] disabled:opacity-30"
                      title="왼쪽으로"
                      disabled={i === 0}
                      onClick={() => {
                        const next = [...bandColors];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        setBandColors(next);
                      }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)] disabled:opacity-30"
                      title="오른쪽으로"
                      disabled={i === bandColors.length - 1}
                      onClick={() => {
                        const next = [...bandColors];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        setBandColors(next);
                      }}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                    {bandColors.length > 1 && (
                      <button
                        type="button"
                        className="p-1 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]"
                        onClick={() => setBandColors(bandColors.filter((_, xi) => xi !== i))}
                        title="색 제거"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {detected !== null && detected.length > 0 && (
                <p className="text-xs cd-text-faint">
                  검출된 색: {detected.join(", ")} — 띠는 색 개수만큼 가로로 등분됩니다.
                </p>
              )}
            </div>
          </div>

          {/* QR */}
          <div className="rounded-2xl border cd-border-c cd-card-bg p-5 flex flex-col gap-3">
            <CdInput
              label="설문 링크 (구글 폼 응답 URL)"
              value={fields.qrTargetUrl ?? ""}
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
              onChange={(e) => setField("qrTargetUrl", e.target.value)}
            />
            <div className="flex items-center gap-2">
              <CdButton variant="soft" icon={<QrCode className="w-4 h-4" />} disabled={qrBusy} onClick={() => void generateQr()}>
                {qrBusy ? "생성 중…" : "QR 생성"}
              </CdButton>
              {fields.qrDataUrl && <CdBadge tone="success">QR 적용됨</CdBadge>}
            </div>
          </div>

          {/* 문구 */}
          <div className="rounded-2xl border cd-border-c cd-card-bg p-5 flex flex-col gap-4">
            <CdInput label="대상 기관(기업)명" value={fields.targetOrg} onChange={(e) => setField("targetOrg", e.target.value)} />
            <div className="flex gap-3">
              <CdInput label="대상 배지 문구" className="flex-1" value={fields.badgeText} onChange={(e) => setField("badgeText", e.target.value)} />
              <CdSelect
                label="배지 색"
                className="w-32"
                value={fields.badgeTone}
                onChange={(e) => setField("badgeTone", e.target.value as NoticeFields["badgeTone"])}
              >
                <option value="sky">파랑</option>
                <option value="green">연두</option>
              </CdSelect>
            </div>
            <CdTextarea label="제목" rows={2} value={fields.title} onChange={(e) => setField("title", e.target.value)} hint="줄바꿈으로 두 줄 제목을 만들 수 있습니다." />
            <CdTextarea label="설명" rows={3} value={fields.description} onChange={(e) => setField("description", e.target.value)} hint="스마트폰 포맷은 3줄을 넘기면 하단 정보 바가 밀립니다." />
            <CdInput label="조사 기간" value={fields.periodText} placeholder="2026년 9월 17일(목) ~ 9월 28일(월)" onChange={(e) => setField("periodText", e.target.value)} />
            <CdInput label="소요 시간" value={fields.durationText} placeholder="약 3분 · 총 12개 문항" onChange={(e) => setField("durationText", e.target.value)} />
            <div className="flex gap-3">
              <CdInput label="주관 (주)" className="flex-1" value={fields.hostMain} onChange={(e) => setField("hostMain", e.target.value)} />
              <CdInput label="주관 (부)" className="flex-1" value={fields.hostSub} onChange={(e) => setField("hostSub", e.target.value)} />
            </div>
            <CdInput label="주관 부기" value={fields.hostNote} onChange={(e) => setField("hostNote", e.target.value)} />
            <CdTextarea label="QR 캡션" rows={2} value={fields.qrCaption} onChange={(e) => setField("qrCaption", e.target.value)} />
          </div>
        </div>

        {/* 미리보기 — 실제 크기 캔버스를 scale 로 축소. 캡처 대상은 스케일이 걸리지 않은 안쪽 캔버스. */}
        <div className="flex flex-col gap-3">
          <div className="text-xs cd-text-faint">
            미리보기 · 실제 {NOTICE_CANVAS[layout].width}×{NOTICE_CANVAS[layout].height}px ({Math.round(previewScale * 100)}%)
          </div>
          <div
            className="rounded-2xl border cd-border-c overflow-hidden"
            style={{
              width: PREVIEW_WIDTH,
              height: NOTICE_CANVAS[layout].height * previewScale,
              background: "#FFFFFF",
            }}
          >
            <div style={{ transform: `scale(${previewScale})`, transformOrigin: "top left" }}>
              <NoticeCanvas ref={canvasRef} layout={layout} fields={fields} theme={{ bandColors } as NoticeTheme} />
            </div>
          </div>
        </div>
      </div>

      <CdModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="배포 이미지 삭제"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setConfirmDelete(false)}>취소</CdButton>
            <CdButton variant="danger" onClick={() => void doDelete()}>
              삭제
            </CdButton>
          </div>
        }
      >
        <p className="text-sm cd-text">
          <strong>{name}</strong> 을(를) 삭제합니다. 이미 내려받은 PNG 파일은 영향을 받지 않습니다.
        </p>
      </CdModal>
    </div>
  );
}

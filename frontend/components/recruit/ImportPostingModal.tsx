"use client";

// 원본 채용공고(PDF/이미지)에서 가져오기 — 템플릿을 고르고 파일을 올리면 AI 가 내용을 분석해
// 템플릿 양식은 그대로 둔 채 텍스트만 채운 새 공고 초안을 만들고 에디터로 이동한다.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Sparkles } from "lucide-react";
import { CdButton, CdModal, useCdToast } from "@/components/cdash";
import type { RecruitTemplateRow } from "@/lib/recruit/types";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function ImportPostingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useCdToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<RecruitTemplateRow[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setBusy(false);
    (async () => {
      try {
        const res = await fetch("/api/recruit/templates", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "템플릿을 불러오지 못했습니다.");
        const list = data.templates as RecruitTemplateRow[];
        setTemplates(list);
        setTemplateId((cur) => cur || list[0]?.templateId || "");
      } catch (e) {
        toast((e as Error).message, "error");
        setTemplates([]);
      }
    })();
  }, [open, toast]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) return toast("파일은 20MB 이하만 올릴 수 있습니다.", "error");
    if (!/^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(f.type)) {
      return toast("PDF 또는 PNG/JPG/GIF/WebP 이미지만 지원합니다.", "error");
    }
    setFile(f);
  };

  const run = async () => {
    if (!file || !templateId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/recruit/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          file: { name: file.name, contentType: file.type, base64: await fileToBase64(file) },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "가져오기 실패");
      toast(`초안을 만들었습니다(${data.applied}곳 채움). 내용을 검수한 뒤 저장하세요.`, "success");
      onClose();
      router.push(`/admin/recruit/${data.postingId}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="공고 파일에서 가져오기"
      size="md"
      closeOnBackdrop={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <CdButton onClick={onClose} disabled={busy}>취소</CdButton>
          <CdButton
            variant="primary"
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            disabled={!file || !templateId || busy}
            onClick={() => void run()}
          >
            {busy ? "분석 중…" : "분석해서 초안 만들기"}
          </CdButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-bold mb-1 cd-text-muted">채울 디자인 템플릿</label>
          {templates === null ? (
            <div className="flex items-center gap-2 text-sm cd-text-muted py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 템플릿 불러오는 중…
            </div>
          ) : (
            <select className="cd-input w-full" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy}>
              {templates.map((t) => (
                <option key={t.templateId} value={t.templateId}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
          className="border-2 border-dashed cd-border-c rounded-2xl p-8 flex flex-col items-center gap-2 cd-text-muted hover:cd-soft-primary transition-colors"
        >
          <FileUp className="w-7 h-7" />
          {file ? (
            <span className="text-sm font-semibold cd-text">{file.name} <span className="cd-text-faint">({(file.size / 1024).toFixed(0)}KB)</span></span>
          ) : (
            <span className="text-sm font-semibold">원본 채용공고 파일을 선택하거나 끌어다 놓으세요</span>
          )}
          <span className="text-xs cd-text-faint">PDF 또는 PNG/JPG 이미지 · 20MB 이하</span>
        </button>

        <p className="text-[11px] leading-relaxed cd-text-faint">
          AI 가 원본의 제목·모집부문·접수·전형·근무환경·문의 내용을 읽어 템플릿의 문구를 바꾸고 항목 수를 맞춥니다.
          템플릿 디자인은 그대로 유지되며, 결과는 <b>초안</b>이라 에디터에서 검수·수정이 필요합니다. 분석에 30초~1분 정도
          걸립니다.
        </p>
      </div>
    </CdModal>
  );
}

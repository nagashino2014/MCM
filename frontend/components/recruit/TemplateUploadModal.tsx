"use client";

// 핸드오프 패키지 업로드 모달 — 클로드 디자인이 만든 .dc.html(또는 zip 패키지)을 받아
// 브라우저에서 파싱하고, 감지된 구조 요약 + 축소 미리보기를 확인한 뒤 템플릿으로 등록한다.

import { useRef, useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { CdButton, CdModal, useCdToast } from "@/components/cdash";
import { parseHandoffHtml } from "@/lib/recruit/parse";
import type { ParsedTemplate } from "@/lib/recruit/types";
import { DocMiniPreview } from "./DocCanvas";

interface PickedFile {
  name: string;
  contentType: string;
  base64: string;
}

/** zip 패키지에서 디자인 HTML(.dc.html 우선)과 README(설명 프리필용)를 꺼낸다. */
async function readPackage(file: File): Promise<{ html: string; readme?: string }> {
  if (/\.zip$/i.test(file.name)) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const htmlEntry =
      entries.find((f) => /\.dc\.html$/i.test(f.name)) ?? entries.find((f) => /\.html?$/i.test(f.name));
    if (!htmlEntry) throw new Error("zip 안에서 디자인 HTML(.dc.html)을 찾지 못했습니다.");
    const readmeEntry = entries.find((f) => /readme\.md$/i.test(f.name));
    return {
      html: await htmlEntry.async("string"),
      readme: readmeEntry ? await readmeEntry.async("string") : undefined,
    };
  }
  return { html: await file.text() };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function TemplateUploadModal({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const { toast } = useCdToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"parse" | "submit" | null>(null);

  const reset = () => {
    setParsed(null);
    setPicked(null);
    setName("");
    setDescription("");
    setBusy(null);
  };

  const handleFile = async (file: File) => {
    setBusy("parse");
    try {
      const { html, readme } = await readPackage(file);
      const result = parseHandoffHtml(html);
      setParsed(result);
      setPicked({
        name: file.name,
        contentType: file.type || (/\.zip$/i.test(file.name) ? "application/zip" : "text/html"),
        base64: await fileToBase64(file),
      });
      setName(file.name.replace(/\.(dc\.)?html?$|\.zip$/i, ""));
      if (readme) {
        // README 첫 문단(제목 줄 제외)을 설명 기본값으로
        const firstPara = readme
          .split(/\r?\n\r?\n/)
          .map((p) => p.replace(/^#.*$/gm, "").trim())
          .find((p) => p.length > 10);
        if (firstPara) setDescription(firstPara.slice(0, 300));
      }
    } catch (e) {
      toast(`파싱 실패: ${(e as Error).message}`, "error");
      setParsed(null);
      setPicked(null);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!parsed) return;
    setBusy("submit");
    try {
      const res = await fetch("/api/recruit/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          tree: parsed.tree,
          theme: parsed.theme,
          docWidth: parsed.docWidth,
          sourceFile: picked,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "등록 실패");
      toast("템플릿을 등록했습니다.", "success");
      reset();
      onRegistered();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="핸드오프 패키지 업로드"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <CdButton onClick={() => { reset(); onClose(); }}>취소</CdButton>
          <CdButton
            variant="primary"
            disabled={!parsed || !name.trim() || busy !== null}
            loading={busy === "submit"}
            onClick={() => void submit()}
          >
            템플릿 등록
          </CdButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <input
          ref={inputRef}
          type="file"
          accept=".html,.htm,.zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />

        {!parsed ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed cd-border-c rounded-2xl p-10 flex flex-col items-center gap-3 cd-text-muted hover:cd-soft-primary transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
          >
            {busy === "parse" ? <Loader2 className="w-8 h-8 animate-spin" /> : <FileUp className="w-8 h-8" />}
            <span className="text-sm font-semibold">
              클로드 디자인 핸드오프 파일을 선택하거나 끌어다 놓으세요
            </span>
            <span className="text-xs cd-text-faint">.dc.html 단일 파일 또는 패키지 zip (README 포함 시 설명 자동 입력)</span>
          </button>
        ) : (
          <div className="flex gap-4">
            <DocMiniPreview
              tree={parsed.tree}
              theme={parsed.theme}
              docWidth={parsed.docWidth}
              previewWidth={230}
              previewHeight={310}
              className="rounded-xl border cd-border-c shrink-0"
            />
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              <div>
                <label className="block text-xs font-bold mb-1 cd-text-muted">템플릿 이름</label>
                <input className="cd-input w-full" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1 cd-text-muted">설명</label>
                <textarea
                  className="cd-input w-full resize-none"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="text-xs cd-text-muted rounded-xl border cd-border-c p-3 leading-relaxed">
                구조 분석 결과 — 편집 가능한 텍스트 <b>{parsed.stats.textCount}</b>곳, 추가·삭제 가능한
                반복 그룹 <b>{parsed.stats.groupCount}</b>개를 감지했습니다.
              </div>
              <CdButton size="sm" icon={<Upload className="w-4 h-4" />} onClick={() => inputRef.current?.click()}>
                다른 파일 선택
              </CdButton>
            </div>
          </div>
        )}
      </div>
    </CdModal>
  );
}

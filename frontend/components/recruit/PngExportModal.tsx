"use client";

// PNG 내보내기 옵션 모달 — 가로 px(세로는 문서 비율로 자동, 사람인 최대 860×9000 대응)·파일 형식.
// 에디터(RecruitEditorBoard)에 있던 것을 목록 화면의 [PNG] 버튼도 쓰도록 분리(2026-10-13).

import { useState } from "react";
import { CdButton, CdModal } from "@/components/cdash";

export function PngExportModal({
  open,
  onClose,
  docRatio,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  /** 문서 세로/가로 비율(모달 열 때 측정) — 0 이면 세로 px 를 표시하지 않는다 */
  docRatio: number;
  onExport: (widthPx: number, format: "png" | "jpeg") => void;
}) {
  const [pngWidth, setPngWidth] = useState("860");
  const [pngFormat, setPngFormat] = useState<"png" | "jpeg">("png");
  const pngWidthNum = Math.min(Math.max(Number(pngWidth) || 0, 0), 4000);
  const pngHeightNum = docRatio > 0 ? Math.round(pngWidthNum * docRatio) : 0;
  const choice = (active: boolean) =>
    active ? { background: "var(--cd-primary)", color: "#fff" } : { background: "var(--cd-primary-soft)", color: "var(--cd-primary)" };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="PNG 내보내기"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton
            variant="primary"
            disabled={pngWidthNum < 100}
            onClick={() => {
              onClose();
              onExport(pngWidthNum, pngFormat);
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
              data-active={pngWidthNum === p.w}
              aria-pressed={pngWidthNum === p.w}
              className="cd-choice cd-btn cd-btn-sm flex-1"
              style={choice(pngWidthNum === p.w)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <label className="block text-xs font-bold mb-1 cd-text-muted">파일 형식</label>
          <div className="flex gap-2">
            {(
              [
                { key: "png", label: "PNG (무손실 · 권장)" },
                { key: "jpeg", label: "JPG (용량 작음)" },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setPngFormat(f.key)}
                data-active={pngFormat === f.key}
                aria-pressed={pngFormat === f.key}
                className="cd-choice cd-btn cd-btn-sm flex-1"
                style={choice(pngFormat === f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] cd-text-faint">사람인 게시 규격: 최대 860 × 9,000px · 4MB</p>
      </div>
    </CdModal>
  );
}

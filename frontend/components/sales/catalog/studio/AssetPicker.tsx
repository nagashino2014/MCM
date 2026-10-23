"use client";

// 사진 고르기 창 — 키트 기본 사진(사옥·로고)과 회사소개서 자산(사진·로고). 새 사진은 여기서 올린다(PNG·JPG·WebP, 10MB 이하).

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import type { StudioImageAsset } from "@/lib/catalog/studio/store";
import { catalogFetch } from "../catalogFetch";
import { previewUrl } from "./useStudio";

export function AssetPicker({
  open,
  assets,
  onClose,
  onPick,
  onUploaded,
}: {
  open: boolean;
  assets: StudioImageAsset[];
  onClose: () => void;
  onPick: (key: string) => void;
  onUploaded: (a: StudioImageAsset) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("kind", "photo");
      fd.set("file", file);
      const res = await catalogFetch<{ asset: { assetId: string; fileName: string } }>("/api/catalog/assets", { method: "POST", body: fd });
      const a: StudioImageAsset = { key: `a/${res.asset.assetId}`, label: res.asset.fileName, kind: "photo", createdAt: new Date().toISOString() };
      onUploaded(a);
      onPick(a.key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <CdModal open={open} onClose={onClose} title="사진 고르기" size="xl">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <label className="cd-btn cd-btn-soft cd-btn-sm cd-action cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> {busy ? "올리는 중…" : "새 사진 올리기"}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
          <span className="text-xs cd-text-faint">PNG·JPG·WebP, 10MB 이하. 인쇄에는 긴 변 2,500px 이상을 권합니다.</span>
        </div>
        {error ? <p className="cd-error-text text-sm">{error}</p> : null}
        <ul className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {assets.map((a) => (
            <li key={a.key}>
              <button type="button" className="cd-action w-full rounded-lg border cd-border-c p-1.5 flex flex-col gap-1 text-left" onClick={() => onPick(a.key)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl(a.key)} alt="" className="w-full h-24 object-contain rounded" style={{ background: "var(--cd-surface-muted, #f3f3f3)" }} loading="lazy" />
                <span className="text-xs cd-text truncate">{a.label}</span>
                <span className="text-[11px] cd-text-faint">{a.kind === "kit" ? "기본 사진" : a.kind === "logo" ? "로고" : "사진"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </CdModal>
  );
}

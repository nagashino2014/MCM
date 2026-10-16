"use client";

// 메일 가져오기(I-1, 281) — 메일 설정 화면의 전 직원 섹션.
// 아마란스 메일함 백업 ZIP·.eml 을 올리면 서버가 1분마다 조금씩 본인 메일함으로 옮긴다(Next 정지 후에도 이어서).
// 설계: docs/mail-import-blueprint.md §4.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, FileArchive, Upload, X } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput, CdSelect } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import type { FolderKind, ImportJob } from "@/lib/mail/import/jobs";

interface PickedFile {
  file: File;
  folderKind: FolderKind;
  folderName: string;
}

const SOURCES = ["아마란스", "지메일", "네이버", "기타"] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  running: "가져오는 중",
  paused: "잠시 멈춤(이어서 진행)",
  done: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

function sizeText(b: number): string {
  if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(b / 1024))}KB`;
}

/** 파일 이름으로 원본 메일함을 짐작한다 — 아마란스 백업은 ZIP·EML 이름에 메일함 이름이 들어 있다. */
function guessFolder(name: string): { folderKind: FolderKind; folderName: string } {
  if (name.includes("보낸메일함")) return { folderKind: "sent", folderName: "보낸메일함" };
  if (name.includes("받은메일함")) return { folderKind: "inbox", folderName: "받은메일함" };
  const base = name.replace(/\.(zip|eml)$/i, "");
  const parts = base.split("_");
  // ZIP: {날짜}_{계정}_{메일함}.zip, EML: {날짜}_{메일함}_{계정}_{제목}.eml
  const token = /\.zip$/i.test(name) ? parts[parts.length - 1] : parts[1];
  if (token && parts.length > 2) return { folderKind: "custom", folderName: token };
  return { folderKind: "inbox", folderName: "받은메일함" };
}

export function MailImportManager() {
  const { toast } = useCdToast();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [source, setSource] = useState<(typeof SOURCES)[number]>("아마란스");
  const [customSource, setCustomSource] = useState("");
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [inboxPlacement, setInboxPlacement] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openFailures, setOpenFailures] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/mail/import", { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      setJobs(Array.isArray(d.jobs) ? d.jobs : []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 진행 중인 작업이 있으면 5초마다 새로 읽는다.
  const active = jobs.some((j) => ["pending", "running", "paused"].includes(j.status));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [active, load]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (fileRef.current) fileRef.current.value = "";
    const ok = files.filter((f) => /\.(zip|eml)$/i.test(f.name));
    if (ok.length < files.length) toast("ZIP 또는 EML 파일만 가져올 수 있습니다.", "warn");
    setPicked((prev) => [...prev, ...ok.map((file) => ({ file, ...guessFolder(file.name) }))]);
  };

  const update = (i: number, patch: Partial<PickedFile>) => setPicked((prev) => prev.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const start = async () => {
    const sourceLabel = source === "기타" ? customSource.trim() : source;
    if (!sourceLabel) {
      toast("원본 이름을 입력하세요.", "warn");
      return;
    }
    if (!picked.length) {
      toast("가져올 파일을 고르세요.", "warn");
      return;
    }
    try {
      const uploads: { key: string; name: string; folderKind: FolderKind; folderName: string }[] = [];
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i];
        setUploading(`파일 올리는 중 ${i + 1}/${picked.length} — ${p.file.name} (${sizeText(p.file.size)})`);
        const pr = await fetch("/api/mail/import/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: p.file.name, byteSize: p.file.size }),
        });
        const pd = await pr.json().catch(() => ({}));
        if (!pr.ok) throw new Error(String(pd.error ?? "업로드 준비에 실패했습니다."));
        const put = await fetch(String(pd.url), {
          method: "PUT",
          headers: { "Content-Type": /\.zip$/i.test(p.file.name) ? "application/zip" : "message/rfc822" },
          body: p.file,
        });
        if (!put.ok) throw new Error(`'${p.file.name}' 업로드에 실패했습니다. (HTTP ${put.status})`);
        uploads.push({ key: String(pd.key), name: p.file.name, folderKind: p.folderKind, folderName: p.folderName });
      }
      setUploading("가져오기 작업을 만드는 중…");
      const r = await fetch("/api/mail/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel, inboxPlacement, uploads }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(d.error ?? "가져오기 작업을 만들지 못했습니다."));
      toast(`가져오기를 시작했습니다(${d.job?.totalCount ?? 0}통). 1분 안에 처리가 시작됩니다.`, "success");
      setPicked([]);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "가져오기에 실패했습니다.", "error");
    } finally {
      setUploading(null);
    }
  };

  const cancel = async (j: ImportJob) => {
    if (!window.confirm("가져오기를 취소할까요? 이미 가져온 메일은 남습니다.")) return;
    const r = await fetch(`/api/mail/import?jobId=${encodeURIComponent(j.jobId)}`, { method: "DELETE" });
    if (r.ok) load();
    else toast("취소하지 못했습니다.", "error");
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 새 가져오기 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CdSelect label="원본" value={source} onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </CdSelect>
        {source === "기타" && (
          <CdInput label="원본 이름" value={customSource} onChange={(e) => setCustomSource(e.target.value)} placeholder="예: 다음 메일" />
        )}
      </div>

      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" multiple accept=".zip,.eml" className="hidden" onChange={onPick} />
        <CdButton variant="soft" icon={<FileArchive className="w-4 h-4" />} onClick={() => fileRef.current?.click()} disabled={!!uploading}>
          파일 고르기(ZIP·EML)
        </CdButton>
        <CdHelp label="메일 가져오기 도움말">
          <p className="font-semibold">아마란스 메일 옮기기</p>
          <p>1) 아마란스 → 메일 → 환경설정 → 메일함 관리에서 받은메일함·보낸메일함·직접 만든 메일함마다 [백업]을 눌러 ZIP을 저장합니다.</p>
          <p>2) 여기서 ZIP을 모두 고르고, 파일마다 원본 메일함이 맞는지 확인한 뒤 [가져오기 시작]을 누릅니다.</p>
          <p className="mt-1">받은 메일은 &lsquo;가져온 메일(원본 이름)&rsquo; 폴더에, 보낸 메일은 보낸편지함에 들어갑니다. 같은 메일은 여러 번 올려도 한 번만 저장됩니다.</p>
          <p className="mt-1">나중에 아마란스를 완전히 끊기 전에 같은 방법으로 한 번 더 올리면 그 사이 새 메일만 추가됩니다.</p>
        </CdHelp>
      </div>

      {picked.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {picked.map((p, i) => (
            <div key={`${p.file.name}-${i}`} className="rounded-lg border cd-border-c px-3 py-2 flex flex-wrap items-center gap-2">
              <span className="text-[12px] cd-text truncate min-w-0 flex-1" title={p.file.name}>
                {p.file.name} <span className="cd-text-faint">({sizeText(p.file.size)})</span>
              </span>
              <select
                className="cd-input text-[12px] w-auto"
                aria-label={`${p.file.name} 원본 메일함`}
                value={p.folderKind}
                onChange={(e) => {
                  const k = e.target.value as FolderKind;
                  update(i, { folderKind: k, folderName: k === "inbox" ? "받은메일함" : k === "sent" ? "보낸메일함" : p.folderName || "기타" });
                }}
              >
                <option value="inbox">받은메일함</option>
                <option value="sent">보낸메일함</option>
                <option value="custom">직접 만든 메일함</option>
              </select>
              {p.folderKind === "custom" && (
                <input
                  className="cd-input text-[12px] w-32"
                  aria-label="메일함 이름"
                  value={p.folderName}
                  onChange={(e) => update(i, { folderName: e.target.value })}
                />
              )}
              <CdButton
                size="sm"
                variant="ghost"
                title="목록에서 빼기"
                aria-label={`${p.file.name} 빼기`}
                icon={<X className="w-3.5 h-3.5" />}
                onClick={() => setPicked((prev) => prev.filter((_, k) => k !== i))}
              />
            </div>
          ))}
          <CdCheckbox
            label="받은 메일을 받은편지함에 넣기(기본: '가져온 메일' 폴더)"
            checked={inboxPlacement}
            onChange={(e) => setInboxPlacement(e.target.checked)}
          />
          <p className="text-xs cd-text-faint">
            파일로 가져온 메일은 모두 읽음으로 표시됩니다. 아마란스 대용량 첨부(링크, 30일 보관)의 파일은 함께 옮겨지지 않습니다.
          </p>
          <div className="flex items-center gap-2">
            <CdButton variant="primary" icon={<Upload className="w-4 h-4" />} loading={!!uploading} onClick={start}>
              가져오기 시작
            </CdButton>
            {uploading && <span className="text-xs cd-text-faint">{uploading}</span>}
          </div>
        </div>
      )}

      {/* 내 작업 */}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {jobs.map((j) => {
            const done = j.importedCount + j.duplicateCount + j.failedCount;
            const total = j.totalCount ?? 0;
            const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
            const isActive = ["pending", "running", "paused"].includes(j.status);
            return (
              <div key={j.jobId} className="rounded-lg border cd-border-c px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[12.5px] font-semibold cd-text truncate">{j.sourceLabel}</span>
                  <span className={`text-[11px] ${j.status === "failed" ? "cd-error-text" : j.status === "done" ? "cd-text-primary" : "cd-text-faint"}`}>
                    {STATUS_LABEL[j.status] ?? j.status}
                  </span>
                  <span className="text-[11px] cd-text-faint truncate">{new Date(j.createdAt).toLocaleString("ko-KR")}</span>
                  <div className="flex-1" />
                  {isActive && (
                    <CdButton size="sm" variant="ghost" icon={<Ban className="w-3.5 h-3.5" />} onClick={() => cancel(j)}>
                      취소
                    </CdButton>
                  )}
                </div>
                <div
                  className="h-1.5 rounded-full cd-tint-primary overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label={`${j.sourceLabel} 진행률`}
                >
                  <div className="h-full" style={{ width: `${pct}%`, background: "var(--cd-primary)" }} />
                </div>
                <p className="text-[11px] cd-text-muted">
                  {done} / {total}통 · 새로 가져옴 {j.importedCount} · 중복 {j.duplicateCount} · 실패 {j.failedCount}
                  {j.linkAttachmentCount > 0 && ` · 링크형 첨부 ${j.linkAttachmentCount}통(파일 미포함)`}
                  {j.bytesImported > 0 && ` · ${sizeText(j.bytesImported)}`}
                </p>
                {j.lastError && <p className="text-[11px] cd-error-text">{j.lastError}</p>}
                {j.failures.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="cd-action text-[11px] cd-text-primary"
                      onClick={() => setOpenFailures(openFailures === j.jobId ? null : j.jobId)}
                    >
                      {openFailures === j.jobId ? "실패 목록 닫기" : `실패 목록 보기(${j.failures.length})`}
                    </button>
                    {openFailures === j.jobId && (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {j.failures.map((f, k) => (
                          <li key={k} className="text-[11px] cd-text-muted truncate" title={`${f.file} / ${f.entry}`}>
                            {f.entry} — {f.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

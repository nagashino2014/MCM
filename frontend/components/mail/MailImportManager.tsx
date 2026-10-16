"use client";

// 메일 가져오기(281·282) — 메일 설정 화면의 전 직원 섹션.
// 파일(I-1·I-2): 아마란스 메일함 백업 ZIP·.eml·지메일 Takeout .mbox 를 올리면 서버가 조금씩 본인 메일함으로 옮긴다.
// 메일 계정(I-3): 네이버·다음·지메일 등 IMAP 으로 폴더·기간을 골라 가져온다(비밀번호는 처리 기간에만 암호화 보관).
// 설계: docs/mail-import-blueprint.md §4·§5.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, FileArchive, Plug, Upload, X } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput, CdSelect } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdToast } from "@/components/cdash/CdToast";
import type { FolderKind, ImportJob } from "@/lib/mail/import/jobs";
import type { ImapFolderInfo } from "@/lib/mail/import/imap";

interface PickedFile {
  file: File;
  folderKind: FolderKind;
  folderName: string;
}

const SOURCES = ["아마란스", "지메일", "네이버", "기타"] as const;

// 서버 프리셋(lib/mail/import/imap.ts IMAP_PRESETS)과 같은 키.
const IMAP_SOURCES = [
  { key: "naver", label: "네이버" },
  { key: "daum", label: "다음" },
  { key: "gmail", label: "지메일" },
  { key: "custom", label: "직접 입력" },
] as const;
type ImapSourceKey = (typeof IMAP_SOURCES)[number]["key"];

const PERIODS = [
  { key: "1", label: "최근 1년" },
  { key: "3", label: "최근 3년" },
  { key: "5", label: "최근 5년" },
  { key: "all", label: "전체" },
] as const;

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
  if (/\.mbox$/i.test(name)) return { folderKind: "inbox", folderName: "받은메일함" }; // 지메일 Takeout 은 라벨로 자동 분류
  if (name.includes("보낸메일함")) return { folderKind: "sent", folderName: "보낸메일함" };
  if (name.includes("받은메일함")) return { folderKind: "inbox", folderName: "받은메일함" };
  const base = name.replace(/\.(zip|eml)$/i, "");
  const parts = base.split("_");
  // ZIP: {날짜}_{계정}_{메일함}.zip, EML: {날짜}_{메일함}_{계정}_{제목}.eml
  const token = /\.zip$/i.test(name) ? parts[parts.length - 1] : parts[1];
  if (token && parts.length > 2) return { folderKind: "custom", folderName: token };
  return { folderKind: "inbox", folderName: "받은메일함" };
}

function isSentFolder(f: ImapFolderInfo): boolean {
  return f.specialUse === "\\Sent" || /^(sent|보낸)/i.test(f.name);
}
function isSkippedFolder(f: ImapFolderInfo): boolean {
  return ["\\Junk", "\\Trash", "\\Drafts"].includes(f.specialUse ?? "");
}

function sinceFrom(period: string): string | null {
  if (period === "all") return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() - Number(period));
  return d.toISOString().slice(0, 10);
}

export function MailImportManager() {
  const { toast } = useCdToast();
  const [mode, setMode] = useState<"file" | "imap">("file");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [inboxPlacement, setInboxPlacement] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openFailures, setOpenFailures] = useState<string | null>(null);
  // 파일
  const [source, setSource] = useState<(typeof SOURCES)[number]>("아마란스");
  const [customSource, setCustomSource] = useState("");
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // IMAP
  const [imapSource, setImapSource] = useState<ImapSourceKey>("naver");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [folders, setFolders] = useState<ImapFolderInfo[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<string>("3");

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

  // 진행 중인 작업이 있으면 2초마다 새로 읽는다.
  const active = jobs.some((j) => ["pending", "running", "paused"].includes(j.status));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [active, load]);

  // ── 파일 ─────────────────────────────────────
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (fileRef.current) fileRef.current.value = "";
    const ok = files.filter((f) => /\.(zip|eml|mbox)$/i.test(f.name));
    if (ok.length < files.length) toast("ZIP·EML·MBOX 파일만 가져올 수 있습니다.", "warn");
    if (ok.some((f) => /\.mbox$/i.test(f.name)) && source === "아마란스") setSource("지메일");
    setPicked((prev) => [...prev, ...ok.map((file) => ({ file, ...guessFolder(file.name) }))]);
  };

  const update = (i: number, patch: Partial<PickedFile>) => setPicked((prev) => prev.map((p, k) => (k === i ? { ...p, ...patch } : p)));

  const startFile = async () => {
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
        setBusy(`파일 올리는 중 ${i + 1}/${picked.length} — ${p.file.name} (${sizeText(p.file.size)})`);
        const pr = await fetch("/api/mail/import/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: p.file.name, byteSize: p.file.size }),
        });
        const pd = await pr.json().catch(() => ({}));
        if (!pr.ok) throw new Error(String(pd.error ?? "업로드 준비에 실패했습니다."));
        const put = await fetch(String(pd.url), {
          method: "PUT",
          headers: { "Content-Type": String(pd.contentType ?? "application/octet-stream") },
          body: p.file,
        });
        if (!put.ok) throw new Error(`'${p.file.name}' 업로드에 실패했습니다. (HTTP ${put.status})`);
        uploads.push({ key: String(pd.key), name: p.file.name, folderKind: p.folderKind, folderName: p.folderName });
      }
      setBusy("가져오기 작업을 만드는 중…");
      const r = await fetch("/api/mail/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel, inboxPlacement, uploads }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(d.error ?? "가져오기 작업을 만들지 못했습니다."));
      toast(d.job?.totalCount != null ? `가져오기를 시작했습니다(${d.job.totalCount}통).` : "가져오기를 시작했습니다.", "success");
      setPicked([]);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "가져오기에 실패했습니다.", "error");
    } finally {
      setBusy(null);
    }
  };

  // ── IMAP ─────────────────────────────────────
  const imapBody = () =>
    imapSource === "custom" ? { host: host.trim(), port: Number(port) || 993, user: user.trim(), password } : { preset: imapSource, user: user.trim(), password };

  const testImap = async () => {
    if (!user.trim() || !password) {
      toast("계정과 비밀번호(앱 비밀번호)를 입력하세요.", "warn");
      return;
    }
    setBusy("메일 서버에 연결하는 중…");
    setFolders(null);
    try {
      const r = await fetch("/api/mail/import/imap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(imapBody()),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(d.error ?? "연결하지 못했습니다."));
      const list = (Array.isArray(d.folders) ? d.folders : []) as ImapFolderInfo[];
      setFolders(list);
      // 기본 선택 = 받은편지함 + 보낸편지함
      setChecked(new Set(list.filter((f) => f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX" || isSentFolder(f)).map((f) => f.path)));
    } catch (err) {
      toast(err instanceof Error ? err.message : "연결하지 못했습니다.", "error");
    } finally {
      setBusy(null);
    }
  };

  const startImap = async () => {
    if (!folders) return;
    const chosen = folders.filter((f) => checked.has(f.path));
    if (!chosen.length) {
      toast("가져올 폴더를 하나 이상 고르세요.", "warn");
      return;
    }
    setBusy("가져올 메일을 세는 중…");
    try {
      const r = await fetch("/api/mail/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "imap",
          ...imapBody(),
          sourceLabel: IMAP_SOURCES.find((s) => s.key === imapSource && s.key !== "custom")?.label ?? host.trim(),
          inboxPlacement,
          since: sinceFrom(period),
          folders: chosen.map((f) => ({ path: f.path, name: f.name, sent: isSentFolder(f) })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(d.error ?? "가져오기 작업을 만들지 못했습니다."));
      toast(`가져오기를 시작했습니다(${d.job?.totalCount ?? 0}통).`, "success");
      setPassword("");
      setFolders(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "가져오기에 실패했습니다.", "error");
    } finally {
      setBusy(null);
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
      <CdTabs
        items={[
          { key: "file", label: "파일로 가져오기" },
          { key: "imap", label: "메일 계정에서 가져오기" },
        ]}
        active={mode}
        onChange={(k) => setMode(k as "file" | "imap")}
      />

      {mode === "file" ? (
        <>
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
            <input ref={fileRef} type="file" multiple accept=".zip,.eml,.mbox" className="hidden" onChange={onPick} />
            <CdButton variant="soft" icon={<FileArchive className="w-4 h-4" />} onClick={() => fileRef.current?.click()} disabled={!!busy}>
              파일 고르기(ZIP·EML·MBOX)
            </CdButton>
            <CdHelp label="파일 가져오기 도움말">
              <p className="font-semibold">아마란스 메일 옮기기</p>
              <p>1) 아마란스 → 메일 → 환경설정 → 메일함 관리에서 받은메일함·보낸메일함·직접 만든 메일함마다 [백업]을 눌러 ZIP을 저장합니다.</p>
              <p>2) 여기서 ZIP을 모두 고르고, 파일마다 원본 메일함이 맞는지 확인한 뒤 [가져오기 시작]을 누릅니다.</p>
              <p className="mt-1 font-semibold">지메일 Takeout(.mbox)</p>
              <p>takeout.google.com 에서 메일만 내보내 받은 .mbox 를 올리면 라벨로 받은·보낸 메일과 읽음 여부를 나눕니다. 스팸·휴지통·채팅·임시보관은 제외합니다.</p>
              <p className="mt-1">받은 메일은 &lsquo;가져온 메일(원본 이름)&rsquo; 폴더에, 보낸 메일은 보낸편지함에 들어갑니다. 같은 메일은 여러 번 올려도 한 번만 저장됩니다.</p>
            </CdHelp>
          </div>

          {picked.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {picked.map((p, i) => (
                <div key={`${p.file.name}-${i}`} className="rounded-lg border cd-border-c px-3 py-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] cd-text truncate min-w-0 flex-1" title={p.file.name}>
                    {p.file.name} <span className="cd-text-faint">({sizeText(p.file.size)})</span>
                  </span>
                  {/\.mbox$/i.test(p.file.name) ? (
                    <span className="text-[11px] cd-text-faint">라벨로 자동 분류</span>
                  ) : (
                    <>
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
                    </>
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
                ZIP·EML로 가져온 메일은 모두 읽음으로 표시됩니다. 아마란스 대용량 첨부(링크, 30일 보관)의 파일은 함께 옮겨지지 않습니다.
              </p>
              <div className="flex items-center gap-2">
                <CdButton variant="primary" icon={<Upload className="w-4 h-4" />} loading={!!busy} onClick={startFile}>
                  가져오기 시작
                </CdButton>
                {busy && <span className="text-xs cd-text-faint">{busy}</span>}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CdSelect
              label="메일 서비스"
              value={imapSource}
              onChange={(e) => {
                setImapSource(e.target.value as ImapSourceKey);
                setFolders(null);
              }}
            >
              {IMAP_SOURCES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </CdSelect>
            {imapSource === "custom" && (
              <div className="grid grid-cols-[1fr_88px] gap-2">
                <CdInput label="IMAP 서버" value={host} onChange={(e) => setHost(e.target.value)} placeholder="예: imap.example.com" />
                <CdSelect label="포트" value={port} onChange={(e) => setPort(e.target.value)}>
                  <option value="993">993(SSL)</option>
                  <option value="143">143(STARTTLS)</option>
                </CdSelect>
              </div>
            )}
            <CdInput label="메일 주소(계정)" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" placeholder="예: hong@naver.com" />
            <CdInput
              label="비밀번호(앱 비밀번호 권장)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center gap-2">
            <CdButton variant="soft" icon={<Plug className="w-4 h-4" />} loading={busy === "메일 서버에 연결하는 중…"} onClick={testImap} disabled={!!busy}>
              연결 확인
            </CdButton>
            <CdHelp label="메일 계정 가져오기 도움말">
              <p className="font-semibold">먼저 메일 서비스에서 IMAP 을 켜 주세요</p>
              <p>네이버: 메일 → 환경설정 → POP3/IMAP 설정에서 IMAP 사용. 2단계 인증을 쓰면 네이버 보안설정에서 애플리케이션 비밀번호를 만들어 넣습니다.</p>
              <p>지메일: Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호.</p>
              <p className="mt-1">비밀번호는 가져오는 동안에만 암호화해 보관하고, 끝나거나 취소하면(최대 7일) 바로 지웁니다. 다 가져온 뒤에는 앱 비밀번호를 삭제해 두세요.</p>
              <p className="mt-1">로그인에 실패하면 자동으로 다시 시도하지 않습니다(계정 잠김 방지). 원래 메일함의 메일은 지우거나 읽음으로 바꾸지 않습니다.</p>
            </CdHelp>
            {busy && busy !== "메일 서버에 연결하는 중…" && <span className="text-xs cd-text-faint">{busy}</span>}
          </div>

          {folders && (
            <div className="flex flex-col gap-2">
              <p className="text-xs cd-text-muted">가져올 폴더를 고르세요. 개인 메일은 업무에 필요한 폴더와 기간만 가져오는 것을 권합니다.</p>
              <div className="flex flex-col gap-1 max-h-60 overflow-y-auto rounded-lg border cd-border-c px-3 py-2">
                {folders.map((f) => (
                  <CdCheckbox
                    key={f.path}
                    label={`${f.name}${isSentFolder(f) ? " (보낸 메일)" : ""}${isSkippedFolder(f) ? " (스팸·휴지통·임시)" : ""} — ${f.messages}통`}
                    checked={checked.has(f.path)}
                    onChange={(e) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(f.path);
                        else next.delete(f.path);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CdSelect label="기간" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {PERIODS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </CdSelect>
              </div>
              <CdCheckbox
                label="받은 메일을 받은편지함에 넣기(기본: '가져온 메일' 폴더)"
                checked={inboxPlacement}
                onChange={(e) => setInboxPlacement(e.target.checked)}
              />
              <p className="text-xs cd-text-faint">같은 계정을 다시 가져오면 지난번 이후 새 메일만 가져옵니다. 읽음 여부는 원래 메일함 그대로 옮깁니다.</p>
              <div>
                <CdButton variant="primary" icon={<Upload className="w-4 h-4" />} loading={!!busy && busy !== "메일 서버에 연결하는 중…"} onClick={startImap}>
                  가져오기 시작
                </CdButton>
              </div>
            </div>
          )}
        </>
      )}

      {/* 내 작업 */}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {jobs.map((j) => {
            const done = j.importedCount + j.duplicateCount + j.failedCount + j.excludedCount;
            const total = j.totalCount;
            const pct = Math.round((j.progress ?? 0) * 100);
            const isActive = ["pending", "running", "paused"].includes(j.status);
            return (
              <div key={j.jobId} className="rounded-lg border cd-border-c px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[12.5px] font-semibold cd-text truncate">
                    {j.sourceLabel}
                    {j.kind === "imap" && j.imapUser ? <span className="font-normal cd-text-faint"> · {j.imapUser}</span> : null}
                  </span>
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
                  {total != null ? `${done} / ${total}통` : `${done}통 처리`} · 새로 가져옴 {j.importedCount} · 중복 {j.duplicateCount} · 실패 {j.failedCount}
                  {j.excludedCount > 0 && ` · 제외 ${j.excludedCount}(스팸·휴지통 등)`}
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

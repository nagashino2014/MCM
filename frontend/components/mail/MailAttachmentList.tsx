"use client";

// 메일 읽기 — 첨부 목록(2026-11-12 사용자 요청). 가로 칩 나열은 파일이 많으면 보기 어려워 세로 목록으로 바꿨다.
// 머리: 첨부 N개·총 용량, [전체 저장(ZIP)], '개인문서함으로 저장' 체크박스, 접기/펼치기.
// 줄: 형식 아이콘 + 파일명(확장자는 잘리지 않게) + 크기 + 저장 버튼.
// '개인문서함으로 저장'을 켜면 저장 버튼이 내 PC 다운로드 대신 앱 개인문서함 복사(/api/mail/attachments/to-personal)가 된다.
// 체크 상태는 이 브라우저에 기억한다(다음 메일에서도 유지, 화면에 늘 보이므로 헷갈리지 않는다).
// 미리보기(직원 요청 23): 볼 수 있는 형식(이미지·PDF·한글·오피스·글자·html)은 저장 버튼 앞 눈 아이콘으로 내려받지 않고 연다.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, Eye, FileArchive, FolderInput, Loader2 } from "lucide-react";
import { useCdToast } from "@/components/cdash/CdToast";
import { FileTypeIcon } from "@/components/mail/FileTypeIcon";
import { MailAttachmentPreviewModal } from "@/components/mail/MailAttachmentPreviewModal";
import { mailAttachmentPreviewKind } from "@/lib/mail/attachment-preview-kind";

export interface MailAttachmentItem {
  attachmentId: string;
  filename: string;
  sizeBytes: number | null;
}

const SAVE_PERSONAL_KEY = "mail-attach-save-personal";

function fmtSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.ceil(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 파일명 → [앞부분, 확장자] — 긴 이름은 앞부분만 말줄임해 확장자가 늘 보이게 한다. */
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= 7 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

export function MailAttachmentList({ messageId, files }: { messageId: string; files: MailAttachmentItem[] }) {
  const { toast } = useCdToast();
  const [open, setOpen] = useState(true);
  const [toPersonal, setToPersonal] = useState(false);
  /** 저장 중인 대상 — "__all" 은 전체 저장. */
  const [busy, setBusy] = useState<string | null>(null);
  /** 미리보기 중인 첨부 */
  const [previewing, setPreviewing] = useState<MailAttachmentItem | null>(null);

  // localStorage 는 브라우저에만 있으므로 마운트 뒤에 읽는다(사생활 모드 등에서 막혀도 기본값으로 동작).
  useEffect(() => {
    try {
      setToPersonal(window.localStorage.getItem(SAVE_PERSONAL_KEY) === "1");
    } catch {
      // 무시
    }
  }, []);

  const changeMode = (on: boolean) => {
    setToPersonal(on);
    try {
      window.localStorage.setItem(SAVE_PERSONAL_KEY, on ? "1" : "0");
    } catch {
      // 무시
    }
  };

  const saveToPersonal = async (ids: string[] | null, key: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/mail/attachments/to-personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, ...(ids ? { attachmentIds: ids } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        saved?: { fileName: string }[];
        failed?: { fileName: string; reason: string }[];
        error?: string;
      };
      const saved = data.saved?.length ?? 0;
      const failed = data.failed ?? [];
      if (saved) {
        toast(
          <span>
            개인문서함에 {saved}개를 저장했습니다.{" "}
            <a href="/files/personal" className="underline underline-offset-2">
              개인문서함 열기
            </a>
          </span>,
          failed.length ? "warn" : "success"
        );
      }
      if (failed.length) {
        toast(`${failed.length}개를 저장하지 못했습니다 — ${failed[0].fileName}: ${failed[0].reason}`, "error", 6000);
      } else if (!saved) {
        toast(data.error ?? "개인문서함에 저장하지 못했습니다.", "error");
      }
    } catch {
      toast("개인문서함에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
    } finally {
      setBusy(null);
    }
  };

  if (!files.length) return null;
  const total = files.reduce((s, f) => s + (f.sizeBytes ?? 0), 0);
  const fileHref = (id: string) => `/api/mail/attachments?id=${encodeURIComponent(id)}`;

  return (
    <section className="rounded-[10px] border cd-border-c cd-card-bg overflow-hidden" aria-label="첨부 파일">
      {/* 머리 줄 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b cd-hairline-c">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm cd-text font-semibold"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title={open ? "첨부 목록 접기" : "첨부 목록 펼치기"}
        >
          {open ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
          첨부 {files.length}개
          <span className="text-xs font-normal cd-text-faint">{fmtSize(total)}</span>
        </button>
        {toPersonal ? (
          <button
            type="button"
            className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1.5"
            disabled={busy !== null}
            onClick={() => saveToPersonal(null, "__all")}
            title={`첨부 ${files.length}개를 모두 개인문서함에 복사합니다.`}
          >
            {busy === "__all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />}
            개인문서함에 모두 저장
          </button>
        ) : (
          files.length > 1 && (
            <a
              href={`/api/mail/attachments/zip?messageId=${encodeURIComponent(messageId)}`}
              className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1.5"
              title={`첨부 ${files.length}개를 ZIP 파일 하나로 내려받습니다.`}
            >
              <FileArchive className="w-3.5 h-3.5" aria-hidden="true" />
              전체 저장(ZIP)
            </a>
          )
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs cd-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={toPersonal}
            onChange={(e) => changeMode(e.target.checked)}
          />
          개인문서함으로 저장
        </label>
      </div>

      {/* 파일 줄 */}
      {open && (
        <ul className="py-1">
          {files.map((f) => {
            const [stem, ext] = splitName(f.filename);
            const saving = busy === f.attachmentId;
            const nameCls = "min-w-0 flex-1 flex items-baseline text-sm cd-text";
            return (
              <li key={f.attachmentId} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-[color:var(--cd-hover)]">
                <FileTypeIcon filename={f.filename} size={26} className="shrink-0" />
                {toPersonal ? (
                  <span className={nameCls} title={f.filename}>
                    <span className="truncate">{stem}</span>
                    <span className="shrink-0">{ext}</span>
                  </span>
                ) : (
                  <a href={fileHref(f.attachmentId)} className={`${nameCls} hover:underline underline-offset-2`} title={`${f.filename} — 내 PC에 저장`}>
                    <span className="truncate">{stem}</span>
                    <span className="shrink-0">{ext}</span>
                  </a>
                )}
                <span className="shrink-0 text-xs cd-text-faint tabular-nums">{fmtSize(f.sizeBytes)}</span>
                {mailAttachmentPreviewKind(f.filename) !== "none" && (
                  <button
                    type="button"
                    className="cd-btn cd-btn-ghost cd-btn-sm !px-2 shrink-0"
                    onClick={() => setPreviewing(f)}
                    title="미리보기"
                    aria-label={`${f.filename} 미리보기`}
                  >
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                {toPersonal ? (
                  <button
                    type="button"
                    className="cd-btn cd-btn-ghost cd-btn-sm !px-2 shrink-0"
                    disabled={busy !== null}
                    onClick={() => saveToPersonal([f.attachmentId], f.attachmentId)}
                    title="개인문서함에 저장"
                    aria-label={`${f.filename} 개인문서함에 저장`}
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FolderInput className="w-4 h-4" aria-hidden="true" />}
                  </button>
                ) : (
                  <a
                    href={fileHref(f.attachmentId)}
                    className="cd-btn cd-btn-ghost cd-btn-sm !px-2 shrink-0"
                    title="내 PC에 저장"
                    aria-label={`${f.filename} 내 PC에 저장`}
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <MailAttachmentPreviewModal file={previewing} onClose={() => setPreviewing(null)} />
    </section>
  );
}

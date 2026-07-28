"use client";

// 공지 작성(G6-B) — 메일 쓰기 화면과 같은 구성(제목·파일첨부·리치 에디터)에
// 공지 기간 / 상단 고정 기간 / 알림 방법을 더한다.
// 상단 고정 기간은 '상단 고정' 체크를 켰을 때만 입력할 수 있다(사용자 요청).

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bell, HardDrive, Megaphone, Paperclip, Pin, Send, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput } from "@/components/cdash/CdField";
import { useCdToast } from "@/components/cdash/CdToast";
import { MailEditor } from "@/components/mail/MailEditor";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import "@/components/cdash/cdash.css";

const MAX_TOTAL_ATTACH_BYTES = 20 * 1024 * 1024;

export function BoardWriteBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const sp = useSearchParams();
  const initialScope = sp.get("scope") === "company" ? "company" : "dept";

  const [scope, setScope] = useState<"company" | "dept">(initialScope);
  const [isAdmin, setIsAdmin] = useState(false);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [noticeFrom, setNoticeFrom] = useState("");
  const [noticeTo, setNoticeTo] = useState("");
  const [pinned, setPinned] = useState(false);
  const [pinFrom, setPinFrom] = useState("");
  const [pinTo, setPinTo] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyPush, setNotifyPush] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsAdmin(d?.user?.role === "admin"))
      .catch(() => {});
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = "<div><br></div>";
    }, 30);
  }, []);

  const addFiles = (incoming: File[]) => {
    setFiles((prev) => {
      let total = prev.reduce((s, f) => s + f.size, 0);
      const next = [...prev];
      for (const f of incoming) {
        if (total + f.size > MAX_TOTAL_ATTACH_BYTES) {
          toast(`'${f.name}' 은 첨부 총량(20MB)을 초과해 제외했습니다.`, "warn");
          continue;
        }
        total += f.size;
        next.push(f);
      }
      return next;
    });
  };

  const submit = async () => {
    if (!title.trim()) {
      toast("제목을 입력하세요.", "warn");
      return;
    }
    if (pinned && !pinFrom && !pinTo) {
      toast("상단 고정 기간을 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set("scope", scope);
      fd.set("title", title);
      fd.set("bodyHtml", editorRef.current?.innerHTML ?? "");
      if (noticeFrom) fd.set("noticeFrom", noticeFrom);
      if (noticeTo) fd.set("noticeTo", noticeTo);
      fd.set("pinned", pinned ? "1" : "0");
      if (pinned && pinFrom) fd.set("pinFrom", pinFrom);
      if (pinned && pinTo) fd.set("pinTo", pinTo);
      fd.set("notifyEmail", notifyEmail ? "1" : "0");
      fd.set("notifyPush", notifyPush ? "1" : "0");
      for (const f of files) fd.append("files", f);
      const r = await fetch("/api/board", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(String(d.error ?? "등록에 실패했습니다."), "error");
        return;
      }
      toast("공지를 등록했습니다.", "success");
      if (Array.isArray(d.attachFailed) && d.attachFailed.length) {
        toast(`첨부 ${d.attachFailed.length}건은 저장하지 못했습니다(${d.attachFailed.join(", ")}). 글은 등록됐으니 수정에서 다시 올려주세요.`, "warn");
      }
      if (d.pushQueued) toast("모바일 앱 푸시 알림을 발송했습니다.", "info");
      router.push(`/board?scope=${scope}`);
    } finally {
      setSaving(false);
    }
  };

  const totalKB = Math.ceil(files.reduce((s, f) => s + f.size, 0) / 1024);

  return (
    <div className="cdash cd-fields-white cd-mail-surface flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<Megaphone className="w-5 h-5" />}
        breadcrumbs={[{ label: "공지·게시판", href: "/board" }, { label: "공지 작성" }]}
        title="공지 작성"
        actions={
          <div className="flex items-center gap-2">
            <CdButton icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push("/board")}>
              목록
            </CdButton>
            <CdButton variant="primary" loading={saving} icon={<Send className="w-4 h-4" />} onClick={submit}>
              등록
            </CdButton>
          </div>
        }
      />

      <div className="flex flex-col gap-3 w-full">
        {/* 게시판 선택 — 전사 공지는 관리자만 */}
        <div className="flex items-center gap-1.5">
          <span className="cd-label mr-1">게시판</span>
          <button type="button" className="cd-chip cd-chip-sm" data-active={scope === "dept"} onClick={() => setScope("dept")}>
            부서 게시판
          </button>
          <button
            type="button"
            className="cd-chip cd-chip-sm disabled:opacity-40"
            data-active={scope === "company"}
            disabled={!isAdmin}
            title={isAdmin ? undefined : "전사 공지는 관리자만 작성할 수 있습니다."}
            onClick={() => setScope("company")}
          >
            전사 공지
          </button>
        </div>

        <CdInput label="제목" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="공지 제목" />

        {/* 파일첨부 — 메일 쓰기와 동일한 드롭존(첨부 영역에만 드롭) */}
        <div className="flex flex-col gap-1.5">
          <span className="cd-label flex items-center gap-2">
            <span className="mr-3">파일첨부</span>
            <CdButton size="sm" className="cd-card-bg" icon={<HardDrive className="w-3.5 h-3.5" />} onClick={() => fileInputRef.current?.click()}>
              내 PC
            </CdButton>
            {totalKB > 0 && <span className="text-[11px] cd-text-faint">합계 {totalKB} KB / 최대 20MB</span>}
          </span>
          <div
            className="rounded-xl border px-3 py-2.5 flex flex-col gap-1 min-h-[6rem] bg-white transition-colors"
            style={{ borderColor: dragging ? "var(--cd-primary)" : "var(--cd-border)", borderStyle: dragging ? "solid" : "dashed" }}
            onClick={() => files.length === 0 && fileInputRef.current?.click()}
            onDragEnter={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDragLeave={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              addFiles(Array.from(e.dataTransfer.files));
            }}
            role="button"
          >
            {files.length === 0 ? (
              <span className="text-xs cd-text-faint flex items-center gap-1.5 m-auto">
                <Paperclip className="w-4 h-4" /> 파일을 마우스로 끌어 오세요 (클릭해도 선택 가능)
              </span>
            ) : (
              files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border cd-border-c px-2.5 py-1.5 text-xs text-black">
                  <Paperclip className="w-3.5 h-3.5 shrink-0 cd-text-faint" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="cd-text-faint shrink-0">{Math.ceil(f.size / 1024)} KB</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFiles((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                    className="cd-text-faint hover:opacity-70 shrink-0"
                    aria-label="첨부 제거"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <MailEditor ref={editorRef} onInput={() => {}} minHeightPx={420} />
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ""; }} />

        {/* 공지 기간 · 상단 고정 · 알림 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <section className="rounded-xl border cd-border-c cd-card-bg p-4 flex flex-col gap-2">
            <h3 className="text-sm font-bold cd-text">공지 기간</h3>
            <p className="text-[11px] cd-text-faint">비우면 기간 제한 없이 게시됩니다(YYYYMMDD).</p>
            <div className="flex items-center gap-1.5">
              <AutoDateInput className="cd-input" value={noticeFrom} onChange={setNoticeFrom} />
              <span className="cd-text-faint text-xs">~</span>
              <AutoDateInput className="cd-input" value={noticeTo} onChange={setNoticeTo} />
            </div>
          </section>

          <section className="rounded-xl border cd-border-c cd-card-bg p-4 flex flex-col gap-2">
            <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
              <Pin className="w-4 h-4" /> 상단 고정
            </h3>
            <CdCheckbox label="목록 최상단에 고정" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            {/* 고정 기간은 체크했을 때만 입력 가능 */}
            <div className={pinned ? "" : "opacity-45 pointer-events-none select-none"}>
              <div className="flex items-center gap-1.5">
                <AutoDateInput className="cd-input" disabled={!pinned} value={pinFrom} onChange={setPinFrom} />
                <span className="cd-text-faint text-xs">~</span>
                <AutoDateInput className="cd-input" disabled={!pinned} value={pinTo} onChange={setPinTo} />
              </div>
              <p className="text-[11px] cd-text-faint mt-1">{pinned ? "이 기간 동안 목록 맨 위에 표시됩니다." : "상단 고정을 켜면 기간을 지정할 수 있습니다."}</p>
            </div>
          </section>

          <section className="rounded-xl border cd-border-c cd-card-bg p-4 flex flex-col gap-2">
            <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
              <Bell className="w-4 h-4" /> 공지 알림
            </h3>
            <CdCheckbox label="메일 알림 발송" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
            <CdCheckbox label="모바일 앱 푸시 알림" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} />
            <p className="text-[11px] cd-text-faint">
              {scope === "company" ? "전 임직원" : "소속 부서원"}에게 발송됩니다(작성자 본인 제외). 푸시는 MCM 앱에서 알림을 켠 사람에게만 갑니다.
            </p>
          </section>
        </div>

        <div className="flex items-center gap-2 pb-6">
          <CdButton variant="primary" loading={saving} icon={<Send className="w-4 h-4" />} onClick={submit}>
            등록
          </CdButton>
          <CdButton onClick={() => router.push("/board")}>취소</CdButton>
        </div>
      </div>
    </div>
  );
}

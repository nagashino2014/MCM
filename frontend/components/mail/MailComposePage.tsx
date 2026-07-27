"use client";

// 메일 쓰기 — 별도 페이지(G2-8, 모달 폐지: 편집 도구가 많아 전용 페이지가 적합 · 네이버 메일 방식).
// 진입: /mail/compose (새 메일) · ?mode=reply|replyall|forward&id=<messageId> (인용) · ?draft=<draftId> (이어쓰기).
// 첨부: [내 PC](탐색기) + [문서함](추후 개인/부서/전사 문서함 모달 — 현재 자리만) + 상시 드래그 앤 드롭 존.
// 인라인 이미지: blob 미리보기 → 발송 시 cid: 첨부(MIME inline)로 치환 — 외부 수신측에서도 표시.
// 서명 자동삽입·드래프트 3초 자동저장. 발송 성공 시 /mail 복귀.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, FolderOpen, HardDrive, Mail, Paperclip, PenLine, Save, Send, Settings2, UploadCloud, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { useCdToast } from "@/components/cdash/CdToast";
import { MailEditor } from "@/components/mail/MailEditor";
import { MailSignatureManager } from "@/components/mail/MailSignatureManager";
import { RecipientInput } from "@/components/mail/RecipientInput";
import type { MailMessageDetail } from "@/lib/mail/messages";
import type { MailSignature } from "@/lib/mail/signatures";
import "@/components/cdash/cdash.css";

const MAX_TOTAL_ATTACH_BYTES = 7 * 1024 * 1024;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 인용 본문 — 원문 cid 이미지는 앱 첨부 URL 로 치환(앱 내 표시용. 외부 재전송 시 원 첨부 재포함은 후속). */
function buildQuote(d: MailMessageDetail): string {
  let body = d.bodyHtml ?? `<div style="white-space:pre-wrap">${escapeHtml(d.bodyText ?? "")}</div>`;
  for (const a of d.attachments) {
    if (a.contentId) body = body.split(`cid:${a.contentId}`).join(`/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`);
  }
  const when = d.receivedAt ?? d.sentAt ?? d.createdAt;
  return (
    `<div><br></div><div><br></div>` +
    `<div style="color:#888;font-size:12px">-------- 원본 메일 --------<br>` +
    `보낸사람: ${escapeHtml(d.fromAddr ?? "-")}<br>` +
    `날짜: ${escapeHtml(when)}<br>` +
    `제목: ${escapeHtml(d.subject)}</div>` +
    `<blockquote style="margin:8px 0 0;padding-left:12px;border-left:3px solid #ccc">${body}</blockquote>`
  );
}

function prefixSubject(prefix: "Re" | "Fwd", subject: string): string {
  const re = new RegExp(`^${prefix}:\\s*`, "i");
  return re.test(subject) ? subject : `${prefix}: ${subject}`;
}

interface InlineImage {
  cid: string;
  file: File;
  blobUrl: string;
}

export function MailComposePage() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loadingSeed, setLoadingSeed] = useState(true);
  const [myAddress, setMyAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [bcc, setBcc] = useState("");
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
  const [dragging, setDragging] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false); // 서명 관리 모달
  const [sigMenuOpen, setSigMenuOpen] = useState(false); // 서명 드롭다운(G2-10)
  const [signatures, setSignatures] = useState<MailSignature[]>([]);
  const dragDepth = useRef(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const idemRef = useRef("");
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadRef = useRef<{ inReplyTo: string | null; references: string[] }>({ inReplyTo: null, references: [] });
  const inlineImages = useRef<InlineImage[]>([]);

  // ── 시드 로딩(모드별) ─────────────────────────────
  useEffect(() => {
    idemRef.current = globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random());
    const mode = searchParams.get("mode");
    const id = searchParams.get("id");
    const draftParam = searchParams.get("draft");
    // 주소록(G6-A) 등에서 받는 사람을 지정해 진입(/mail/compose?to=...).
    const toParam = searchParams.get("to");
    if (toParam) setTo(toParam);

    const load = async () => {
      try {
        // 내 메일함(발신 표시) + 기본 서명(서명 템플릿 → 없으면 구 mailbox.signature_html 폴백).
        let signature: string | null = null;
        try {
          const r = await fetch("/api/mail/mailbox");
          if (r.ok) {
            const d = await r.json();
            setMyAddress(String(d.address ?? ""));
            setDisplayName(String(d.displayName ?? ""));
            signature = d.signatureHtml != null ? String(d.signatureHtml) : null;
          }
        } catch {
          /* noop */
        }
        try {
          const r = await fetch("/api/mail/signatures");
          if (r.ok) {
            const d = await r.json();
            const list = Array.isArray(d.signatures) ? (d.signatures as MailSignature[]) : [];
            setSignatures(list);
            const def = list.find((s) => s.isDefault);
            if (def) signature = def.bodyHtml;
          }
        } catch {
          /* noop */
        }
        const sig = signature ? `<br><br><div>--<br>${signature}</div>` : "";

        let initialHtml = `<div><br></div>${sig}`;
        if (draftParam) {
          const r = await fetch("/api/mail/drafts");
          if (r.ok) {
            const d = await r.json();
            const found = (Array.isArray(d.drafts) ? d.drafts : []).find(
              (x: { draftId: string }) => x.draftId === draftParam
            );
            if (found) {
              setTo(String(found.to ?? ""));
              setCc(String(found.cc ?? ""));
              setShowCc(!!found.cc);
              setBcc(String(found.bcc ?? ""));
              setShowBcc(!!found.bcc);
              setSubject(String(found.subject ?? ""));
              setDraftId(String(found.draftId));
              threadRef.current.inReplyTo = found.inReplyTo ?? null;
              initialHtml = String(found.bodyHtml ?? initialHtml);
            }
          }
        } else if (id && (mode === "reply" || mode === "replyall" || mode === "forward")) {
          const r = await fetch(`/api/mail/messages/${id}`);
          if (r.ok) {
            const d = (await r.json()) as MailMessageDetail;
            const quote = buildQuote(d);
            initialHtml = `<div><br></div>${sig}${quote}`;
            if (mode === "forward") {
              setSubject(prefixSubject("Fwd", d.subject));
              threadRef.current.references = d.references;
            } else {
              setTo(d.fromAddr ?? "");
              if (mode === "replyall") {
                const my = (await (async () => myAddress)()).toLowerCase();
                const ccList = [...d.toAddrs, ...d.ccAddrs].map((a) => a.address).filter((a) => a.toLowerCase() !== my && a);
                if (ccList.length) {
                  setCc(ccList.join(", "));
                  setShowCc(true);
                }
              }
              setSubject(prefixSubject("Re", d.subject));
              threadRef.current.inReplyTo = d.rfcMessageId;
              threadRef.current.references = [...d.references, ...(d.rfcMessageId ? [d.rfcMessageId] : [])];
            }
          }
        }
        setTimeout(() => {
          if (editorRef.current) editorRef.current.innerHTML = initialHtml;
        }, 30);
      } finally {
        setLoadingSeed(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 드래프트 수동 저장(G2-12) — [임시 저장] 버튼을 눌렀을 때만 임시보관함에 저장(자동저장 폐지). ──
  const saveDraftNow = useCallback(async () => {
    setDraftState("saving");
    try {
      const r = await fetch("/api/mail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          to,
          cc: showCc ? cc : "",
          bcc: showBcc ? bcc : "",
          subject,
          bodyHtml: editorRef.current?.innerHTML ?? "",
          inReplyTo: threadRef.current.inReplyTo,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.draftId) setDraftId(String(d.draftId));
        setDraftState("saved");
        toast("임시보관함에 저장했습니다.", "success");
      } else {
        setDraftState("idle");
        toast("임시 저장에 실패했습니다.", "error");
      }
    } catch {
      setDraftState("idle");
      toast("임시 저장 중 오류가 발생했습니다.", "error");
    }
  }, [draftId, to, cc, showCc, bcc, showBcc, subject, toast]);
  /** 입력 변경 콜백 — 자동저장 폐지로 저장 안 함(저장 상태 표시만 초기화). */
  const scheduleDraftSave = useCallback(() => {
    setDraftState("idle");
  }, []);

  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    for (const im of inlineImages.current) URL.revokeObjectURL(im.blobUrl);
  }, []);

  // 서명 드롭다운 외부 클릭/ESC 닫기.
  useEffect(() => {
    if (!sigMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-sig-menu]")) setSigMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSigMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [sigMenuOpen]);

  /** 서명 블록 삽입(드롭다운·관리 모달 공용). */
  const insertSignature = (bodyHtml: string) => {
    editorRef.current?.focus();
    document.execCommand("insertHTML", false, `<br><div>--<br>${bodyHtml}</div>`);
    scheduleDraftSave();
  };

  /** 서명 목록 재로드(관리 모달에서 추가/삭제 후). */
  const reloadSignatures = useCallback(async () => {
    try {
      const r = await fetch("/api/mail/signatures");
      if (r.ok) {
        const d = await r.json();
        setSignatures(Array.isArray(d.signatures) ? d.signatures : []);
      }
    } catch {
      /* noop */
    }
  }, []);

  // ── 첨부(버튼·DnD 공용) ───────────────────────────
  const totalAttachedBytes = () =>
    files.reduce((s, f) => s + f.size, 0) + inlineImages.current.reduce((s, i) => s + i.file.size, 0);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;
      setFiles((prev) => {
        let total = prev.reduce((s, f) => s + f.size, 0) + inlineImages.current.reduce((s, i) => s + i.file.size, 0);
        const accepted: File[] = [];
        for (const f of incoming) {
          if (total + f.size > MAX_TOTAL_ATTACH_BYTES) {
            toast(`'${f.name}' 은 첨부 총량(7MB)을 초과해 제외했습니다.`, "warn");
            continue;
          }
          total += f.size;
          accepted.push(f);
        }
        return [...prev, ...accepted];
      });
    },
    [toast]
  );

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  /** 인라인 이미지 삽입 — blob 미리보기, 발송 시 cid 치환. */
  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (imageInputRef.current) imageInputRef.current.value = "";
    for (const f of picked) {
      if (!f.type.startsWith("image/")) continue;
      if (totalAttachedBytes() + f.size > MAX_TOTAL_ATTACH_BYTES) {
        toast(`'${f.name}' 은 첨부 총량(7MB)을 초과해 제외했습니다.`, "warn");
        continue;
      }
      const cid = `${globalThis.crypto?.randomUUID?.() ?? Date.now()}@koensain.app`;
      const blobUrl = URL.createObjectURL(f);
      inlineImages.current.push({ cid, file: f, blobUrl });
      editorRef.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${blobUrl}" data-cid="${cid}" style="max-width:100%"><div><br></div>`);
    }
    scheduleDraftSave();
  };

  // 드래그 앤 드롭 — 상시 드롭존 + 페이지 전체.
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ── 발송 ─────────────────────────────────────────
  const send = async () => {
    if (!to.trim()) {
      toast("받는 사람을 입력하세요.", "warn");
      return;
    }
    setSending(true);
    try {
      let html = editorRef.current?.innerHTML ?? "";
      const fd = new FormData();
      const usedCids: string[] = [];
      for (const im of inlineImages.current) {
        if (!html.includes(im.blobUrl)) continue; // 본문에서 지워진 이미지는 제외
        html = html.split(im.blobUrl).join(`cid:${im.cid}`);
        fd.append("inlineFiles", im.file);
        usedCids.push(im.cid);
      }
      fd.append("inlineCids", JSON.stringify(usedCids));
      fd.append("to", to);
      if (showCc && cc.trim()) fd.append("cc", cc);
      if (showBcc && bcc.trim()) fd.append("bcc", bcc);
      fd.append("subject", subject);
      fd.append("bodyHtml", html);
      fd.append("idempotencyKey", idemRef.current);
      if (draftId) fd.append("draftId", draftId);
      if (threadRef.current.inReplyTo) fd.append("inReplyTo", threadRef.current.inReplyTo);
      if (threadRef.current.references.length) fd.append("references", threadRef.current.references.join(" "));
      for (const f of files) fd.append("files", f);
      const r = await fetch("/api/mail/send", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(String(d.error ?? "발송에 실패했습니다."), "error");
        return;
      }
      toast(d.duplicate ? "이미 발송된 메일입니다." : "메일을 발송했습니다.", "success");
      router.push("/mail");
    } catch (err) {
      toast(err instanceof Error ? err.message : "발송 중 오류가 발생했습니다.", "error");
    } finally {
      setSending(false);
    }
  };

  const totalKB = Math.ceil(files.reduce((s, f) => s + f.size, 0) / 1024);

  return (
    <div
      className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl overflow-y-auto"
      data-theme={theme}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <CdPageHeader
        icon={<Mail className="w-5 h-5" />}
        breadcrumbs={[{ label: "메일", href: "/mail" }, { label: "메일 쓰기" }]}
        title="메일 쓰기"
        subtitle={myAddress ? `보낸 사람: ${displayName ? `${displayName} <${myAddress}>` : myAddress}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11px] cd-text-faint">
              {draftState === "saving" ? "저장 중…" : draftState === "saved" ? "임시저장됨" : ""}
            </span>
            <CdButton icon={<Save className="w-4 h-4" />} onClick={saveDraftNow}>
              임시 저장
            </CdButton>
            {/* 메일 서명 — 드롭다운(목록 선택 삽입 + 관리 진입, G2-10) */}
            <span className="relative inline-flex" data-sig-menu>
              <CdButton icon={<PenLine className="w-4 h-4" />} onClick={() => setSigMenuOpen((v) => !v)}>
                메일 서명 <ChevronDown className="w-3.5 h-3.5 opacity-50" />
              </CdButton>
              {sigMenuOpen && (
                <div
                  className="absolute top-[calc(100%+6px)] right-0 z-50 w-60 rounded-xl overflow-hidden py-1.5 border cd-border-c cd-card-bg"
                  style={{ boxShadow: "var(--cd-shadow)" }}
                  role="menu"
                >
                  {signatures.length === 0 ? (
                    <p className="px-4 py-2.5 text-xs cd-text-faint">저장된 서명이 없습니다.</p>
                  ) : (
                    signatures.map((s) => (
                      <button
                        key={s.signatureId}
                        role="menuitem"
                        onClick={() => {
                          setSigMenuOpen(false);
                          insertSignature(s.bodyHtml);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm font-medium flex items-center gap-2 cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                      >
                        <span className="flex-1 truncate">{s.name}</span>
                        {s.isDefault && <span className="text-[10px] cd-text-faint">기본</span>}
                      </button>
                    ))
                  )}
                  <div className="border-t cd-border-c mt-1 pt-1">
                    <button
                      role="menuitem"
                      onClick={() => {
                        setSigMenuOpen(false);
                        setSignatureOpen(true);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm font-medium flex items-center gap-2 cd-text-muted hover:text-[color:var(--cd-text)] cd-row-hover"
                    >
                      <Settings2 className="w-4 h-4" /> 서명 관리…
                    </button>
                  </div>
                </div>
              )}
            </span>
            <CdButton icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push("/mail")}>
              메일함
            </CdButton>
            <CdButton variant="primary" loading={sending} icon={<Send className="w-4 h-4" />} onClick={send}>
              보내기
            </CdButton>
          </div>
        }
      />

      {loadingSeed ? (
        <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
      ) : (
        // 폭: 고정 max-w 없이 브라우저 폭 추종(네이버 메일 방식 — 셸의 울트라와이드 상한만 적용됨).
        <div className="relative flex flex-col gap-3 w-full">
          {/* 드래그 오버레이 */}
          {dragging && (
            <div
              className="absolute inset-0 z-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 pointer-events-none"
              style={{ borderColor: "var(--cd-primary)", background: "color-mix(in srgb, var(--cd-primary-soft) 85%, transparent)" }}
            >
              <UploadCloud className="w-10 h-10" style={{ color: "var(--cd-primary)" }} />
              <p className="text-sm font-bold" style={{ color: "var(--cd-primary)" }}>
                여기에 파일을 놓으면 첨부됩니다
              </p>
            </div>
          )}

          <RecipientInput
            label="받는 사람"
            required
            labelExtra={
              !showCc ? (
                <button onClick={() => setShowCc(true)} className="text-[11px]" style={{ color: "var(--cd-primary)" }} type="button">
                  + 참조(CC)
                </button>
              ) : undefined
            }
            value={to}
            onChange={(next) => {
              setTo(next);
              scheduleDraftSave();
            }}
            placeholder="이름·주소를 입력하면 주소록에서 찾아줍니다"
          />
          {showCc && (
            <RecipientInput
              label="참조(CC)"
              labelExtra={
                !showBcc ? (
                  <button onClick={() => setShowBcc(true)} className="text-[11px]" style={{ color: "var(--cd-primary)" }} type="button">
                    + 숨은 참조
                  </button>
                ) : undefined
              }
              value={cc}
              onChange={(next) => {
                setCc(next);
                scheduleDraftSave();
              }}
              placeholder="참조 수신자"
            />
          )}
          {showBcc && (
            <RecipientInput
              label="숨은 참조(BCC)"
              hint="숨은 참조 수신자는 다른 수신자에게 표시되지 않습니다."
              value={bcc}
              onChange={(next) => {
                setBcc(next);
                scheduleDraftSave();
              }}
              placeholder="숨은 참조 수신자"
            />
          )}
          <CdInput
            label="제목"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              scheduleDraftSave();
            }}
            placeholder="제목"
          />

          {/* 파일첨부 — 내 PC / 문서함 버튼 + 상시 드롭존(네이버 메일식).
              드롭존·버튼은 흰 배경 + 윤곽선으로 페이지 배경과 구분(G2-9). */}
          <div className="flex flex-col gap-1.5">
            <span className="cd-label flex items-center gap-2">
              <span className="mr-3">파일첨부</span>
              <CdButton size="sm" className="bg-white" icon={<HardDrive className="w-3.5 h-3.5" />} onClick={() => fileInputRef.current?.click()}>
                내 PC
              </CdButton>
              <CdButton
                size="sm"
                className="bg-white"
                icon={<FolderOpen className="w-3.5 h-3.5" />}
                onClick={() => toast("문서함(개인/부서/전사)은 준비 중입니다.", "info")}
              >
                문서함
              </CdButton>
              {totalKB > 0 && <span className="text-[11px] cd-text-faint">합계 {totalKB} KB / 최대 7MB</span>}
            </span>
            {/* 상시 드롭존 — 첨부 순서대로 위→아래 목록 표시(G2-10). */}
            <div
              className="rounded-xl border border-dashed px-3 py-2.5 flex flex-col gap-1 min-h-[7rem] bg-white"
              style={{ borderColor: "var(--cd-border)" }}
              onClick={() => files.length === 0 && fileInputRef.current?.click()}
              role="button"
            >
              {files.length === 0 ? (
                <span className="text-xs cd-text-faint flex items-center gap-1.5 m-auto">
                  <UploadCloud className="w-4 h-4" /> 파일을 마우스로 끌어 오세요 (클릭해도 선택 가능)
                </span>
              ) : (
                <>
                  {files.map((f, i) => (
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
                  ))}
                  <span className="text-[11px] cd-text-faint pt-0.5">여기에 파일을 더 끌어다 놓을 수 있습니다.</span>
                </>
              )}
            </div>
          </div>

          <MailEditor ref={editorRef} onInput={scheduleDraftSave} onPickImage={() => imageInputRef.current?.click()} />

          <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
          <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={onPickImages} />

          <div className="flex items-center gap-2 pb-6">
            <CdButton variant="primary" loading={sending} icon={<Send className="w-4 h-4" />} onClick={send}>
              보내기
            </CdButton>
            <CdButton onClick={() => router.push("/mail")}>취소</CdButton>
          </div>
        </div>
      )}

      <MailSignatureManager
        open={signatureOpen}
        onClose={() => {
          setSignatureOpen(false);
          reloadSignatures(); // 관리에서 추가/삭제/기본 변경 반영
        }}
        onInsert={insertSignature}
      />
    </div>
  );
}

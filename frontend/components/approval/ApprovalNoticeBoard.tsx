"use client";

// 내부고시 작성(/approval/notice) — 사내 전파용 고시 전용 기안 화면(2026-09-22 사용자 요청).
// 공문 작성(ApprovalLetterBoard)과 같은 틀이되 대외 발송 요소를 뺐다:
//   공문 유형·HWPX 동봉·주소 표기·수신처/참조/외부 참조·하단 전화/메일 표기·대금청구서 작성·사전 검수 없음.
//   머리 줄은 문서번호/시행일자/수신/발신/제목, 문서 끝은 시행일자·사명·대표이사 (직인) — lib/notice/pdf.ts.
// 상신 시 {연도}-내부고시-{NNNNN}호 자동 채번(lib/approval/docs.ts). 결재선 패널은 공문 작성 화면 이식
// (회귀 방지 위해 원본은 수정하지 않음 — 공문 화면이 ApprovalDraftBoard 를 이식한 것과 같은 관행).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BookmarkPlus, Eye, FileText, GripVertical, Megaphone, Plus, Save, Send, Stamp, Trash2, Users, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdDateInput } from "@/components/cdash/CdField";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { useDragOrder } from "@/components/approval/useDragOrder";
import { DeleteDraftButton, RejectedBanner, toEditDocMeta, type EditDocMeta } from "@/components/approval/DraftEditNotice";
import AttachmentPreviewModal from "@/components/approval/AttachmentPreviewModal";
import { ATTACHMENT_ACCEPT, ATTACHMENT_ALLOWED_TEXT, isAllowedAttachment, type DocAttachment } from "@/lib/approval/attachments";
import { MailEditor } from "@/components/mail/MailEditor";
import { ISO_DATE_RE } from "@/lib/letter/types";
import {
  DEFAULT_NOTICE_RECIPIENT, DEFAULT_NOTICE_SENDER, NOTICE_FORM_ID, type NoticeFieldValues,
} from "@/lib/notice/types";
import "@/components/cdash/cdash.css";

interface LineStep {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName: string;
  assigneePosition: string | null;
}

interface Watcher {
  userId: string;
  name: string;
  kind: "ref" | "view";
}

interface LinePreset {
  presetId: string;
  name: string;
  steps: { stepType: "agree" | "approve"; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }[];
  watchers: { userId: string; name: string | null; kind: "ref" | "view" }[];
}

type OrgTarget = "approve" | "ref";

export function ApprovalNoticeBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const editDocId = sp.get("docId");

  const [docId, setDocId] = useState<string | null>(editDocId);
  const [subject, setSubject] = useState("");
  const [recipientText, setRecipientText] = useState(DEFAULT_NOTICE_RECIPIENT);
  const [senderText, setSenderText] = useState(DEFAULT_NOTICE_SENDER);
  const [attachItems, setAttachItems] = useState<string[]>([]);
  const [stampOn, setStampOn] = useState(true);
  // 시행일 — 비우면 결재 완료일(미승인 미리보기는 오늘)
  const [issueDate, setIssueDate] = useState("");
  const [line, setLine] = useState<LineStep[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [presets, setPresets] = useState<LinePreset[]>([]);
  const [orgModal, setOrgModal] = useState<OrgTarget | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | "preview" | null>(null);
  const [loading, setLoading] = useState(!!editDocId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [docNo, setDocNo] = useState<string | null>(null); // 재편집 문서의 확정 번호
  const [nextNo, setNextNo] = useState<string | null>(null); // 신규 작성 시 채번 예정 번호
  const [fileAttachments, setFileAttachments] = useState<{ name: string; key: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewItem, setPreviewItem] = useState<DocAttachment | null>(null);
  const attachDrag = useDragOrder(fileAttachments, setFileAttachments);
  const [editMeta, setEditMeta] = useState<EditDocMeta | null>(null);
  const [noticeDrafts, setNoticeDrafts] = useState<
    Array<{ docId: string; title: string; status: string; docNo: string | null; updatedAt: string }>
  >([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingHtmlRef = useRef<string | null>(null);

  // 채번 예정 번호 + 내 임시저장 내부고시 목록
  useEffect(() => {
    fetch("/api/notices/next-no", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.nextNo) setNextNo(d.nextNo);
      })
      .catch(() => {});
    fetch("/api/approval/docs?box=draft", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const docs = Array.isArray(d?.docs) ? d.docs : [];
        setNoticeDrafts(
          docs
            .filter((doc: { formId?: string }) => doc.formId === NOTICE_FORM_ID)
            .map((doc: { docId: string; title?: string; status?: string; docNo?: string | null; updatedAt?: string }) => ({
              docId: String(doc.docId),
              title: String(doc.title ?? ""),
              status: String(doc.status ?? "draft"),
              docNo: doc.docNo ?? null,
              updatedAt: String(doc.updatedAt ?? ""),
            }))
        );
      })
      .catch(() => {});
  }, []);

  const openDraftDoc = useCallback(
    (targetDocId: string) => {
      if (targetDocId === docId) return;
      const hasContent = subject.trim().length > 0 || (editorRef.current?.textContent ?? "").trim().length > 0;
      if (hasContent && !window.confirm("현재 화면에 작성 중인 내용은 저장되지 않습니다. 선택한 임시저장 내부고시를 열까요?")) return;
      window.location.href = `/approval/notice?docId=${encodeURIComponent(targetDocId)}`;
    },
    [docId, subject]
  );

  // 재편집(임시저장/반려 문서) — field_values 복원
  useEffect(() => {
    if (!editDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/approval/docs/${encodeURIComponent(editDocId)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "문서를 불러오지 못했습니다.");
        if (cancelled) return;
        const d = data.doc;
        const v = (d.fieldValues ?? {}) as Partial<NoticeFieldValues>;
        setEditMeta(toEditDocMeta(d));
        setDocNo(d.docNo ?? null);
        setSubject(d.title ?? "");
        setRecipientText(v.recipient_text ?? DEFAULT_NOTICE_RECIPIENT);
        setSenderText(v.sender_text ?? DEFAULT_NOTICE_SENDER);
        setAttachItems(Array.isArray(v.attachments_list) ? v.attachments_list.map((a) => a.text) : []);
        setStampOn(v.stamp !== 0);
        setIssueDate(ISO_DATE_RE.test(v.issue_date ?? "") ? (v.issue_date as string) : "");
        setFileAttachments(Array.isArray(v.file_attachments) ? v.file_attachments : []);
        pendingHtmlRef.current = v.body_html ?? "";
        if (editorRef.current) editorRef.current.innerHTML = v.body_html ?? "";
        setLine(
          (d.steps ?? []).map((s: { stepType: string; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }) => ({
            stepType: s.stepType === "agree" ? "agree" : "approve",
            assigneeUserId: s.assigneeUserId,
            assigneeName: s.assigneeName ?? "",
            assigneePosition: s.assigneePosition,
          }))
        );
        setWatchers(
          (d.watchers ?? []).map((w: { userId: string; name: string | null; kind: string }) => ({
            userId: w.userId,
            name: w.name ?? "",
            kind: w.kind === "view" ? "view" : "ref",
          }))
        );
      } catch (err) {
        alert((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editDocId]);

  // 에디터 마운트 후 본문 주입(재편집 로드가 먼저 끝난 경우)
  useEffect(() => {
    if (!loading && pendingHtmlRef.current != null && editorRef.current && !editorRef.current.innerHTML.trim()) {
      editorRef.current.innerHTML = pendingHtmlRef.current;
      pendingHtmlRef.current = null;
    }
  }, [loading]);

  // 결재선 프리셋 (공문 작성 화면 이식)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/approval/line-presets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.presets)) setPresets(d.presets);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPreset = (p: LinePreset) => {
    setLine(
      p.steps.map((s) => ({
        stepType: s.stepType === "agree" ? "agree" : "approve",
        assigneeUserId: s.assigneeUserId,
        assigneeName: s.assigneeName ?? "",
        assigneePosition: s.assigneePosition,
      }))
    );
    setWatchers(p.watchers.map((w) => ({ userId: w.userId, name: w.name ?? "", kind: w.kind === "view" ? "view" : "ref" })));
  };

  const saveAsPreset = async () => {
    if (line.length === 0) {
      alert("저장할 결재선이 없습니다.");
      return;
    }
    const name = window.prompt("결재선 프리셋 이름을 입력하세요.", "");
    if (name == null) return;
    try {
      const res = await fetch("/api/approval/line-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          steps: line.map((s) => ({ stepType: s.stepType, assigneeUserId: s.assigneeUserId, assigneeName: s.assigneeName, assigneePosition: s.assigneePosition })),
          watchers: watchers.map((w) => ({ userId: w.userId, name: w.name, kind: w.kind })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "프리셋 저장 실패");
      const listRes = await fetch("/api/approval/line-presets", { cache: "no-store" });
      if (listRes.ok) setPresets((await listRes.json()).presets ?? []);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const deletePreset = async (presetId: string) => {
    try {
      await fetch(`/api/approval/line-presets?presetId=${encodeURIComponent(presetId)}`, { method: "DELETE" });
      setPresets((prev) => prev.filter((p) => p.presetId !== presetId));
    } catch {
      // 무시
    }
  };

  /** 본문 에디터 커서 위치에 HTML 삽입(관용구 버튼) — MailEditor 의 insertHTML 관행. */
  const insertBodyHtml = (html: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    document.execCommand("insertHTML", false, html);
  };

  const buildFieldValues = useCallback((): NoticeFieldValues => {
    const values: NoticeFieldValues = {
      recipient_text: recipientText.trim(),
      sender_text: senderText.trim(),
      subject,
      body_html: editorRef.current?.innerHTML ?? "",
      attachments_list: attachItems.map((t, i) => ({ no: i + 1, text: t })).filter((a) => a.text.trim()),
      stamp: stampOn ? 1 : 0,
      ...(ISO_DATE_RE.test(issueDate) ? { issue_date: issueDate } : {}),
    };
    if (fileAttachments.length) values.file_attachments = fileAttachments;
    return values;
  }, [recipientText, senderText, subject, attachItems, stampOn, issueDate, fileAttachments]);

  const persist = useCallback(
    // docIdOverride: save 직후 같은 턴의 submit — setDocId 는 비동기라 새 문서가 하나 더 생기는 것을 막는다.
    async (action: "save" | "submit", docIdOverride?: string): Promise<{ docId: string; docNo?: string | null }> => {
      const res = await fetch("/api/approval/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          docId: docIdOverride ?? docId,
          formId: NOTICE_FORM_ID,
          title: subject,
          urgent: false,
          fieldValues: buildFieldValues(),
          line,
          watchers: watchers.map((w) => ({ userId: w.userId, kind: w.kind })),
          refDocId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setDocId(data.docId);
      return { docId: data.docId, docNo: data.docNo };
    },
    [docId, subject, buildFieldValues, line, watchers]
  );

  const validate = useCallback((): string | null => {
    if (!subject.trim()) return "제목을 입력하세요.";
    if (!recipientText.trim()) return "수신을 입력하세요(예: 전 임직원).";
    const html = editorRef.current?.innerHTML ?? "";
    if (!html.replace(/<[^>]+>|&nbsp;/g, "").trim()) return "본문을 작성하세요.";
    if (line.length === 0) return "결재선에 결재자를 1명 이상 추가하세요.";
    return null;
  }, [subject, recipientText, line]);

  /** 첨부 업로드 — DnD/파일 선택 공용. 전자결재 첨부 공통 규약(field_values.file_attachments). */
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const rejected = list.filter((f) => !isAllowedAttachment(f.name));
    if (rejected.length) {
      alert(`첨부할 수 없는 형식입니다 — ${rejected.map((f) => f.name).join(", ")}\n허용 형식: ${ATTACHMENT_ALLOWED_TEXT}`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      const res = await fetch("/api/approval/attachments", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "첨부 업로드 실패");
      setFileAttachments((prev) => [...prev, ...(data.items ?? [])]);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  }, []);

  const openPreview = useCallback(async () => {
    setPreviewOpen(true);
    setBusy("preview");
    try {
      const res = await fetch("/api/notices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: buildFieldValues(), docNo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? "미리보기 생성 실패");
      }
      const blob = await res.blob();
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      alert((err as Error).message);
      setPreviewOpen(false);
    } finally {
      setBusy(null);
    }
  }, [buildFieldValues, docNo]);

  const send = useCallback(
    async (action: "save" | "submit") => {
      if (action === "submit") {
        const msg = validate();
        if (msg) {
          alert(msg);
          return;
        }
      }
      setBusy(action);
      try {
        // 항상 save 먼저 — 반환된 docId 를 이어지는 submit 에 명시 전달(이중 문서 생성 방지)
        const saved = await persist("save");
        if (action === "save") {
          alert("임시저장되었습니다.");
          return;
        }
        const done = await persist("submit", saved.docId);
        alert(`상신되었습니다. 문서번호: ${done.docNo}`);
        router.push("/approval");
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [validate, persist, router]
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Megaphone className="w-5 h-5" />}
        eyebrow="Approval · Internal Notice"
        title="내부고시 작성"
        subtitle="사내 전파용 고시입니다. 상신 시 문서번호가 확정되고, 결재 완료 문서는 PDF 로 열람합니다."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              disabled={busy != null}
              onClick={() => send("save")}
              title="작성 중인 내부고시와 첨부파일을 임시저장합니다(상신 전, 나중에 이어서 작성)"
            >
              <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "저장"}
            </button>
            <DeleteDraftButton docId={docId} meta={editMeta} label="내부고시 삭제" />
            <Link href="/approval" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> 전자결재 홈
            </Link>
          </div>
        }
      />

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <>
        <div className="max-w-[1032px]">
          <RejectedBanner meta={editMeta} />
          {noticeDrafts.length > 0 && (
            <div className="rounded-xl border cd-border-c cd-solid-bg px-3.5 py-2.5 mb-3 text-[12px]">
              <button
                type="button"
                className="flex items-center gap-1.5 font-semibold cd-text w-full text-left"
                onClick={() => setDraftsOpen((v) => !v)}
              >
                <Save className="w-4 h-4 cd-text-primary shrink-0" />
                임시저장 내부고시 {noticeDrafts.length}건
                <span className="cd-text-faint font-normal">{draftsOpen ? "접기 ▲" : "펼쳐서 이어서 작성 ▼"}</span>
              </button>
              {draftsOpen && (
                <div className="mt-2 grid gap-1 max-h-56 overflow-y-auto">
                  {noticeDrafts.map((d) => {
                    const current = d.docId === docId;
                    return (
                      <button
                        key={d.docId}
                        type="button"
                        disabled={current}
                        onClick={() => openDraftDoc(d.docId)}
                        className={
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left hover:brightness-[0.98] " +
                          (current ? "border-[color:var(--cd-primary)]" : "cd-border-c")
                        }
                        style={{ background: "var(--cd-action-background-soft)" }}
                      >
                        <FileText className="w-3.5 h-3.5 cd-text-faint shrink-0" />
                        <span className="cd-text truncate flex-1">{d.title || "(제목 없음)"}</span>
                        {d.status === "rejected" && (
                          <span className="rounded-full px-1.5 py-0.5 text-[10px] cd-error-text border border-current shrink-0">반려</span>
                        )}
                        {d.docNo && <span className="font-mono text-[10.5px] cd-text-faint shrink-0">{d.docNo}</span>}
                        <span className="text-[10.5px] cd-text-faint shrink-0">{d.updatedAt.slice(0, 10)}</span>
                        {current && <span className="text-[10.5px] cd-text-primary shrink-0">편집 중</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          {/* 좌: 고시 내용 — 폭은 공문 작성과 동일 */}
          <div className="cd-card rounded-3xl p-5 flex-1 min-w-0 max-w-[1032px] flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-xl border cd-border-c px-3.5 py-2 flex-wrap">
              <FileText className="w-4 h-4 cd-text-primary shrink-0" />
              <span className="text-[12.5px] cd-text">
                문서번호 <b className="font-mono">{docNo ?? nextNo ?? "조회 중..."}</b>
              </span>
              {!docNo && (
                <span className="text-[10.5px] cd-text-faint">채번 예정 — 상신 시 확정됩니다(먼저 상신되는 문서가 이 번호를 가져갈 수 있음)</span>
              )}
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer" title="문서 끝 '대표이사 (직인)' 자리에 법인 인감 이미지를 찍습니다. 실물 날인 시 해제.">
                <input type="checkbox" checked={stampOn} onChange={(e) => setStampOn(e.target.checked)} />
                <Stamp className="w-3.5 h-3.5 cd-text-primary" /> 직인 날인
              </label>
              <label
                className="flex items-center gap-1.5 text-[12px] cd-text"
                title="머리의 '시행일자'와 문서 끝 날짜입니다. 비워 두면 결재 완료일이 들어갑니다."
              >
                시행일
                <CdDateInput value={issueDate} onChange={setIssueDate} placeholder="자동(결재일)" style={{ width: 128 }} />
                {issueDate && (
                  <button type="button" className="cd-btn cd-text-faint text-[11px] underline" onClick={() => setIssueDate("")}>
                    자동으로
                  </button>
                )}
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-2.5">
              <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                수신
                <input
                  className="cd-input"
                  value={recipientText}
                  onChange={(e) => setRecipientText(e.target.value)}
                  placeholder="예: 전 임직원 (참조: 외부검토 담당 조직 전 인력)"
                />
              </label>
              <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                발신
                <input className="cd-input" value={senderText} onChange={(e) => setSenderText(e.target.value)} placeholder="예: 대표이사" />
              </label>
            </div>

            <label className="text-[11px] cd-text-faint flex flex-col gap-1">
              제목
              <input className="cd-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: 「○○ 규정」 제정·시행 알림" />
            </label>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] cd-text-faint">본문 — 분량에 따라 여러 쪽으로 자동 조판됩니다</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px] cd-text-faint"
                    title="'- 아 래 -' 관용구를 커서 위치에 삽입(가운데 정렬)"
                    onClick={() => insertBodyHtml('<div><br></div><div style="text-align:center">-&nbsp;&nbsp;아&nbsp;&nbsp;&nbsp;래&nbsp;&nbsp;-</div>')}
                  >
                    ＋ 아래 표기
                  </button>
                </span>
              </div>
              <div className="rounded-xl border cd-border-c overflow-hidden">
                <MailEditor ref={editorRef} onInput={() => {}} minHeightPx={340} />
              </div>
            </div>

            {/* 붙임 목록 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] cd-text-faint">붙임 (번호는 자동 부여·일렬종대 정렬)</span>
              {attachItems.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono cd-text-faint w-5 text-right">{i + 1}.</span>
                  <input
                    className="cd-input flex-1"
                    value={t}
                    placeholder="예: ○○ 규정  1부"
                    onChange={(e) => setAttachItems((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))}
                  />
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setAttachItems((prev) => prev.filter((_, xi) => xi !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint self-start" onClick={() => setAttachItems((prev) => [...prev, ""])}>
                ＋ 붙임 추가
              </button>
            </div>

            {/* 첨부서류 — 결재자·열람자가 문서 뷰어에서 함께 확인한다 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] cd-text-faint">첨부서류 — 붙임 문서 원본 등(결재 문서에 첨부되어 함께 열람)</span>
              <span className="text-[10.5px] cd-text-faint">
                결재자가 내용을 확인할 수 있는 형식만 첨부할 수 있습니다 — {ATTACHMENT_ALLOWED_TEXT}
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <label
                  className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center ${
                    dragOver ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                >
                  <Plus className="w-5 h-5 cd-text-faint" />
                  <span className="text-[12px] cd-text">{uploading ? "업로드 중..." : "파일을 끌어다 놓거나 클릭해 선택"}</span>
                  <input
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div className="rounded-xl border cd-border-c p-2.5 min-h-[104px] flex flex-col gap-1 overflow-auto">
                  {fileAttachments.length === 0 ? (
                    <p className="text-[11.5px] cd-text-faint m-auto">첨부된 파일이 없습니다.</p>
                  ) : (
                    fileAttachments.map((f, i) => (
                      <div
                        key={f.key}
                        {...attachDrag.rowProps(i)}
                        className={`flex items-center gap-2 rounded-lg border cd-border-c px-2.5 py-1.5 transition-colors ${attachDrag.rowClass(i)}`}
                        title="끌어서 첨부 순서를 바꿉니다"
                      >
                        <GripVertical className="w-3.5 h-3.5 cd-text-faint shrink-0 cursor-grab" aria-hidden />
                        <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                        <button
                          type="button"
                          className="text-[12px] cd-text truncate flex-1 text-left hover:underline"
                          title={`${f.name} — 클릭해 미리보기`}
                          onClick={() => setPreviewItem(f)}
                        >
                          {f.name}
                        </button>
                        <span className="text-[10.5px] cd-text-faint shrink-0">{(f.size / 1024 / 1024).toFixed(2)}MB</span>
                        <button
                          type="button"
                          className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                          onClick={() => setFileAttachments((prev) => prev.filter((_, xi) => xi !== i))}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 우: 결재선(공문 작성 화면 이식) */}
          <div className="cd-card rounded-3xl p-5 w-full xl:w-[320px] shrink-0 flex flex-col gap-3">
            <h3 className="font-bold cd-text text-sm flex items-center gap-2">
              <Users className="w-4 h-4 cd-text-primary" /> 결재선
              <span className="ml-auto text-[11px] font-normal cd-text-faint">기안 → 위에서 아래 순서</span>
            </h3>

            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10.5px] cd-text-faint mr-0.5">불러오기</span>
                {presets.map((p) => (
                  <span key={p.presetId} className="cd-action inline-flex items-center rounded-full border cd-border-c overflow-hidden">
                    <button type="button" className="text-[11px] px-2 py-0.5 hover:cd-tint-primary" onClick={() => applyPreset(p)} title="이 결재선 불러오기">
                      {p.name}
                    </button>
                    <button type="button" className="text-[10px] px-1 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => deletePreset(p.presetId)} title="프리셋 삭제">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {line.length === 0 && <p className="text-[12px] cd-text-faint">아래 버튼으로 합의/승인 결재자를 추가하세요.</p>}
            <div className="flex flex-col gap-1.5">
              {line.map((s, i) => (
                <div key={`${s.assigneeUserId}-${i}`} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                  <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                  <select
                    className="cd-select"
                    style={{ width: 70 }}
                    value={s.stepType}
                    onChange={(e) => setLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, stepType: e.target.value as "agree" | "approve" } : x)))}
                  >
                    <option value="agree">합의</option>
                    <option value="approve">승인</option>
                  </select>
                  <span className="text-[12.5px] cd-text truncate flex-1">
                    {s.assigneeName}
                    {s.assigneePosition ? <span className="cd-text-faint text-[11px]"> {s.assigneePosition}</span> : null}
                  </span>
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="제거" onClick={() => setLine((prev) => prev.filter((_, xi) => xi !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint flex-1" onClick={() => setOrgModal("approve")}>
                ＋ 결재자 추가
              </button>
              <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2 text-[11px] cd-text-faint flex-1 flex items-center justify-center gap-1" onClick={saveAsPreset} title="현재 결재선·참조자를 프리셋으로 저장">
                <BookmarkPlus className="w-3.5 h-3.5" /> 프리셋 저장
              </button>
            </div>

            {/* 참조/열람자 */}
            <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
              <h4 className="font-bold cd-text text-[12.5px] flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 cd-text-primary" /> 참조 · 열람
                <span className="ml-auto text-[10px] font-normal cd-text-faint">사내 참조(결재 시스템)</span>
              </h4>
              <p className="text-[11px] cd-text-faint leading-relaxed">여기에 지정한 사내 인원은 결재 문서(고시 지면)를 함께 열람합니다(선택).</p>
              {watchers.map((w, i) => (
                <div key={`${w.userId}-${i}`} className="rounded-xl border cd-border-c px-3 py-1.5 flex items-center gap-2">
                  <select
                    className="cd-select"
                    style={{ width: 66 }}
                    value={w.kind}
                    onChange={(e) => setWatchers((prev) => prev.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as "ref" | "view" } : x)))}
                  >
                    <option value="ref">참조</option>
                    <option value="view">열람</option>
                  </select>
                  <span className="text-[12px] cd-text truncate flex-1">{w.name}</span>
                  <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="제거" onClick={() => setWatchers((prev) => prev.filter((_, xi) => xi !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint" onClick={() => setOrgModal("ref")}>
                ＋ 참조/열람자 추가
              </button>
            </div>

            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("save")}
              >
                <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "임시저장"}
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => void openPreview()}
                title="현재 내용을 A4 내부고시 PDF 로 미리봅니다"
              >
                <FileText className="w-3.5 h-3.5" /> {busy === "preview" ? "생성 중..." : "미리보기"}
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("submit")}
              >
                <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
              </button>
            </div>
            <p className="text-[10.5px] cd-text-faint">상신 시 문서번호({"{연도}"}-내부고시-NNNNN호)가 확정되고, 결재 완료 문서는 문서함에서 PDF 로 열람·출력합니다.</p>
          </div>
        </div>
        </>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={() => setPreviewOpen(false)}>
          <div className="rounded-2xl bg-[color:var(--cd-card)] shadow-2xl w-full max-w-[1100px] h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center px-4 py-2.5 border-b cd-border-c">
              <h4 className="font-bold cd-text text-[13px]">내부고시 미리보기</h4>
              <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c p-1.5" onClick={() => setPreviewOpen(false)} aria-label="닫기">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-[color:var(--cd-surface)]">
              {previewUrl && busy !== "preview" ? (
                <iframe title="내부고시 미리보기" src={previewUrl} className="w-full h-full" />
              ) : (
                <div className="flex items-center justify-center h-full cd-text-faint text-sm">미리보기 생성 중...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {previewItem && <AttachmentPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}

      <OrgPickerModal
        open={orgModal != null}
        title={orgModal === "ref" ? "참조/열람자 추가 — 조직도에서 선택" : "결재자 추가 — 조직도에서 선택"}
        hint={orgModal === "ref" ? "인원을 클릭하면 참조/열람자로 추가됩니다." : "인원을 클릭하면 결재선 맨 뒤에 추가됩니다. 타입(합의/승인)은 목록에서 변경하세요."}
        onClose={() => setOrgModal(null)}
        onSelect={(emp) => {
          if (!orgModal) return;
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          const userId = emp.userId;
          if (orgModal === "ref") {
            setWatchers((prev) => (prev.some((w) => w.userId === userId) ? prev : [...prev, { userId, name: emp.name, kind: "ref" }]));
          } else {
            setLine((prev) =>
              prev.some((s) => s.assigneeUserId === userId)
                ? prev
                : [...prev, { stepType: "approve", assigneeUserId: userId, assigneeName: emp.name, assigneePosition: emp.positionName }]
            );
          }
        }}
      />
    </div>
  );
}

"use client";

// 공문 사전 검수(221) — 상신 전에 공문(안)과 첨부서류를 사내 검수자에게 보내 확인받는다.
// 검수자 선택은 결재선·참조자와 같은 조직도 트리 모달(OrgPickerModal)을 그대로 쓴다.
// 보내기 전에 작성 화면 내용을 임시저장해야 하므로(서버가 docId 로 PDF 를 렌더한다) 저장은 호출측이 맡는다.

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Send, Trash2, XCircle } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";

interface Reviewer {
  userId: string;
  name: string;
  position?: string | null;
}

interface ReviewRecord {
  reviewId: string;
  requesterName: string | null;
  reviewers: { userId: string; name: string; address: string }[];
  note: string | null;
  attachNames: string[];
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export function LetterReviewModal({
  open,
  onClose,
  /** 저장 후 docId 를 돌려준다(신규 문서면 여기서 처음 만들어진다). 실패 시 throw. */
  onSaveDoc,
  /** 참조 메일 설정과 같은 기본값(개인/회사) */
  defaultTarget,
}: {
  open: boolean;
  onClose: () => void;
  onSaveDoc: () => Promise<string>;
  defaultTarget: "personal" | "company";
}) {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<"personal" | "company">(defaultTarget);
  const [orgOpen, setOrgOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<ReviewRecord[]>([]);
  // 이력 조회용 docId — 저장을 한 번이라도 했으면 그 id 로 지난 검수 회차를 보여준다.
  const [docId, setDocId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setTarget(defaultTarget);
  }, [open, defaultTarget]);

  const loadHistory = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/letters/review?docId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.ok) setHistory(((await res.json()).reviews ?? []) as ReviewRecord[]);
    } catch {
      // 이력은 보조 정보 — 실패해도 검수 요청은 계속 가능
    }
  }, []);

  useEffect(() => {
    if (open && docId) void loadHistory(docId);
  }, [open, docId, loadHistory]);

  const submit = async () => {
    if (!reviewers.length) {
      alert("검수자를 1명 이상 선택하세요.");
      return;
    }
    setSending(true);
    try {
      // 검수본은 저장된 문서로 렌더된다 — 지금 화면 내용을 먼저 임시저장한다.
      const id = await onSaveDoc();
      setDocId(id);
      const res = await fetch("/api/letters/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: id, reviewerIds: reviewers.map((r) => r.userId), note, target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "검수 요청 발송 실패");
      alert(
        `검수 요청을 보냈습니다.\n검수자: ${(data.reviewers ?? []).map((r: { name: string }) => r.name).join(", ")}\n첨부: ${(data.attachNames ?? []).length}건`
      );
      setNote("");
      void loadHistory(id);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <CdModal
        open={open}
        onClose={onClose}
        title="사전 검수 요청"
        size="lg"
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs" onClick={onClose}>
              닫기
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              disabled={sending || reviewers.length === 0}
              onClick={submit}
            >
              <Send className="w-3.5 h-3.5" /> {sending ? "보내는 중..." : "검수 요청 보내기"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3.5">
          <p className="text-[12px] cd-text-faint leading-relaxed">
            현재 작성 중인 공문을 <b className="cd-text">임시저장</b>한 뒤, 공문(안) PDF와 첨부서류를 검수자 메일로 보냅니다.
            결재 상신·채번과는 무관하며 대외 발송도 일어나지 않습니다.
          </p>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] cd-text-faint">검수자 — 조직도에서 선택(복수 가능)</span>
            {reviewers.length === 0 ? (
              <p className="text-[12px] cd-text-faint rounded-xl border border-dashed cd-border-c px-3 py-3 text-center">
                아직 선택된 검수자가 없습니다.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {reviewers.map((r) => (
                  <div key={r.userId} className="rounded-xl border cd-border-c px-3 py-1.5 flex items-center gap-2">
                    <span className="text-[12px] cd-text truncate flex-1">
                      {r.name}
                      {r.position ? <span className="cd-text-faint"> · {r.position}</span> : null}
                    </span>
                    <button
                      type="button"
                      className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                      title="제외"
                      onClick={() => setReviewers((prev) => prev.filter((x) => x.userId !== r.userId))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint self-start"
              onClick={() => setOrgOpen(true)}
            >
              ＋ 검수자 추가
            </button>
          </div>

          <label className="flex flex-col gap-1 text-[11px] cd-text-faint">
            요청 메모(선택) — 검수자에게 함께 전달됩니다
            <textarea
              className="cd-input text-[12px] min-h-[76px]"
              placeholder="예) 준공 기성금 금액과 대금청구서 계좌를 중점적으로 봐주세요."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] cd-text-faint">
            검수 메일 받을 주소
            <select className="cd-select" value={target} onChange={(e) => setTarget(e.target.value as "personal" | "company")}>
              <option value="personal">개인 메일 주소</option>
              <option value="company">회사 메일(@koensain.app)</option>
            </select>
          </label>

          {history.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] cd-text-faint">지난 검수 요청 {history.length}건</span>
              <div className="flex flex-col gap-1.5 max-h-[190px] overflow-y-auto">
                {history.map((h, i) => (
                  <div key={h.reviewId} className="rounded-xl border cd-border-c px-3 py-2 text-[11.5px] flex items-start gap-2">
                    {h.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 cd-text-primary" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--cd-danger,#FA896B)" }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="cd-text">
                        {history.length - i}차 · {h.reviewers.map((r) => r.name).join(", ") || "수신자 없음"}
                        <span className="cd-text-faint"> · {h.createdAt.slice(0, 16).replace("T", " ")}</span>
                      </div>
                      {h.note && <div className="cd-text-faint truncate">{h.note}</div>}
                      {!h.ok && h.error && <div style={{ color: "var(--cd-danger,#FA896B)" }}>{h.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CdModal>

      <OrgPickerModal
        open={orgOpen}
        title="검수자 추가 — 조직도에서 선택"
        hint="인원을 클릭하면 검수자로 추가됩니다. 여러 명을 선택한 뒤 닫으세요."
        onClose={() => setOrgOpen(false)}
        onSelect={(emp) => {
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          const userId = emp.userId;
          setReviewers((prev) =>
            prev.some((r) => r.userId === userId) ? prev : [...prev, { userId, name: emp.name, position: emp.positionName }]
          );
        }}
      />
    </>
  );
}

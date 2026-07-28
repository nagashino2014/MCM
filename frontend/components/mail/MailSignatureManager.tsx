"use client";

// 메일 서명 관리 모달(G2-9) — 서식명 지정·복수 저장·기본 지정·본문 삽입(네이버 메일 템플릿 방식).
// 서명 본문은 MailEditor(리치)로 작성 — 표·이미지 링크·서식 가능.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, PenLine, Plus, Star, Trash2, X } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput } from "@/components/cdash/CdField";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { useCdToast } from "@/components/cdash/CdToast";
import { MailEditor } from "@/components/mail/MailEditor";
import type { MailSignature } from "@/lib/mail/signatures";

export function MailSignatureManager({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  /** "본문에 삽입" — 작성 페이지 에디터에 서명 HTML 을 넣고, 사명 표시는 제목에 반영한다. */
  onInsert: (bodyHtml: string, subjectPrefix?: string | null) => void;
}) {
  const { toast } = useCdToast();
  const [signatures, setSignatures] = useState<MailSignature[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subjectPrefix, setSubjectPrefix] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mail/signatures");
      if (r.ok) {
        const d = await r.json();
        setSignatures(Array.isArray(d.signatures) ? d.signatures : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setMode("list");
      load();
    }
  }, [open, load]);

  const startNew = () => {
    setEditId(null);
    setName("");
    setSubjectPrefix("");
    setIsDefault(signatures.length === 0); // 첫 서명은 기본으로 제안
    setMode("edit");
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = "<div><br></div>";
    }, 30);
  };

  const startEdit = (s: MailSignature) => {
    setEditId(s.signatureId);
    setName(s.name);
    setSubjectPrefix(s.subjectPrefix ?? "");
    setIsDefault(s.isDefault);
    setMode("edit");
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = s.bodyHtml || "<div><br></div>";
    }, 30);
  };

  const save = async () => {
    if (!name.trim()) {
      toast("서식명을 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/mail/signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureId: editId,
          name,
          bodyHtml: editorRef.current?.innerHTML ?? "",
          isDefault,
          subjectPrefix: subjectPrefix.trim() || null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast(String(d.error ?? "저장에 실패했습니다."), "error");
        return;
      }
      toast("서명을 저장했습니다.", "success");
      setMode("list");
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: MailSignature) => {
    if (!window.confirm(`서명 '${s.name}' 을 삭제할까요?`)) return;
    await fetch(`/api/mail/signatures?id=${encodeURIComponent(s.signatureId)}`, { method: "DELETE" });
    load();
  };

  const setAsDefault = async (s: MailSignature) => {
    await fetch("/api/mail/signatures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signatureId: s.signatureId,
        name: s.name,
        bodyHtml: s.bodyHtml,
        isDefault: true,
        subjectPrefix: s.subjectPrefix,
      }),
    });
    load();
  };

  return (
    <CdModal open={open} onClose={onClose} title="메일 서명 관리" size="xl" closeOnBackdrop={false}>
      {mode === "list" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs cd-text-faint">기본 서명은 새 메일 작성 시 본문 하단에 자동 삽입됩니다.</p>
            <CdButton size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={startNew}>
              새 서명
            </CdButton>
          </div>
          {loading ? (
            <p className="text-sm cd-text-faint py-6 text-center">불러오는 중입니다.</p>
          ) : signatures.length === 0 ? (
            <CdEmptyState title="저장된 서명이 없습니다." description="'새 서명'으로 첫 서명 서식을 만들어 보세요." />
          ) : (
            <ul className="flex flex-col gap-2">
              {signatures.map((s) => (
                <li key={s.signatureId} className="rounded-xl border cd-border-c overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b cd-border-c">
                    <span className="text-sm font-semibold cd-text">{s.name}</span>
                    {s.isDefault && <CdBadge tone="info">기본</CdBadge>}
                    {s.subjectPrefix && <span className="text-[11px] cd-text-faint">제목 앞 [{s.subjectPrefix}]</span>}
                    <div className="flex-1" />
                    <CdButton size="sm" variant="soft" icon={<Check className="w-3.5 h-3.5" />} onClick={() => { onInsert(s.bodyHtml, s.subjectPrefix); onClose(); }}>
                      본문에 삽입
                    </CdButton>
                    {!s.isDefault && (
                      <CdButton size="sm" icon={<Star className="w-3.5 h-3.5" />} onClick={() => setAsDefault(s)}>
                        기본으로
                      </CdButton>
                    )}
                    <CdButton size="sm" icon={<PenLine className="w-3.5 h-3.5" />} onClick={() => startEdit(s)}>
                      수정
                    </CdButton>
                    <CdButton size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => remove(s)}>
                      삭제
                    </CdButton>
                  </div>
                  {/* 미리보기 — 흰 배경(메일 본문 기준) */}
                  <div className="bg-white text-black px-3 py-2 text-sm max-h-36 overflow-y-auto" dangerouslySetInnerHTML={{ __html: s.bodyHtml }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-end gap-2 flex-wrap">
            <CdInput label="서식명" required value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 기본 서명, 영업용" className="flex-1 min-w-[12rem]" />
            <CdInput
              label="제목 앞 사명 표시"
              value={subjectPrefix}
              onChange={(e) => setSubjectPrefix(e.target.value)}
              placeholder="예: 한국환경안전연구원"
              hint="이 서명을 쓰면 제목 앞에 [사명] 이 자동으로 붙습니다(비우면 없음)."
              className="flex-1 min-w-[14rem]"
            />
            <label className="inline-flex items-center gap-1.5 pb-7 text-sm cd-text cursor-pointer select-none">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="w-4 h-4 accent-[var(--cd-primary)]" />
              기본 서명으로
            </label>
          </div>
          <MailEditor ref={editorRef} onInput={() => {}} />
          <div className="flex items-center gap-2">
            <CdButton variant="primary" loading={saving} icon={<Check className="w-4 h-4" />} onClick={save}>
              저장
            </CdButton>
            <CdButton icon={<X className="w-4 h-4" />} onClick={() => setMode("list")}>
              목록으로
            </CdButton>
          </div>
        </div>
      )}
    </CdModal>
  );
}

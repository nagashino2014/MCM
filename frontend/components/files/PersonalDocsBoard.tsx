"use client";

// 개인문서함(/files/personal) — 본인 할당 용량 내 자유 업로드·삭제 + 전송.
// 전송: 임직원 = 메일(작성창 첨부 삽입) / 메신저(DM 즉시 발송 — 위젯·모바일에서 확인),
//       거래처 담당자 = 메일만. 받는 사람 검색은 주소록 통합 자동완성(/api/directory/suggest).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, RefreshCw, Send, Trash2, Upload, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { useCdToast } from "@/components/cdash/CdToast";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationSnapshot, OrganizationEmployeeRow } from "@/components/admin/users/types";
import { formatBytes } from "@/lib/approval/attachments";
import "@/components/cdash/cdash.css";

interface PersonalDoc {
  documentId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  createdAt: string;
}

interface ContactSuggestion {
  name: string;
  address: string;
  kind: "employee" | "alias" | "contact";
  detail: string | null;
  title: string | null;
}

const GB = 1024 * 1024 * 1024;

export function PersonalDocsBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [docs, setDocs] = useState<PersonalDoc[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(5 * GB);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/personal-docs", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "목록을 불러오지 못했습니다.");
      setDocs(data.docs ?? []);
      setUsedBytes(Number(data.usedBytes ?? 0));
      setQuotaBytes(Number(data.quotaBytes ?? 5 * GB));
      setSelected(new Set());
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        const form = new FormData();
        for (const f of files) form.append("files", f);
        const res = await fetch("/api/personal-docs", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "업로드에 실패했습니다.");
        toast(`${(data.uploaded ?? []).length}개 파일을 업로드했습니다.`, "success");
        await load();
      } catch (err) {
        toast((err as Error).message, "error");
      } finally {
        setUploading(false);
      }
    },
    [load, toast]
  );

  const deleteSelected = async () => {
    if (!selected.size) return;
    if (!window.confirm(`선택한 ${selected.size}개 파일을 삭제할까요?`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/personal-docs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제에 실패했습니다.");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  };

  const allChecked = docs.length > 0 && docs.every((d) => selected.has(d.documentId));
  const pct = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const selectedDocs = useMemo(() => docs.filter((d) => selected.has(d.documentId)), [docs, selected]);

  return (
    <div
      className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl"
      data-theme={theme}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        upload(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      <CdPageHeader
        title="개인문서함"
        meta={`${formatBytes(usedBytes)} / ${(quotaBytes / GB).toFixed(1)}GB 사용 (${pct}%)`}
        actions={
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2" title="새로고침" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        }
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        {/* 용량 게이지 + 액션 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--cd-border)" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: pct >= 90 ? "var(--cd-danger, #FA896B)" : "var(--cd-primary)" }}
              />
            </div>
            <p className="text-[11px] cd-text-faint mt-1">
              {formatBytes(usedBytes)} 사용 · {formatBytes(Math.max(0, quotaBytes - usedBytes))} 남음
              {pct >= 90 && <span className="ml-1.5 text-[color:var(--cd-danger,#FA896B)] font-semibold">용량이 거의 찼습니다</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                upload(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <CdButton icon={<Upload className="w-4 h-4" />} loading={uploading} onClick={() => fileInputRef.current?.click()}>
              업로드
            </CdButton>
            <CdButton
              icon={<Send className="w-4 h-4" />}
              disabled={selected.size === 0}
              onClick={() => setSendOpen(true)}
            >
              전송{selected.size > 0 ? ` (${selected.size})` : ""}
            </CdButton>
            <CdButton
              icon={<Trash2 className="w-4 h-4" />}
              disabled={selected.size === 0 || deleting}
              onClick={deleteSelected}
            >
              선택 삭제
            </CdButton>
          </div>
        </div>

        {dragging && (
          <div className="rounded-2xl border-2 border-dashed cd-border-c p-8 text-center cd-text-faint text-sm">
            여기에 놓으면 업로드됩니다
          </div>
        )}

        {/* 목록 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 w-8 text-left">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(docs.map((d) => d.documentId)))}
                    aria-label="전체 선택"
                  />
                </th>
                <th className="py-2 px-2 text-left">파일명</th>
                <th className="py-2 px-2 text-left w-24">형식</th>
                <th className="py-2 px-2 text-right w-24">크기</th>
                <th className="py-2 px-2 text-left w-28">등록일</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center cd-text-faint">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
                    불러오는 중…
                  </td>
                </tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center cd-text-faint">
                    파일이 없습니다. 업로드 버튼을 누르거나 파일을 끌어다 놓으세요.
                  </td>
                </tr>
              ) : (
                docs.map((d) => {
                  const ext = d.fileName.includes(".") ? d.fileName.slice(d.fileName.lastIndexOf(".") + 1).toUpperCase() : "-";
                  return (
                    <tr
                      key={d.documentId}
                      className="border-b cd-border-c cd-row-hover cursor-pointer"
                      onClick={() => window.open(`/api/personal-docs/open?id=${encodeURIComponent(d.documentId)}`, "_blank", "noopener")}
                      title="클릭하면 파일을 엽니다"
                    >
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(d.documentId)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(d.documentId)) next.delete(d.documentId);
                              else next.add(d.documentId);
                              return next;
                            })
                          }
                          aria-label={`${d.fileName} 선택`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 cd-text-faint shrink-0" />
                          <span className="truncate font-medium" style={{ maxWidth: 420 }}>{d.fileName}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-xs cd-text-faint">{ext}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{formatBytes(d.byteSize)}</td>
                      <td className="py-2 px-2 tabular-nums">{d.createdAt.slice(0, 10)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SendModal open={sendOpen} onClose={() => setSendOpen(false)} docs={selectedDocs} />
    </div>
  );
}

/**
 * 전송 모달 — 임직원은 조직도 트리(복수 선택), 거래처 담당자는 자동완성 검색(복수 누적).
 * 임직원 = 메일(작성창 첨부 삽입) / 메신저(DM 즉시 발송) 선택, 거래처 = 메일 고정.
 */
function SendModal({ open, onClose, docs }: { open: boolean; onClose: () => void; docs: PersonalDoc[] }) {
  const { toast } = useCdToast();
  const [targetKind, setTargetKind] = useState<"employee" | "contact">("employee");
  const [method, setMethod] = useState<"mail" | "chat">("mail");
  const [sending, setSending] = useState(false);
  // 임직원(조직도 트리 복수 선택)
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [employees, setEmployees] = useState<OrganizationEmployeeRow[]>([]);
  // 거래처 담당자(자동완성 복수 누적)
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ContactSuggestion[]>([]);
  const [contacts, setContacts] = useState<ContactSuggestion[]>([]);

  useEffect(() => {
    if (!open) {
      setTargetKind("employee");
      setMethod("mail");
      setEmployees([]);
      setQ("");
      setItems([]);
      setContacts([]);
      return;
    }
    fetch("/api/sales/org", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setSnapshot(data as OrganizationSnapshot))
      .catch(() => {});
  }, [open]);

  // 거래처 자동완성 — kind=contact 만.
  useEffect(() => {
    const query = q.trim();
    if (targetKind !== "contact" || query.length < 1) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/directory/suggest?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const list = (Array.isArray(data.items) ? data.items : []) as ContactSuggestion[];
        setItems(list.filter((s) => s.kind === "contact"));
      } catch {
        /* noop */
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, targetKind]);

  // 거래처 담당자는 메일만.
  useEffect(() => {
    if (targetKind === "contact") setMethod("mail");
  }, [targetKind]);

  const toggleEmployee = (emp: OrganizationEmployeeRow) => {
    setEmployees((prev) =>
      prev.some((e) => e.employeeId === emp.employeeId)
        ? prev.filter((e) => e.employeeId !== emp.employeeId)
        : [...prev, emp]
    );
  };

  const totalBytes = docs.reduce((s, d) => s + d.byteSize, 0);
  const mailOverLimit = method === "mail" && totalBytes > 20 * 1024 * 1024;
  const targetCount = targetKind === "employee" ? employees.length : contacts.length;

  const mailToken = (name: string, title: string | null, address: string) =>
    `${name}${title ? ` ${title}` : ""} <${address}>`;

  const send = async () => {
    if (targetCount === 0) {
      toast("받는 사람을 선택해 주세요.", "warn");
      return;
    }
    if (method === "mail") {
      // 작성창에 첨부 삽입 — ?attach={docId,...} 프리필로 새 탭. 수신자는 콤마 조인.
      const tokens =
        targetKind === "employee"
          ? employees.filter((e) => e.email).map((e) => mailToken(e.name, e.positionName, e.email as string))
          : contacts.map((c) => mailToken(c.name, c.title, c.address));
      const skipped = targetKind === "employee" ? employees.length - tokens.length : 0;
      if (!tokens.length) {
        toast("선택한 인원 중 메일 주소가 있는 사람이 없습니다.", "warn");
        return;
      }
      if (skipped > 0) toast(`메일 주소가 없는 ${skipped}명은 수신자에서 제외했습니다.`, "warn");
      const attach = docs.map((d) => d.documentId).join(",");
      window.open(
        `/mail/compose?to=${encodeURIComponent(tokens.join(", "))}&attach=${encodeURIComponent(attach)}`,
        "_blank",
        "noopener"
      );
      onClose();
      return;
    }
    // 메신저 — 계정(userId) 보유 임직원에게만 발송 가능.
    const targetUserIds = employees.filter((e) => e.userId).map((e) => e.userId as string);
    const skipped = employees.length - targetUserIds.length;
    if (!targetUserIds.length) {
      toast("선택한 인원 중 메신저 계정이 있는 사람이 없습니다.", "warn");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/personal-docs/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docIds: docs.map((d) => d.documentId), targetUserIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "전송에 실패했습니다.");
      toast(
        `${data.targets}명에게 ${docs.length}개 파일을 보냈습니다.${skipped > 0 ? ` (계정 없는 ${skipped}명 제외)` : ""}`,
        "success"
      );
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <CdModal open={open} onClose={onClose} title="파일 전송" size="xl" closeOnBackdrop={false}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(16rem,1fr)_24rem] gap-4 h-[30rem]">
        {/* 좌 — 받는 사람 선택 */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="flex items-center gap-1.5">
            <button type="button" className="cd-chip" data-active={targetKind === "employee"} onClick={() => setTargetKind("employee")}>
              임직원 (조직도)
            </button>
            <button type="button" className="cd-chip" data-active={targetKind === "contact"} onClick={() => setTargetKind("contact")}>
              거래처 담당자
            </button>
          </div>
          {targetKind === "employee" ? (
            <div className="rounded-xl border cd-border-c overflow-hidden flex-1 min-h-0">
              <OrganizationTree
                snapshot={snapshot}
                onSelectEmployee={toggleEmployee}
                employeeCheckbox
                checkedEmployeeIds={employees.map((e) => e.employeeId)}
                embedded
                fillHeight
                hideHeader
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <input
                className="cd-input"
                placeholder="담당자명·업체명 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {items.length > 0 && (
                <div className="rounded-xl border cd-border-c overflow-hidden max-h-48 overflow-y-auto">
                  {items.map((s) => (
                    <button
                      key={s.address}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm cd-row-hover flex items-center gap-2"
                      onClick={() => {
                        setContacts((prev) => (prev.some((c) => c.address === s.address) ? prev : [...prev, s]));
                        setQ("");
                        setItems([]);
                      }}
                    >
                      <span className="font-medium">{s.name}</span>
                      {s.detail && <span className="cd-text-faint text-xs truncate">{s.detail}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우 — 파일 요약·선택된 대상·방식·실행 */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <div className="rounded-xl border cd-border-c p-2.5 text-xs flex flex-col gap-1 max-h-28 overflow-y-auto shrink-0">
            {docs.map((d) => (
              <div key={d.documentId} className="flex items-center justify-between gap-2">
                <span className="truncate">{d.fileName}</span>
                <span className="cd-text-faint shrink-0">{formatBytes(d.byteSize)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 border-t cd-border-c pt-1 mt-0.5 font-semibold">
              <span>총 {docs.length}개</span>
              <span>{formatBytes(totalBytes)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="cd-label">받는 사람 ({targetCount}명)</p>
            <div className="flex flex-wrap gap-1.5 min-h-8">
              {targetKind === "employee"
                ? employees.map((e) => (
                    <span key={e.employeeId} className="cd-chip cd-chip-sm inline-flex items-center gap-1">
                      {e.name}
                      {e.positionName && <span className="opacity-70">{e.positionName}</span>}
                      <button type="button" onClick={() => toggleEmployee(e)} aria-label={`${e.name} 제외`}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))
                : contacts.map((c) => (
                    <span key={c.address} className="cd-chip cd-chip-sm inline-flex items-center gap-1">
                      {c.name}
                      {c.detail && <span className="opacity-70">{c.detail}</span>}
                      <button
                        type="button"
                        onClick={() => setContacts((prev) => prev.filter((x) => x.address !== c.address))}
                        aria-label={`${c.name} 제외`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
              {targetCount === 0 && (
                <span className="text-xs cd-text-faint">
                  {targetKind === "employee" ? "조직도에서 인원을 선택하세요 (복수 선택 가능)" : "검색해서 담당자를 추가하세요"}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="cd-label">전송 방식</p>
            <div className="flex items-center gap-1.5">
              <button type="button" className="cd-chip" data-active={method === "mail"} onClick={() => setMethod("mail")}>
                메일 (작성창에 첨부)
              </button>
              <button
                type="button"
                className="cd-chip disabled:opacity-40"
                data-active={method === "chat"}
                disabled={targetKind === "contact"}
                onClick={() => setMethod("chat")}
                title={targetKind === "contact" ? "거래처 담당자는 메일로만 전송할 수 있습니다" : undefined}
              >
                메신저 (대화방으로 발송)
              </button>
            </div>
            {targetKind === "contact" && <p className="text-[10.5px] cd-text-faint">거래처 담당자는 메일로만 전송할 수 있습니다.</p>}
            {mailOverLimit && (
              <p className="text-[10.5px] text-[color:var(--cd-danger,#FA896B)]">
                메일 첨부 총량(20MB)을 초과합니다 — 메일 작성창에서 일부 파일이 제외될 수 있습니다.
              </p>
            )}
          </div>

          <div className="mt-auto flex items-center justify-end gap-2">
            <CdButton onClick={onClose}>취소</CdButton>
            <CdButton variant="primary" loading={sending} icon={<Send className="w-4 h-4" />} onClick={send}>
              {method === "mail" ? "메일 작성창 열기" : "메신저로 보내기"}
            </CdButton>
          </div>
        </div>
      </div>
    </CdModal>
  );
}

"use client";

// 별칭·배포리스트 관리(G5, 메일 P4·관리자 전용) — 메일 설정 화면의 관리자 섹션에서 사용.
// sales@ 같은 대표 주소(별칭)나 all@ 같은 배포리스트를 만들고 수신 인원을 지정한다.
// 라우팅(fan-out)은 inbound 기구현 — 여기서 만든 별칭은 즉시 수신에 반영된다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AtSign, Pencil, Plus, Trash2 } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput, CdSelect } from "@/components/cdash/CdField";
import { CdModal } from "@/components/cdash/CdModal";
import { useCdToast } from "@/components/cdash/CdToast";
import type { MailAlias } from "@/lib/mail/aliases";

interface MailboxOption {
  mailboxId: string;
  address: string;
  displayName: string;
}

export function MailAliasManager({ mailboxes }: { mailboxes: MailboxOption[] }) {
  const { toast } = useCdToast();
  const [aliases, setAliases] = useState<MailAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MailAlias | "new" | null>(null);

  const domain = mailboxes[0]?.address?.split("@")[1] ?? "koensain.app";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/mail/aliases", { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setAliases(Array.isArray(d.aliases) ? d.aliases : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (a: MailAlias) => {
    const r = await fetch("/api/mail/aliases", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aliasId: a.aliasId, active: !a.active }),
    });
    if (r.ok) load();
    else toast("변경에 실패했습니다.", "error");
  };

  const remove = async (a: MailAlias) => {
    if (!window.confirm(`'${a.address}' 별칭을 삭제할까요? 이 주소로 오는 메일은 더 이상 배달되지 않습니다.`)) return;
    const r = await fetch(`/api/mail/aliases?aliasId=${encodeURIComponent(a.aliasId)}`, { method: "DELETE" });
    if (r.ok) {
      toast("별칭을 삭제했습니다.", "success");
      load();
    } else toast("삭제에 실패했습니다.", "error");
  };

  return (
    <div className="flex flex-col gap-2">
      {loading ? (
        <p className="text-xs cd-text-faint">불러오는 중입니다.</p>
      ) : aliases.length === 0 ? (
        <p className="text-xs cd-text-faint">
          등록된 별칭이 없습니다. sales@{domain} 같은 대표 주소나 전체 공지용 배포리스트를 만들어 보세요.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {aliases.map((a) => (
            <div key={a.aliasId} className={`rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2 ${a.active ? "" : "opacity-55"}`}>
              <AtSign className="w-3.5 h-3.5 cd-text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold cd-text truncate">
                  {a.address}
                  <span className="ml-1.5 text-[10px] font-normal rounded-full px-1.5 py-0.5 cd-tint-primary align-middle">
                    {a.kind === "list" ? "배포리스트" : "별칭"}
                  </span>
                  {!a.active && <span className="ml-1 text-[10px] cd-text-faint">(비활성)</span>}
                </p>
                <p className="text-[11px] cd-text-faint truncate">
                  {a.targets.length === 0 ? "수신자 없음 — 배달되지 않습니다" : a.targets.map((t) => t.displayName).join(", ")}
                </p>
              </div>
              <button type="button" className="cd-btn cd-btn-soft rounded-lg px-2 py-1 text-[11px]" onClick={() => toggleActive(a)}>
                {a.active ? "비활성화" : "활성화"}
              </button>
              <button type="button" className="cd-btn cd-btn-soft rounded-lg p-1.5" title="수정" onClick={() => setEditing(a)}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg p-1.5 cd-error-text hover:cd-error-bg"
                title="삭제"
                onClick={() => remove(a)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div>
        <CdButton variant="soft" icon={<Plus className="w-4 h-4" />} onClick={() => setEditing("new")}>
          별칭 추가
        </CdButton>
      </div>

      {editing && (
        <AliasEditModal
          alias={editing === "new" ? null : editing}
          domain={domain}
          mailboxes={mailboxes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AliasEditModal({
  alias,
  domain,
  mailboxes,
  onClose,
  onSaved,
}: {
  alias: MailAlias | null;
  domain: string;
  mailboxes: MailboxOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useCdToast();
  const [local, setLocal] = useState(alias?.aliasLocal ?? "");
  const [kind, setKind] = useState<"alias" | "list">(alias?.kind ?? "alias");
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set(alias?.targets.map((t) => t.mailboxId) ?? []));
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const filteredBoxes = useMemo(() => {
    const s = filter.trim().toLowerCase();
    if (!s) return mailboxes;
    return mailboxes.filter((m) => m.address.toLowerCase().includes(s) || m.displayName.toLowerCase().includes(s));
  }, [mailboxes, filter]);

  const toggle = (id: string) =>
    setTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (!local.trim()) {
      toast("별칭 아이디를 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const body = { aliasLocal: local, kind, targetMailboxIds: [...targetIds] };
      const r = await fetch("/api/mail/aliases", {
        method: alias ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alias ? { aliasId: alias.aliasId, ...body } : body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        toast(alias ? "별칭을 수정했습니다." : "별칭을 만들었습니다.", "success");
        onSaved();
      } else {
        toast(d?.error ?? "저장에 실패했습니다.", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <CdModal
      open
      onClose={onClose}
      title={alias ? "별칭 수정" : "별칭 추가"}
      size="md"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={save}>
            저장
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-1.5">
          <CdInput
            label="별칭 아이디"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="sales, hr, all ..."
            hint="영문 소문자·숫자·._- 만 사용됩니다."
            className="flex-1"
          />
          <span className="text-sm cd-text-faint pb-6">@{domain}</span>
        </div>
        <CdSelect label="종류" value={kind} onChange={(e) => setKind(e.target.value as "alias" | "list")}>
          <option value="alias">별칭 — 대표 주소(예: sales@ → 담당 소수)</option>
          <option value="list">배포리스트 — 다수 수신(예: all@ → 전 직원)</option>
        </CdSelect>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold cd-text">
              수신자 <span className="cd-text-primary">{targetIds.size}명</span>
            </span>
            <input
              className="cd-input ml-auto"
              style={{ width: 180 }}
              placeholder="이름·주소 검색"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border cd-border-c">
            {filteredBoxes.map((m) => (
              <label key={m.mailboxId} className="flex items-center gap-2 px-3 py-1.5 border-b cd-border-c last:border-b-0 cursor-pointer hover:bg-[color:var(--cd-surface)]">
                <input type="checkbox" checked={targetIds.has(m.mailboxId)} onChange={() => toggle(m.mailboxId)} />
                <span className="text-[12.5px] cd-text">{m.displayName}</span>
                <span className="text-[11px] cd-text-faint ml-auto">{m.address}</span>
              </label>
            ))}
            {filteredBoxes.length === 0 && <p className="text-xs cd-text-faint p-3">검색 결과가 없습니다.</p>}
          </div>
        </div>
      </div>
    </CdModal>
  );
}

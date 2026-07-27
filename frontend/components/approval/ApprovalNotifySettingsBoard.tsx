"use client";

// 전자결재 알림 설정(AX-P0, admin) — 이벤트별 이메일(SES)·알림톡(솔라피) 채널 on/off.
// remind 이벤트는 리마인드 대기시간(시간)도 편집(AX-P1 배치가 사용).
// 설계: docs/e-approval-differentiation-blueprint.md §9-1.

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface NotifySetting {
  event: string;
  emailEnabled: boolean;
  alimtalkEnabled: boolean;
  remindAfterHours: number | null;
}

const EVENT_LABEL: Record<string, { title: string; desc: string }> = {
  step_pending: { title: "결재 요청(내 차례)", desc: "결재 차례가 도래한 결재자에게 발송" },
  delegated: { title: "대결 위임", desc: "휴가 중 결재자를 대신하는 대결자에게 발송" },
  approved: { title: "최종 승인", desc: "기안자에게 승인 완료를 통보" },
  rejected: { title: "반려", desc: "기안자에게 반려 사유와 함께 통보" },
  remind: { title: "미결재 리마인드", desc: "지정 시간 이상 대기 중인 결재를 재알림(배치)" },
};

export function ApprovalNotifySettingsBoard() {
  const { theme } = useCdashTheme();
  const [rows, setRows] = useState<NotifySetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/approval/notify-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.settings)) setRows(d.settings);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (event: string, patch: Partial<NotifySetting>) =>
    setRows((prev) => prev.map((r) => (r.event === event ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/approval/notify-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setRows(data.settings ?? rows);
      setMsg("저장되었습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<BellRing className="w-5 h-5" />}
        eyebrow="Approval · Settings"
        title="결재 알림 설정"
        subtitle="결재 이벤트별로 이메일·카카오 알림톡 발송 여부를 설정합니다. 채널 자격증명은 서버 환경변수로 관리됩니다."
        actions={
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={saving || loading} onClick={save}>
            {saving ? "저장 중..." : "저장"}
          </button>
        }
      />

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">이벤트</th>
                  <th className="py-1.5 pr-3 font-semibold text-center">이메일</th>
                  <th className="py-1.5 pr-3 font-semibold text-center">알림톡</th>
                  <th className="py-1.5 font-semibold">비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const label = EVENT_LABEL[r.event] ?? { title: r.event, desc: "" };
                  return (
                    <tr key={r.event} className="border-t cd-border-c">
                      <td className="py-2.5 pr-3">
                        <p className="cd-text font-semibold">{label.title}</p>
                        <p className="text-[10.5px] cd-text-faint">{label.desc}</p>
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        <input type="checkbox" checked={r.emailEnabled} onChange={(e) => update(r.event, { emailEnabled: e.target.checked })} />
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        <input type="checkbox" checked={r.alimtalkEnabled} onChange={(e) => update(r.event, { alimtalkEnabled: e.target.checked })} />
                      </td>
                      <td className="py-2.5">
                        {r.event === "remind" ? (
                          <span className="flex items-center gap-1.5 text-[11.5px] cd-text-faint">
                            대기
                            <input
                              type="number"
                              min={1}
                              className="cd-input"
                              style={{ width: 64 }}
                              value={r.remindAfterHours ?? 24}
                              onChange={(e) => update(r.event, { remindAfterHours: Number(e.target.value) || 24 })}
                            />
                            시간 경과 시
                          </span>
                        ) : (
                          <span className="cd-text-faint">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {msg && <p className="text-[12px] cd-text-faint">{msg}</p>}
        <p className="text-[10.5px] cd-text-faint">
          알림톡은 솔라피 발신프로필·승인 템플릿(SOLAPI_*) 등록, 이메일은 SES 발신주소(BID_NOTIFY_EMAIL_FROM) 설정이 있어야 실제 발송됩니다. 미설정 채널은 자동 건너뜁니다.
        </p>
      </div>
    </div>
  );
}

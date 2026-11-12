"use client";

// 새 메일 PC 알림 켜기·끄기(직원 개선 요청 11, 2026-11-12) — 이 브라우저 단위. 로직은 lib/mail/desktop-notify.ts.
// 알림 권한 요청은 여기 스위치를 켤 때만 한다(페이지 진입 즉시 요청하지 않음).

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import {
  disableMailNotify,
  enableMailNotify,
  mailNotifyPermission,
  mailNotifySwitchValue,
  showTestMailNotify,
  type MailNotifyPermission,
} from "@/lib/mail/desktop-notify";

export function MailDesktopNotifySection() {
  const { toast } = useCdToast();
  const [perm, setPerm] = useState<MailNotifyPermission>("default");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // localStorage·Notification 은 브라우저에만 있으므로 마운트 뒤에 읽는다.
  useEffect(() => {
    setPerm(mailNotifyPermission());
    setOn(mailNotifySwitchValue());
  }, []);

  const toggle = async (next: boolean) => {
    if (!next) {
      disableMailNotify();
      setOn(false);
      toast("새 메일 PC 알림을 껐습니다.", "info");
      return;
    }
    setBusy(true);
    try {
      const p = await enableMailNotify();
      setPerm(p);
      if (p === "granted") {
        setOn(true);
        toast("새 메일 PC 알림을 켰습니다. 이 브라우저에 적용됩니다.", "success");
      } else if (p === "denied") {
        toast("브라우저에서 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 알림을 허용해 주세요.", "warn");
      } else if (p === "unsupported") {
        toast("이 브라우저는 알림을 지원하지 않습니다.", "warn");
      }
    } finally {
      setBusy(false);
    }
  };

  const active = on && perm === "granted";
  const status =
    perm === "unsupported"
      ? "이 브라우저는 알림을 지원하지 않습니다."
      : perm === "denied"
        ? "브라우저에서 이 사이트의 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 알림을 허용한 뒤 다시 켜 주세요."
        : active
          ? "켜짐 — 이 앱 탭이 열려 있으면(최소화·다른 탭 포함) 새 메일이 올 때 1분 안에 알림이 뜹니다."
          : "꺼짐";

  return (
    <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-3">
      <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
        <BellRing className="w-4 h-4" /> PC 알림
        <CdHelp topic="mail.desktop-notify" />
      </h3>
      <CdCheckbox
        label="새 메일이 오면 이 PC에 알림 띄우기"
        checked={active}
        disabled={busy || perm === "unsupported"}
        onChange={(e) => void toggle(e.target.checked)}
      />
      <p className="text-xs cd-text-faint">{status}</p>
      {active && (
        <div>
          <CdButton
            variant="soft"
            size="sm"
            icon={<BellRing className="w-4 h-4" />}
            onClick={() => {
              if (!showTestMailNotify()) toast("알림 권한이 없습니다.", "warn");
            }}
          >
            시험 알림
          </CdButton>
        </div>
      )}
    </section>
  );
}

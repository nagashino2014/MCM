"use client";

// PC 알림 켜기·끄기(2026-11-12, 메일·전자결재·메신저) — 이 브라우저 단위. 로직은 lib/notify/pc-notify-client.ts.
// 메일 설정 화면과 상단 계정 메뉴의 [PC 알림] 창이 같은 칸을 쓴다.
// 알림 권한 요청은 여기 스위치를 켤 때만 한다(페이지 진입 즉시 요청하지 않음).

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import {
  disablePcNotify,
  enablePcNotify,
  pcNotifyKinds,
  pcNotifyPermission,
  pcNotifySwitchValue,
  pcNotifyYieldToWidget,
  setPcNotifyKind,
  setPcNotifyYieldToWidget,
  showTestPcNotify,
  type PcNotifyKind,
  type PcNotifyPermission,
} from "@/lib/notify/pc-notify-client";

const KIND_LABEL: Record<PcNotifyKind, string> = {
  mail: "새 메일",
  approval: "전자결재 — 내 차례가 된 결재·합의, 내 문서의 완료·반려",
  chat: "메신저 새 메시지",
};

/** bare = 테두리·제목 없이(계정 메뉴의 창 안에서). */
export function PcNotifySection({ bare = false }: { bare?: boolean }) {
  const { toast } = useCdToast();
  const [perm, setPerm] = useState<PcNotifyPermission>("default");
  const [on, setOn] = useState(false);
  const [kinds, setKinds] = useState<Record<PcNotifyKind, boolean>>({ mail: true, approval: true, chat: true });
  const [yieldWidget, setYieldWidget] = useState(true);
  const [busy, setBusy] = useState(false);

  // localStorage·Notification 은 브라우저에만 있으므로 마운트 뒤에 읽는다.
  useEffect(() => {
    setPerm(pcNotifyPermission());
    setOn(pcNotifySwitchValue());
    setKinds(pcNotifyKinds());
    setYieldWidget(pcNotifyYieldToWidget());
  }, []);

  const toggle = async (next: boolean) => {
    if (!next) {
      disablePcNotify();
      setOn(false);
      toast("PC 알림을 껐습니다.", "info");
      return;
    }
    setBusy(true);
    try {
      const p = await enablePcNotify();
      setPerm(p);
      if (p === "granted") {
        setOn(true);
        toast("PC 알림을 켰습니다. 이 브라우저에 적용됩니다.", "success");
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
          ? "켜짐 — 이 앱 탭이 열려 있으면(최소화·다른 탭 포함) 화면 오른쪽 아래에 알림이 뜹니다."
          : "꺼짐 — PC 위젯을 쓰면 위젯이 따로 알려 줍니다.";

  const body = (
    <>
      <CdCheckbox
        label="새 소식이 오면 이 PC에 알림 띄우기"
        checked={active}
        disabled={busy || perm === "unsupported"}
        onChange={(e) => void toggle(e.target.checked)}
      />
      <p className="cd-hint">{status}</p>
      {active && (
        <div className="flex flex-col gap-1.5 pl-6">
          {(Object.keys(KIND_LABEL) as PcNotifyKind[]).map((k) => (
            <CdCheckbox
              key={k}
              label={KIND_LABEL[k]}
              checked={kinds[k]}
              onChange={(e) => {
                setPcNotifyKind(k, e.target.checked);
                setKinds(pcNotifyKinds());
              }}
            />
          ))}
          <CdCheckbox
            label="PC 위젯이 켜져 있으면 위젯에만 알리기"
            checked={yieldWidget}
            onChange={(e) => {
              setPcNotifyYieldToWidget(e.target.checked);
              setYieldWidget(e.target.checked);
            }}
          />
          <div className="pt-1">
            <CdButton
              variant="soft"
              size="sm"
              icon={<BellRing className="w-4 h-4" />}
              onClick={() => {
                if (!showTestPcNotify()) toast("알림 권한이 없습니다.", "warn");
              }}
            >
              시험 알림
            </CdButton>
          </div>
        </div>
      )}
    </>
  );

  if (bare) return <div className="flex flex-col gap-3">{body}</div>;
  return (
    <section className="rounded-xl border cd-border-c p-4 flex flex-col gap-3">
      <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
        <BellRing className="w-4 h-4" /> PC 알림
        <CdHelp topic="mail.desktop-notify" />
      </h3>
      {body}
    </section>
  );
}

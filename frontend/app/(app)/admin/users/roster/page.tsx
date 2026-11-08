"use client";

import { useSession } from "next-auth/react";
import { TableProperties } from "lucide-react";
import { hasAnyPerm, permsOf } from "@/lib/auth/perms";
import { ACCOUNT_ADMIN_KEYS } from "@/config/menu-permissions";
import { AccessDenied } from "@/components/auth/AccessDenied";
import EmployeeRosterTable from "@/components/admin/users/EmployeeRosterTable";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";

export default function EmployeeRosterPage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const { theme } = useCdashTheme();
  const { data: session, status: sessionStatus } = useSession();
  // useToast() 의 객체는 알림마다 새로 만들어진다 — 안정된 show 만 넘긴다.
  const { show: showToast } = useToast();

  if (sessionStatus === "loading") {
    return <div className="p-8 cd-text-faint text-sm">세션 확인 중…</div>;
  }
  if (!hasAnyPerm(permsOf(session?.user), ACCOUNT_ADMIN_KEYS)) {
    return <AccessDenied requiredKeys={ACCOUNT_ADMIN_KEYS} />;
  }

  return (
    <div
      className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full xl:h-[calc(100vh-120px)]"
      data-theme={theme}
    >
      <CdPageHeader
        icon={<TableProperties className="w-5 h-5" />}
        eyebrow="시스템"
        title="직원 일람표"
        help="직원별 직위·연령·학력·경력·보유 자격증·연봉을 한 사람 한 줄로 봅니다. 값은 사용자 등록의 인사카드와 근로계약에서 가져옵니다."
      />
      <EmployeeRosterTable toast={showToast} />
    </div>
  );
}

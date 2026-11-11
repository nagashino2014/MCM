import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** 회사소개서 하위 화면 → 회사소개서 메인으로 돌아가기(사용자 지시 2026-11-11) — 스튜디오 머리의 같은 버튼 모양 */
export function CatalogBackLink() {
  return (
    <Link href="/sales/catalog" className="cd-btn cd-btn-ghost cd-btn-sm cd-action">
      <ArrowLeft className="w-3.5 h-3.5" /> 회사소개서
    </Link>
  );
}

import { redirect } from "next/navigation";

// 내 휴가·내 근태를 /approval/my-hr 한 화면으로 통합(2026-08-31) — 옛 경로는 리다이렉트만 남긴다.
export default function MyLeavePage() {
  redirect("/approval/my-hr");
}

import { redirect } from "next/navigation";

// 부서장 머지는 부서장 감독 메뉴(Merging 대상)로 통합되었다.
export default function MergePage() {
  redirect("/work-plan/oversight");
}

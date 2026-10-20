import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 할 일 상세 — 2026-10-20 사용자 요청으로 다시 목록 위 우측 드로어(/todo?item=)로 연다. 캘린더·알림함·위젯·홈의 /todo/<id> 링크 호환.
export default async function TodoItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  redirect(`/todo?item=${encodeURIComponent(decodeURIComponent(itemId))}`);
}

import { TodoDetailPage } from "@/components/todo/TodoDetailPage";

export const dynamic = "force-dynamic";

// 할 일 상세(§25-4) — 우측 드로어 대신 별도 페이지. 목록·보드·캘린더·알림함·위젯의 열기 경로가 전부 여기로 온다.
export default async function TodoItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <TodoDetailPage itemId={decodeURIComponent(itemId)} />;
}

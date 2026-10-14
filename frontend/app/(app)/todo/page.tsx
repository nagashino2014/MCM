import { Suspense } from "react";
import { TodoBoardPage } from "@/components/todo/TodoBoardPage";

export const dynamic = "force-dynamic";

// 할 일 · 칸반(P1). 본문은 components/todo/TodoBoardPage(useSearchParams 사용 → Suspense 경계).
export default function TodoPage() {
  return (
    <Suspense fallback={null}>
      <TodoBoardPage />
    </Suspense>
  );
}

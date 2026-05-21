import { Briefcase } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SalesPage() {
  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-primary" />
            영업/마케팅
          </h1>
          <p className="text-stone-600 text-base max-w-3xl">
            수집된 사업장 리스트를 기반으로 한 영업 파이프라인과 마케팅 캠페인 관리 화면입니다.
            현재는 라운드 1 범위 외이며 다음 라운드에서 구현 예정입니다.
          </p>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>
      <EmptyState
        icon={Briefcase}
        title="다음 라운드에서 구현 예정"
        description="영업 파이프라인 (리드 → 컨택 → 제안 → 계약), 캠페인, 활동 로그 등이 포함될 예정입니다."
      />
    </div>
  );
}

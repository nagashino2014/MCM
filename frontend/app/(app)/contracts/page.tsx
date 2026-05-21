import { FileSignature } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ContractsPage() {
  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
            <FileSignature className="w-7 h-7 text-primary" />
            계약
          </h1>
          <p className="text-stone-600 text-base max-w-3xl">
            통합허가 대상사업장과의 계약 진행/만료 현황을 관리하는 화면입니다.
            현재는 라운드 1 범위 외이며 다음 라운드에서 구현 예정입니다.
          </p>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>
      <EmptyState
        icon={FileSignature}
        title="다음 라운드에서 구현 예정"
        description="계약 데이터 모델은 facilities를 외래키로 참조하며, 계약 단계 / 금액 / 만료 알림 / 첨부 문서 관리를 제공할 예정입니다."
      />
    </div>
  );
}

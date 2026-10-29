import { Suspense } from "react";
import { CatalogHomeBoard } from "@/components/sales/catalog/CatalogHomeBoard";

// ?doc= 로 문서를 고르므로(useSearchParams) Suspense 경계가 필요하다
export default function SalesCatalogPage() {
  return (
    <div className="p-2 h-full">
      <Suspense fallback={null}>
        <CatalogHomeBoard />
      </Suspense>
    </div>
  );
}

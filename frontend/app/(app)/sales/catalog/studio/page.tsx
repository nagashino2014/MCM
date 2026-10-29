import { Suspense } from "react";
import { CatalogStudioPage } from "@/components/sales/catalog/studio/CatalogStudioPage";

// ?doc= 로 문서를 고르므로(useSearchParams) Suspense 경계가 필요하다
export default function SalesCatalogStudioPage() {
  return (
    <div className="p-2 h-full">
      <Suspense fallback={null}>
        <CatalogStudioPage />
      </Suspense>
    </div>
  );
}

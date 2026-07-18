import { Suspense } from "react";
import { BidPackageBoard } from "@/components/sales/bid/BidPackageBoard";

export default function BidPackagePage() {
  return (
    <div className="p-2 h-full">
      <Suspense fallback={null}>
        <BidPackageBoard />
      </Suspense>
    </div>
  );
}

"use client";

import { Suspense } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import { PurchaseContractsBoard } from "@/components/contracts/purchase/PurchaseContractsBoard";

/** 매입 계약 관리(331) — 원장·상세·신규 입력은 components/contracts/purchase/* 에 나눠 둔다. */
export default function PurchaseContractsPage() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <PurchaseContractsBoard />
      </Suspense>
    </ToastProvider>
  );
}

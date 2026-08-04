/**
 * 예약 자산 공용 타입·상수 — 서버 스토어(store.ts)와 클라이언트 화면이 함께 쓴다.
 * (store.ts 는 node:crypto 를 쓰는 서버 전용 모듈이라 클라이언트에서 직접 import 금지)
 */

export type AssetKind = "vehicle" | "room" | "etc";

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  vehicle: "법인차량",
  room: "회의실",
  etc: "기타",
};

/** 차량 소유 유형(129) — 장기 렌트 / 법인 소유 / 리스. */
export type VehicleOwnership = "rent" | "owned" | "lease";

export const VEHICLE_OWNERSHIP_LABELS: Record<VehicleOwnership, string> = {
  rent: "장기 렌트",
  owned: "법인 소유",
  lease: "리스",
};

/** 법인 소유 차량의 소유자 자동 입력값. */
export const COMPANY_OWNER_NAME = "(주)한국환경안전연구원";

export interface ReservableAsset {
  assetId: string;
  kind: AssetKind;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /* ── 차량 전용(129) — 회의실·기타는 전부 null ── */
  /** 차량번호(예: 12가3456) */
  plateNo: string | null;
  ownership: VehicleOwnership | null;
  /** 소유자 — owned: 법인명 자동, rent/lease: 렌터카·리스사 수동 입력 */
  ownerName: string | null;
  /** 취득(계약)일 YYYY-MM-DD */
  acquiredAt: string | null;
  /** 계약기간(개월) — rent/lease 전용 */
  contractMonths: number | null;
  /** 반납(매각)일 YYYY-MM-DD */
  returnedAt: string | null;
  /** 취득 가격(원) — owned 전용 */
  acquisitionPrice: number | null;
  /** 월 렌트(리스)료(원) — rent/lease 전용 */
  monthlyFee: number | null;
  /** 계약서 PDF S3 키·원본 파일명 */
  contractDocKey: string | null;
  contractDocName: string | null;
  /** 차량 등록증 PDF S3 키·원본 파일명 */
  registrationDocKey: string | null;
  registrationDocName: string | null;
}

export interface AssetReservation {
  reservationId: string;
  assetId: string;
  assetName: string | null;
  assetKind: AssetKind | null;
  reservedBy: string | null;
  reservedByName: string | null;
  reservedOn: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm (null = 종일)
  endTime: string | null;
  purpose: string | null;
  createdAt: string;
}

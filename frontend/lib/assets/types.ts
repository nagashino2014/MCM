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

export interface ReservableAsset {
  assetId: string;
  kind: AssetKind;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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

/*
 * 인포그래픽 자리(InfoSlot) — 쪽 컴포넌트가 인포그래픽을 놓는 곳. 바깥 요소에 data-widget="infographic"·data-slot 을 달아
 * 스튜디오(P5)가 이 자리를 찾아 유형을 바꿀 수 있게 한다(편집층의 info 가 spec 을 덮어쓴다 — lib/catalog/studio/edits.ts).
 * slot = 문서 안에서 자리를 가리키는 키(예: "area-1.process") — 유형 선택 기록(catalog_infographic_prefs)의 키로도 쓴다.
 */
import { renderInfographic } from "./render";
import type { InfoBox, InfoSpec } from "./types";

export interface InfoSlotProps {
  slot: string;
  spec: InfoSpec;
  /** 자리 크기 힌트(pt) */
  box: InfoBox;
  /** 쪽의 분야 번호(지도 색) */
  area?: number;
}

export function InfoSlot({ slot, spec, box, area }: InfoSlotProps) {
  return <>{renderInfographic(spec, box, { "data-widget": "infographic", "data-slot": slot }, area)}</>;
}

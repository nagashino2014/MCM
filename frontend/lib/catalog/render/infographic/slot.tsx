/*
 * 인포그래픽 자리(InfoSlot) — 쪽 컴포넌트가 인포그래픽을 놓는 곳. 바깥 요소에 data-widget="infographic"·data-slot 을 달아
 * 스튜디오(P5)가 이 자리를 찾아 유형을 바꿀 수 있게 한다(편집층의 info 가 spec 을 덮어쓴다 — lib/catalog/studio/edits.ts).
 * slot = 문서 안에서 자리를 가리키는 키(예: "area-1.process") — 유형 선택 기록(catalog_infographic_prefs)의 키로도 쓴다.
 */
import { cloneElement, type ReactElement } from "react";
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

/**
 * 쪽 고유 도식 자리(InfoSource) — 도식은 쪽 컴포넌트 마크업(children) 그대로 그리고, 그 내용을 spec 으로 알린다.
 * 스튜디오는 이 자리를 인포그래픽 위젯으로 보고 유형 바꾸기·일러스트로 그리기를 할 수 있다(바꾸면 spec 으로 다시 그림, 되돌리면 원래 도식).
 * 예: C08 사업 분야 개관의 원형 도식(분야명·누적 건수 지표·주요 서비스) — 일러스트로 바꿔도 내용과 지표 칩이 그대로 간다.
 */
export function InfoSource({ slot, children }: InfoSlotProps & { children: ReactElement<Record<string, unknown>> }) {
  return cloneElement(children, { "data-widget": "infographic", "data-slot": slot });
}

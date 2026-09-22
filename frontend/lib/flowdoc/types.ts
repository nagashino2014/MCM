// 흐름형 문서 블록 — 내부고시·내부 규정의 PDF(pdf.ts)와 HWPX(hwpx.ts)가 같은 블록을 그린다(2026-09-22).
// 두 출력이 같은 입력을 쓰므로 문단 구성·들여쓰기·표가 어긋나지 않는다.

import type { LetterBlock, TextRun } from "@/lib/letter/types";

export type FlowTable = Extract<LetterBlock, { kind: "table" }>;

export type FlowBlock =
  | {
      kind: "p";
      runs: TextRun[];
      align?: "left" | "center" | "right";
      sizePt?: number;
      /** 문단 전체 굵게(런별 bold 와 OR) */
      bold?: boolean;
      /** 왼쪽 여백(pt) — 모든 줄 */
      leftPt?: number;
      /** 첫 줄 들여쓰기(pt, 음수 = 내어쓰기). 왼쪽 여백 기준 */
      indentPt?: number;
      /** 문단 앞 간격(pt) */
      spaceBeforePt?: number;
    }
  | { kind: "table"; table: FlowTable; sizePt?: number; /** 음영(머리칸) 열 번호 */ shadeCols?: number[] }
  | { kind: "rule"; spaceBeforePt?: number }
  | { kind: "seal"; text: string; sealText: string; sizePt: number; stamp: boolean; spaceBeforePt?: number };

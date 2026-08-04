// 주 12시간 초과 연장근로 — 특별휴가(보상휴가) 전환 동의서 문구(사용자 확정, 2026-08-04).
// 근거: 근로기준법 제53조(연장 근로의 제한)·제56조(가산임금)·제57조(보상 휴가제), 전자서명법 제3조.
// 문구를 고치면 CONSENT_VERSION 을 올려 어떤 판의 문구에 동의했는지 이력에 남긴다.
// 서버(assessOverLimitOnSubmit)와 기안 모달(OvertimeConsentModal)이 공용한다.

export const CONSENT_VERSION = "v1";

/** 상신 문서 field_values._overtime_consent 로 저장되는 동의 이력. */
export interface OvertimeConsent {
  version: string;
  /** 동의(전자서명) 일시 ISO. */
  agreedAt: string;
  /** 서명자 표기 성명(세션 사용자). */
  signerName: string;
  /** 동의 대상 주(일요일 시작) — 주가 바뀐 재상신은 재동의가 필요하다. */
  weekStart: string;
  /** 동의 시점 고지값 — 주 합계·초과분(분). */
  totalMinutes: number;
  excessMinutes: number;
}

const fmtH = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

export interface ConsentSection {
  heading: string;
  body: string;
}

/** 동의서 본문 — {주·시간}을 채워 항목별로 돌려준다(모달·인쇄 공용). */
export function buildConsentSections(params: {
  weekStart: string;
  weekEnd: string;
  totalMinutes: number;
  excessMinutes: number;
  limitMinutes: number;
}): ConsentSection[] {
  const { weekStart, weekEnd, totalMinutes, excessMinutes, limitMinutes } = params;
  return [
    {
      heading: "1. 연장근로 현황 고지 확인",
      body:
        `본인의 해당 주(${weekStart} ~ ${weekEnd}) 연장근로 시간은 이번 신청분을 포함하여 주 ${fmtH(totalMinutes)}시간으로, ` +
        `「근로기준법」 제53조 제1항이 정한 연장근로 한도(1주 ${fmtH(limitMinutes)}시간)를 ${fmtH(excessMinutes)}시간 초과함을 고지받고 이를 확인하였습니다.`,
    },
    {
      heading: "2. 연장근로에 대한 동의",
      body:
        "본인은 회사가 원칙적으로 1주 12시간을 초과하는 연장근로를 허용하지 않음을 안내받았으며, " +
        "위 한도를 초과하는 근무는 회사의 지시에 의한 것이 아니라 업무상 특별한 사정에 따라 본인의 자유로운 의사로 스스로 신청하는 것임을 확인합니다. " +
        "본인은 본 신청 및 장래의 연장근로에 대한 동의를 언제든지 철회할 수 있음을 안내받았으며, " +
        "본 동의는 「근로기준법」 제53조 제4항에 따른 근로자 동의로서의 효력을 가집니다.",
    },
    {
      heading: "3. 보상휴가 전환 동의",
      body:
        "본인은 위 한도 초과분 연장근로에 대하여, 「근로기준법」 제57조 및 당사 노사 서면합의(보상휴가제)에 따라 " +
        "임금(같은 법 제56조의 가산임금 포함) 지급에 갈음하여 보상휴가(특별휴가)를 시간 단위로 부여받는 것에 동의합니다. " +
        "보상휴가는 실제 근태 기록과 대조하여 인정된 초과 근로시간을 기준으로 가산율(연장 1.5배, 야간 2.0배)을 반영해 산정·부여됩니다.",
    },
    {
      heading: "4. 건강 보호 안내 확인",
      body: "본인은 회사가 안내한 건강 보호 조치(적정 휴식 보장, 필요 시 건강검진 등)에 관한 사항을 고지받았습니다.",
    },
  ];
}

export const CONSENT_FOOTER =
  "본 동의는 전자적 방식으로 이루어지며, 「전자서명법」 제3조에 따라 서면 서명과 동일한 효력을 가집니다.";

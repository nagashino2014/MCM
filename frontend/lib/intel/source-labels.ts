/** 수집·공식 정보원 키의 사용자 표시 이름. 서버(보고서 문구)와 화면이 같이 쓰므로 서버 전용 모듈을 import 하지 않는다. */
export const INTEL_SOURCE_LABELS: Record<string, string> = {
  dart: "DART 공시",
  eiass: "환경영향평가(EIASS)",
  press: "정부 보도자료",
  news: "뉴스",
  gosi: "고시",
  gosi_eum: "토지이음 고시",
  gosi_me: "환경청 고시",
  kosis: "KOSIS 산업통계",
  law: "국가법령정보",
  kdi: "KDI 경제동향",
  samsung_semiconductor: "삼성전자 반도체 공식 발표",
  skhynix: "SK하이닉스 공식 발표",
  samsung_sem: "삼성전기 공식 발표",
  kiet: "KIET 산업동향",
  kea: "KEA 전자산업 이슈리포트",
};

export function intelSourceLabel(source: string | null | undefined): string {
  if (!source) return "출처 미상";
  return INTEL_SOURCE_LABELS[source] ?? source;
}

/** 과거 발행본에 남은 "수집 상태 확인 필요: dart, eiass, …" 문구의 키를 표시 이름으로 바꾼다(발행본 자체는 수정하지 않음). */
export function humanizeSourceKeys(text: string): string {
  return text.replace(/(수집 상태 확인 필요:\s*)([a-z_, ]+)/g, (_, head: string, list: string) =>
    head + list.split(",").map((key) => key.trim()).filter(Boolean).map(intelSourceLabel).join(", "));
}

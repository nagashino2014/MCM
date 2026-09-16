/**
 * 설문 초안 → 구글 폼 생성 Apps Script(.gs) 코드 생성 — 서버/클라이언트 공용 순수 함수.
 *
 * 1단계에서는 이 코드를 내려받아 script.google.com 에 붙여넣고 실행하면 폼이 만들어진다.
 * 2단계(Apps Script API + 구글 OAuth)에서도 **같은 코드를 그대로** 프로젝트에 업로드해 실행한다 —
 * 생성 로직이 한 곳에만 있어야 수동 경로와 자동 경로의 결과가 어긋나지 않는다.
 *
 * 실행하면 로그에 응답 URL(공개)과 편집 URL 이 찍히고, createSurveyForm() 은 두 URL 을 반환한다.
 */
import type { SurveyDetail, SurveyQuestion } from "./types";

/** 설문 문구를 Apps Script 소스의 문자열 리터럴로 안전하게 바꾼다. */
function js(value: string): string {
  // U+2028/2029 는 JSON.stringify 가 이스케이프하지 않는데, Apps Script 파서는 줄바꿈으로 읽어
  // 문자열이 끊긴다. 설문 문구에 쓸 일이 없는 문자라 공백으로 바꿔 없앤다.
  return JSON.stringify(String(value ?? "").replace(/[\u2028\u2029]/g, " "));
}

function questionCode(q: SurveyQuestion, i: number): string {
  const v = `q${i + 1}`;
  const title = js(q.title);
  const help = q.helpText ? `\n  ${v}.setHelpText(${js(q.helpText)});` : "";
  const required = q.qtype !== "section" && q.isRequired ? `\n  ${v}.setRequired(true);` : "";

  switch (q.qtype) {
    case "single": {
      const choices = q.options.map((o) => js(o.label)).join(", ");
      return `  var ${v} = form.addMultipleChoiceItem();
  ${v}.setTitle(${title});
  ${v}.setChoiceValues([${choices}]);${q.config.allowOther ? `\n  ${v}.showOtherOption(true);` : ""}${help}${required}`;
    }
    case "multi": {
      const choices = q.options.map((o) => js(o.label)).join(", ");
      return `  var ${v} = form.addCheckboxItem();
  ${v}.setTitle(${title});
  ${v}.setChoiceValues([${choices}]);${q.config.allowOther ? `\n  ${v}.showOtherOption(true);` : ""}${help}${required}`;
    }
    case "scale": {
      // Apps Script 의 척도는 하한 0~1, 상한 3~10 만 허용한다 — 범위를 그 안으로 맞춘다.
      const min = Math.min(Math.max(q.config.min ?? 1, 0), 1);
      const max = Math.min(Math.max(q.config.max ?? 5, 3), 10);
      const labels =
        q.config.minLabel || q.config.maxLabel
          ? `\n  ${v}.setLabels(${js(q.config.minLabel ?? "")}, ${js(q.config.maxLabel ?? "")});`
          : "";
      return `  var ${v} = form.addScaleItem();
  ${v}.setTitle(${title});
  ${v}.setBounds(${min}, ${max});${labels}${help}${required}`;
    }
    case "longtext":
      return `  var ${v} = form.addParagraphTextItem();
  ${v}.setTitle(${title});${help}${required}`;
    case "section":
      return `  var ${v} = form.addSectionHeaderItem();
  ${v}.setTitle(${title});${help}`;
    default:
      return `  var ${v} = form.addTextItem();
  ${v}.setTitle(${title});${help}${required}`;
  }
}

/**
 * 설문 정의를 그대로 재현하는 Apps Script 소스.
 * @param survey 문항까지 포함한 설문 상세
 */
export function buildFormScript(survey: SurveyDetail): string {
  const body = survey.questions.map(questionCode).join("\n\n");
  const periodNote =
    survey.periodStart || survey.periodEnd
      ? `\n * 접수 기간: ${survey.periodStart ?? ""} ~ ${survey.periodEnd ?? ""} (마감은 폼에서 setAcceptingResponses(false) 로 닫습니다)`
      : "";

  return `/**
 * ${survey.title}
 * MCM 설문에서 생성한 구글 폼 작성 스크립트입니다.
 * script.google.com 에서 새 프로젝트를 만들고 이 코드를 붙여넣은 뒤 createSurveyForm 을 실행하세요.
 * 처음 실행할 때 구글 계정 권한(폼 생성) 승인이 필요합니다.${periodNote}
 */
function createSurveyForm() {
  var form = FormApp.create(${js(survey.title)});
  form.setDescription(${js(survey.description ?? "")});
  form.setCollectEmail(${survey.isAnonymous ? "false" : "true"});
  form.setLimitOneResponsePerUser(${survey.isAnonymous ? "false" : "true"});
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);

${body}

  var result = {
    formId: form.getId(),
    publishedUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
  };
  Logger.log('응답 URL: ' + result.publishedUrl);
  Logger.log('편집 URL: ' + result.editUrl);
  return result;
}
`;
}

/** 다운로드 파일명 — 한글 제목을 안전한 파일명으로. */
export function scriptFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]/g, "").trim() || "survey";
  return `${base}.gs`;
}

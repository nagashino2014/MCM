import { SurveyListBoard } from "@/components/survey/SurveyListBoard";

export const dynamic = "force-dynamic";

export default function ExternalSurveysPage() {
  return <SurveyListBoard kind="external" />;
}

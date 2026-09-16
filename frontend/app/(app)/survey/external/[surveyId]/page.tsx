import { SurveyBuilderBoard } from "@/components/survey/SurveyBuilderBoard";

export const dynamic = "force-dynamic";

export default async function ExternalSurveyEditPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  return <SurveyBuilderBoard surveyId={surveyId} kind="external" />;
}

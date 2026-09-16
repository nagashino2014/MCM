import { SurveyRespondBoard } from "@/components/survey/SurveyRespondBoard";

export const dynamic = "force-dynamic";

export default async function SurveyRespondPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  return <SurveyRespondBoard surveyId={surveyId} />;
}

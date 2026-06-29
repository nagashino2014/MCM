import { ProjectDetail } from "@/components/sales/ProjectDetail";

export default async function SalesProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <div className="p-2 h-full">
      <ProjectDetail projectId={projectId} />
    </div>
  );
}

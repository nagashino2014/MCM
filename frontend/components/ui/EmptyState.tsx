import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="glass-card rounded-lg p-10 flex flex-col items-center justify-center text-center gap-3">
      <div className="w-10 h-10 rounded-lg cd-surface-bg flex items-center justify-center text-primary">
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <h3 className="text-base font-bold text-stone-800">{title}</h3>
        {description && (
          <p className="text-sm text-stone-500 mt-1 max-w-md">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

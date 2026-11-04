import { ArrowRight } from 'lucide-react';

export function EmptyPanel({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section className="empty-panel">
      <span className="empty-panel-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && onAction && (
        <button className="button-secondary" onClick={onAction}>
          {action} <ArrowRight size={15} />
        </button>
      )}
    </section>
  );
}

import { LoaderCircle } from 'lucide-react';

export function LoadingScreen({
  label,
  inline = false,
}: {
  label: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'inline-loading' : 'loading-screen'}>
      <LoaderCircle size={25} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function PageIntro({
  eyebrow,
  title,
  subtitle,
  icon,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="page-intro">
      <div className="page-intro-icon">{icon}</div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="welcome-subtitle">{subtitle}</p>
      </div>
    </section>
  );
}

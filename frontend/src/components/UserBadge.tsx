export function UserBadge({ name }: { name: string }) {
  return (
    <span className="user-badge">
      <span className="avatar avatar-tiny">{name.slice(0, 1)}</span>
      {name}
    </span>
  );
}

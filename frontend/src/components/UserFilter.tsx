import { ChevronDown } from 'lucide-react';
import type { LibraryUser } from '../types';

export function UserFilter({
  users,
  selected,
  onChange,
}: {
  users: LibraryUser[];
  selected: string;
  onChange: (cardNo: string) => void;
}) {
  return (
    <label className="filter-select">
      <span className="sr-only">利用者で絞り込む</span>
      <select
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">家族全員</option>
        {users.map((user) => (
          <option value={user.cardNo} key={user.cardNo}>
            {user.name}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </label>
  );
}

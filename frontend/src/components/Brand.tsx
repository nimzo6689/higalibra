import { LibraryBig } from 'lucide-react';

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="図書館ノート ホーム">
      <span className="brand-mark">
        <LibraryBig size={21} strokeWidth={2.2} />
      </span>
      <span className="brand-text">
        <strong>図書館ノート</strong>
        <small>FAMILY LIBRARY</small>
      </span>
    </a>
  );
}

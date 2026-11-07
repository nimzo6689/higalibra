import {
  BookMarked,
  BookOpen,
  Home,
  Settings2,
  ScanBarcode,
} from 'lucide-react';
import type { Route } from '../types';

const navigation = [
  { route: '/', label: 'ホーム', icon: Home },
  { route: '/borrowed', label: '貸出', icon: BookOpen },
  { route: '/reservations', label: '予約', icon: BookMarked },
  { route: '/barcode', label: '利用証', icon: ScanBarcode },
  { route: '/settings', label: '予約設定', icon: Settings2 },
] as const;

export function Navigation({
  route,
  onNavigate,
  hideSettings = false,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  hideSettings?: boolean;
}) {
  return (
    <nav className="navigation" aria-label="メインメニュー">
      {navigation
        .filter(
          ({ route: itemRoute }) => !hideSettings || itemRoute !== '/settings',
        )
        .map(({ route: itemRoute, label, icon: Icon }) => (
          <button
            key={itemRoute}
            className={`nav-item ${route === itemRoute ? 'active' : ''}`}
            onClick={() => onNavigate(itemRoute)}
            aria-current={route === itemRoute ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={route === itemRoute ? 2.2 : 1.8} />
            <span>{label}</span>
            {route === itemRoute && <span className="nav-active-dot" />}
          </button>
        ))}
    </nav>
  );
}

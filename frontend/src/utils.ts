import type { Route } from './types';

export function readRoute(): Route {
  const pathname = window.location.pathname;
  const routes: Route[] = [
    '/',
    '/borrowed',
    '/reservations',
    '/barcode',
    '/settings',
  ];
  return routes.includes(pathname as Route) ? (pathname as Route) : '/';
}

export function daysUntil(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return Number.MAX_SAFE_INTEGER;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((target - today) / 86_400_000);
}

export function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatPublicationMonth(value: string | null): string {
  if (!value) return '不明';
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(value);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月`;
}

export function coverClass(title: string): string {
  const styles = ['cover-green', 'cover-peach', 'cover-lavender', 'cover-blue'];
  return styles[title.length % styles.length];
}

export function safeCoverUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '予期しないエラーが発生しました。';
}

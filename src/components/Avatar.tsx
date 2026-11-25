import React from 'react';
import type { UserProfile } from '../types/pappo';

export function Avatar({
  user,
  size = 40,
  showOnline = true,
  className = '',
}: {
  user: Pick<UserProfile, 'n' | 'c' | 'img' | 'on' | 'showActivity'>;
  size?: number;
  showOnline?: boolean;
  className?: string;
}) {
  const initial = (user.n || 'U').charAt(0).toUpperCase();
  const bg = user.img
    ? undefined
    : `linear-gradient(135deg, ${user.c?.[0] || '#6d4aff'}, ${user.c?.[1] || '#ff4e88'})`;

  return (
    <div
      className={`relative shrink-0 rounded-full grid place-items-center font-display font-bold text-white select-none overflow-visible ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.max(12, Math.round(size * 0.4))}px`,
        background: bg,
      }}
    >
      {user.img ? (
        <img
          src={user.img}
          alt={user.n}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover rounded-full"
        />
      ) : (
        <span>{initial}</span>
      )}
      {showOnline && user.on && user.showActivity !== false && (
        <span
          aria-label="Online"
          className="absolute right-0 bottom-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-[var(--card)]"
        />
      )}
    </div>
  );
}

export function timeAgo(ts: number): string {
  const m = (Date.now() - ts) / 60_000;
  if (m < 1) return 'agora';
  if (m < 60) return `${Math.floor(m)} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
}

export function formatHour(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

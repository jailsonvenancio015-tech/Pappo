import React from 'react';
import { BarChart2, Film, Lock, Play, Search } from 'lucide-react';
import type { AppState, Post, UserProfile } from '../types/pappo';
import { CARD_GRADIENTS } from '../utils/mediaTools';
import { canViewProfileContent, filterVisiblePosts } from '../utils/socialLogic';
import { Avatar } from './Avatar';

interface ExploreViewProps {
  state: AppState;
  usersMap: Record<string, UserProfile>;
  allUsers: UserProfile[];
  query: string;
  onQueryChange: (q: string) => void;
  onOpenProfile: (id: string) => void;
  onFollowToggle: (id: string) => void;
  onOpenPost: (postId: string) => void;
}

export function ExploreView({
  state,
  usersMap,
  allUsers,
  query,
  onQueryChange,
  onOpenProfile,
  onFollowToggle,
  onOpenPost,
}: ExploreViewProps) {
  const cleanQ = query.trim().toLowerCase().replace(/^[#@]/, '');

  const visiblePosts = filterVisiblePosts({
    posts: state.posts,
    viewerId: 'me',
    usersMap,
    fol: state.fol,
    blockedIds: state.blocked,
    query,
  });

  // Trending hashtags only from visible posts (respects privacy!)
  const tagCounts: Record<string, number> = {};
  for (const p of visiblePosts) {
    const matches = p.cap?.match(/#[\p{L}\d_]+/gu) || [];
    for (const tag of matches) {
      const k = tag.toLowerCase();
      tagCounts[k] = (tagCounts[k] || 0) + 1;
    }
  }
  const trending = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const matchedUsers = cleanQ
    ? allUsers.filter(
        (u) =>
          !state.blocked.includes(u.id) &&
          (u.n.toLowerCase().includes(cleanQ) || u.h.toLowerCase().includes(cleanQ))
      )
    : [];

  const renderTile = (p: Post) => {
    const owner = usersMap[p.u];
    const allowed =
      p.u === 'me' ||
      !owner ||
      canViewProfileContent({
        viewerId: 'me',
        target: owner,
        followStatus: state.fol[p.u],
        blockedIds: state.blocked,
      });

    if (!allowed) return null;

    return (
      <button
        key={p.id}
        type="button"
        onClick={() => onOpenPost(p.id)}
        aria-label={p.cap || 'Abrir publicação'}
        className="relative aspect-square overflow-hidden bg-[var(--card)] group focus-visible:outline-2 focus-visible:outline-[var(--acc)]"
      >
        {p.type === 'image' && p.src ? (
          <img
            src={p.src}
            alt={p.cap || 'Publicação'}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div
            className="w-full h-full grid place-items-center p-3 text-white text-xs font-bold text-center"
            style={{ background: p.type === 'text' ? CARD_GRADIENTS[p.bg || 0] : 'var(--grad)' }}
          >
            {p.type === 'video' ? (
              <Play className="w-7 h-7" />
            ) : p.type === 'poll' ? (
              <span className="line-clamp-3">{p.cap}</span>
            ) : (
              <span className="line-clamp-4">{p.cap}</span>
            )}
          </div>
        )}

        {(p.reel || p.type === 'video' || p.type === 'poll' || (p.imgs && p.imgs.length > 1)) && (
          <span className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/55 text-white">
            {p.reel ? <Film className="w-3.5 h-3.5" /> : p.type === 'video' ? <Play className="w-3.5 h-3.5" /> : p.type === 'poll' ? <BarChart2 className="w-3.5 h-3.5" /> : '▦'}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="max-w-[700px] mx-auto px-3 sm:px-4 pt-5 pb-20 md:pb-12 space-y-4">
      <h1 className="text-2xl font-display font-bold tracking-tight">Explorar</h1>

      <div className="relative">
        <Search className="w-4 h-4 text-[var(--mut)] absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar pessoas ou #hashtags…"
          aria-label="Buscar pessoas ou hashtags"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--line)] focus:border-[var(--acc)] outline-none text-sm"
        />
      </div>

      {trending.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">Em alta</h2>
          <div className="flex flex-wrap gap-1.5">
            {trending.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                onClick={() => onQueryChange(tag.slice(1))}
                className="px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)] transition-colors whitespace-nowrap"
              >
                {tag} · <span className="font-mono-num text-[var(--mut)]">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {matchedUsers.length > 0 && (
        <div className="space-y-2">
          {matchedUsers.map((u) => {
            const st = state.fol[u.id];
            return (
              <div
                key={u.id}
                className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--card)] border border-[var(--line)]"
              >
                <button type="button" onClick={() => onOpenProfile(u.id)}>
                  <Avatar user={u} size={42} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-1.5 truncate">
                    <span>{u.n}</span>
                    {u.priv && <Lock className="w-3.5 h-3.5 text-[var(--mut)]" />}
                  </div>
                  <div className="text-xs text-[var(--mut)] truncate">@{u.h}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onFollowToggle(u.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap ${
                    st ? 'bg-[var(--ink)] text-[var(--bg)]' : 'border border-[var(--line)]'
                  }`}
                >
                  {st === 'ok' ? 'Seguindo' : st === 'pend' ? 'Solicitado' : 'Seguir'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {visiblePosts.length > 0 ? (
        <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden">{visiblePosts.map(renderTile)}</div>
      ) : (
        <p className="text-center py-12 text-sm text-[var(--mut)]">Nada encontrado para essa busca.</p>
      )}
    </div>
  );
}

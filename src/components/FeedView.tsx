import React, { useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Flag,
  Heart,
  MessageCircle,
  Music,
  Pause,
  Play,
  Plus,
  Repeat2,
  Send,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import type { AppState, Post, UserProfile } from '../types/pappo';
import { CARD_GRADIENTS } from '../utils/mediaTools';
import { Avatar, extractHost, timeAgo } from './Avatar';
import { AdaptiveMediaPlayer } from './AdaptiveMediaPlayer';
import { filterVisiblePosts } from '../utils/socialLogic';

interface FeedViewProps {
  state: AppState;
  usersMap: Record<string, UserProfile>;
  suggestions: UserProfile[];
  onCellular: boolean;
  saveData: boolean;
  onOpenProfile: (userId: string) => void;
  onFollowToggle: (userId: string) => void;
  onLike: (postId: string) => void;
  onSave: (postId: string) => void;
  onRepost: (postId: string) => void;
  onVotePoll: (postId: string, optionIdx: number) => void;
  onOpenViewer: (postId: string) => void;
  onEditCaption: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  onSharePost: (postId: string) => void;
  onReportPost: (postId: string) => void;
  onTagClick: (tag: string) => void;
  onMentionClick: (handle: string) => void;
  onOpenStory: (userId: string) => void;
  onNewStory: () => void;
  onHideSuggestions: () => void;
}

export function FeedView({
  state,
  usersMap,
  suggestions,
  onCellular,
  saveData,
  onOpenProfile,
  onFollowToggle,
  onLike,
  onSave,
  onRepost,
  onVotePoll,
  onOpenViewer,
  onEditCaption,
  onDeletePost,
  onSharePost,
  onReportPost,
  onTagClick,
  onMentionClick,
  onOpenStory,
  onNewStory,
  onHideSuggestions,
}: FeedViewProps) {
  const [limit, setLimit] = useState(10);
  const [heartPopId, setHeartPopId] = useState<string | null>(null);
  const [carouselIdx, setCarouselIdx] = useState<Record<string, number>>({});
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [mutedAudio, setMutedAudio] = useState<Record<string, boolean>>({});

  const resolveUser = (id: string): UserProfile =>
    id === 'me'
      ? state.me
      : usersMap[id] || { id, n: 'Usuário', h: 'usuario', c: ['#6d4aff', '#ff4e88'] };

  const activeStories = state.stories.filter(
    (s) => s.exp > Date.now() && !state.blocked.includes(s.u) && (s.u === 'me' || state.fol[s.u] === 'ok')
  );
  const storyAuthors = [...new Set(activeStories.map((s) => s.u))];

  const visiblePosts = filterVisiblePosts({
    posts: state.posts.filter((p) => p.u === 'me' || state.fol[p.u] === 'ok'),
    viewerId: 'me',
    usersMap,
    fol: state.fol,
    blockedIds: state.blocked,
  });

  const renderRichText = (text: string) => {
    const tokens = text.split(/(#[\p{L}\d_]+|@[a-z0-9_.]+)/giu);
    return tokens.map((tok, idx) => {
      if (tok.startsWith('#')) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onTagClick(tok.slice(1))}
            className="text-[var(--acc)] font-semibold hover:underline"
          >
            {tok}
          </button>
        );
      }
      if (tok.startsWith('@')) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onMentionClick(tok.slice(1).toLowerCase())}
            className="text-[var(--acc)] font-semibold hover:underline"
          >
            {tok}
          </button>
        );
      }
      return <React.Fragment key={idx}>{tok}</React.Fragment>;
    });
  };

  const triggerDoubleTapLike = (post: Post) => {
    if (!post.likes.includes('me')) onLike(post.id);
    setHeartPopId(post.id);
    window.setTimeout(() => setHeartPopId((cur) => (cur === post.id ? null : cur)), 780);
  };

  return (
    <div className="max-w-[650px] mx-auto px-3 sm:px-4 pt-4 pb-20 md:pb-12 space-y-4">
      {/* Stories Bar */}
      <div className="flex items-center gap-3.5 overflow-x-auto no-scrollbar pb-2">
        <button
          type="button"
          onClick={onNewStory}
          className="flex flex-col items-center gap-1.5 w-[70px] shrink-0 text-xs"
        >
          <div className="p-[3px] rounded-full bg-[var(--line)]">
            <div className="w-14 h-14 rounded-full bg-[var(--card)] border-[3px] border-[var(--bg)] grid place-items-center text-[var(--acc)]">
              <Plus className="w-6 h-6" />
            </div>
          </div>
          <span className="truncate w-full text-center font-medium">Seu story</span>
        </button>

        {storyAuthors.map((uid) => {
          const u = resolveUser(uid);
          const allSeen = activeStories.filter((s) => s.u === uid).every((s) => s.seen.includes('me'));
          return (
            <button
              key={uid}
              type="button"
              onClick={() => onOpenStory(uid)}
              className="flex flex-col items-center gap-1.5 w-[70px] shrink-0 text-xs"
            >
              <div
                className="p-[3px] rounded-full"
                style={{ background: allSeen ? 'var(--line)' : 'var(--grad)' }}
              >
                <div className="rounded-full border-[3px] border-[var(--bg)]">
                  <Avatar user={u} size={54} showOnline={false} />
                </div>
              </div>
              <span className="truncate w-full text-center font-medium">{u.n.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>

      {/* Inline Suggestions (Mobile/Tablet) */}
      {!state.perf.hideSuggestions && suggestions.length > 0 && (
        <section className="xl:hidden bg-[var(--card)] border border-[var(--line)] rounded-2xl p-4 shadow-[var(--sh)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
              Sugestões para você
            </h2>
            <button
              type="button"
              onClick={onHideSuggestions}
              className="text-xs font-semibold text-[var(--mut)] hover:text-[var(--ink)] px-2 py-1"
            >
              Ocultar
            </button>
          </div>
          <div className="space-y-2.5">
            {suggestions.slice(0, 3).map((u) => {
              const st = state.fol[u.id];
              return (
                <div key={u.id} className="flex items-center gap-3">
                  <button type="button" onClick={() => onOpenProfile(u.id)} aria-label={`Perfil de ${u.n}`}>
                    <Avatar user={u} size={40} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{u.n}</div>
                    <div className="text-xs text-[var(--mut)] truncate">
                      @{u.h}{u.priv ? ' · privada' : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onFollowToggle(u.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      st
                        ? 'bg-[var(--ink)] text-[var(--bg)]'
                        : 'border border-[var(--line)] hover:border-[var(--acc)]'
                    }`}
                  >
                    {st === 'ok' ? 'Seguindo' : st === 'pend' ? 'Solicitado' : 'Seguir'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Posts Feed */}
      {visiblePosts.slice(0, limit).map((post) => {
        const u = resolveUser(post.u);
        const liked = post.likes.includes('me');
        const saved = post.saved.includes('me');
        const reposted = (post.rp || []).includes('me');
        const lastComment = post.cm[post.cm.length - 1];
        const totalVotes = (post.opts || []).reduce((acc, o) => acc + o.v.length, 0);
        const userVoted = (post.opts || []).some((o) => o.v.includes('me'));
        const curSlide = carouselIdx[post.id] || 0;

        return (
          <article
            key={post.id}
            className="relative bg-[var(--card)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-[var(--sh)]"
          >
            {/* Header */}
            <header className="flex items-center gap-3 p-4">
              <button type="button" onClick={() => onOpenProfile(post.u)} aria-label={`Ver perfil de ${u.n}`}>
                <Avatar user={u} size={40} />
              </button>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenProfile(post.u)}
                  className="font-semibold text-sm hover:underline block truncate text-left"
                >
                  {u.n}
                </button>
                <div className="text-xs text-[var(--mut)] truncate">
                  @{u.h} · {timeAgo(post.t)}
                  {post.quality ? ` · qualidade ${post.quality}` : ''}
                </div>
              </div>
              {post.u === 'me' ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onEditCaption(post.id)}
                    aria-label="Editar legenda"
                    className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)]"
                  >
                    <Wand2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePost(post.id)}
                    aria-label="Apagar publicação"
                    className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:text-rose-500 hover:bg-[var(--bg)]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onReportPost(post.id)}
                  aria-label="Denunciar publicação"
                  className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:text-rose-500 hover:bg-[var(--bg)]"
                >
                  <Flag className="w-4 h-4" />
                </button>
              )}
            </header>

            {/* Poll question */}
            {post.type === 'poll' && post.cap && (
              <p className="px-4 pb-3 text-base font-bold">{renderRichText(post.cap)}</p>
            )}

            {/* Media Content */}
            {post.type === 'image' && post.imgs && post.imgs.length > 1 && (
              <div className="relative" onDoubleClick={() => triggerDoubleTapLike(post)}>
                <img
                  src={post.imgs[curSlide]}
                  alt={post.cap || 'Foto do carrossel'}
                  referrerPolicy="no-referrer"
                  onClick={() => onOpenViewer(post.id)}
                  className="w-full max-h-[680px] object-cover cursor-zoom-in block"
                  style={{ aspectRatio: post.ar || 1 }}
                />
                <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-bold font-mono-num backdrop-blur-sm">
                  {curSlide + 1}/{post.imgs.length}
                </span>
                {curSlide > 0 && (
                  <button
                    type="button"
                    aria-label="Foto anterior"
                    onClick={() => setCarouselIdx((p) => ({ ...p, [post.id]: curSlide - 1 }))}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white grid place-items-center backdrop-blur-sm"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}
                {curSlide < post.imgs.length - 1 && (
                  <button
                    type="button"
                    aria-label="Próxima foto"
                    onClick={() => setCarouselIdx((p) => ({ ...p, [post.id]: curSlide + 1 }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 text-white grid place-items-center backdrop-blur-sm"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}

            {post.type === 'image' && (!post.imgs || post.imgs.length <= 1) && post.src && (
              <div className="relative" onDoubleClick={() => triggerDoubleTapLike(post)}>
                <img
                  src={post.src}
                  alt={post.cap || 'Imagem da publicação'}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onClick={() => onOpenViewer(post.id)}
                  className="w-full max-h-[680px] object-cover cursor-zoom-in block"
                  style={{ aspectRatio: post.ar || 1 }}
                />
              </div>
            )}

            {post.type === 'video' && (
              <AdaptiveMediaPlayer
                src={post.src}
                assetId={post.id}
                isReel={Boolean(post.reel)}
                autoplay={state.perf.autoplayVideo && !state.perf.batteryDataSaver}
                defaultResolution={state.perf.playbackResolution}
                hdrPreferred={state.perf.hdrEnabled}
                onCellular={onCellular}
                saveData={saveData}
                cacheLimitMb={state.perf.cacheLimitMb}
              />
            )}

            {post.type === 'text' && (
              <div
                onClick={() => onOpenViewer(post.id)}
                onDoubleClick={() => triggerDoubleTapLike(post)}
                className="aspect-square grid place-items-center p-8 text-center text-white text-2xl font-display font-bold cursor-pointer"
                style={{ background: CARD_GRADIENTS[post.bg || 0] }}
              >
                <p className="max-w-full break-words">{post.cap}</p>
              </div>
            )}

            {post.type === 'poll' && post.opts && (
              <div className="mx-4 mb-2 p-3.5 rounded-2xl bg-[var(--bg)] border border-[var(--line)] space-y-2">
                {post.opts.map((opt, idx) => {
                  const pct = totalVotes ? Math.round((opt.v.length * 100) / totalVotes) : 0;
                  const chosen = opt.v.includes('me');
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onVotePoll(post.id, idx)}
                      className={`relative w-full overflow-hidden rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold flex items-center justify-between gap-3 transition-colors ${
                        chosen
                          ? 'border-[var(--acc)] bg-[var(--card)]'
                          : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--acc)]'
                      }`}
                    >
                      {userVoted && (
                        <span
                          className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--acc)_18%,transparent)] transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                      <span className="relative z-10">{opt.t}</span>
                      {userVoted && <span className="relative z-10 text-xs font-mono-num">{pct}%</span>}
                    </button>
                  );
                })}
                <div className="text-xs text-[var(--mut)] font-mono-num">{totalVotes} voto(s)</div>
              </div>
            )}

            {/* Attached Music */}
            {post.music && (
              <div className="mx-4 mt-3 p-2.5 rounded-xl bg-[var(--bg)] flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`audio-${post.id}`) as HTMLAudioElement | null;
                    if (!el) return;
                    if (el.paused) {
                      el.play().then(() => setPlayingAudioId(post.id)).catch(() => {});
                    } else {
                      el.pause();
                      setPlayingAudioId(null);
                    }
                  }}
                  aria-label="Tocar ou pausar áudio"
                  className="w-9 h-9 rounded-full text-white grid place-items-center shrink-0"
                  style={{ background: 'var(--grad)' }}
                >
                  {playingAudioId === post.id ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold flex items-center gap-1.5 truncate">
                    <Music className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{extractHost(post.music)}</span>
                  </div>
                  <div className="text-[11px] text-[var(--mut)]">Áudio da publicação</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !mutedAudio[post.id];
                    setMutedAudio((m) => ({ ...m, [post.id]: next }));
                    const el = document.getElementById(`audio-${post.id}`) as HTMLAudioElement | null;
                    if (el) el.muted = next;
                  }}
                  aria-label="Silenciar áudio"
                  className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)]"
                >
                  {mutedAudio[post.id] ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <audio
                  id={`audio-${post.id}`}
                  src={post.music}
                  preload="none"
                  loop
                  onEnded={() => setPlayingAudioId(null)}
                />
              </div>
            )}

            {heartPopId === post.id && (
              <div className="heart-pop pointer-events-none absolute left-1/2 top-1/2 text-6xl text-white drop-shadow-lg">
                ❤
              </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center gap-1 px-2.5 py-2">
              <button
                type="button"
                onClick={() => onLike(post.id)}
                aria-label={`Curtir (${post.likes.length})`}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-sm font-semibold transition-colors min-h-[40px] ${
                  liked ? 'text-rose-500' : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                <Heart className={`w-5 h-5 ${liked ? 'fill-current' : ''}`} />
                <span className="font-mono-num">{post.likes.length}</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenViewer(post.id)}
                aria-label={`Comentar (${post.cm.length})`}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-sm font-semibold text-[var(--mut)] hover:text-[var(--ink)] min-h-[40px]"
              >
                <MessageCircle className="w-5 h-5" />
                <span className="font-mono-num">{post.cm.length}</span>
              </button>

              <button
                type="button"
                onClick={() => onRepost(post.id)}
                aria-label={`Repostar (${(post.rp || []).length})`}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-sm font-semibold transition-colors min-h-[40px] ${
                  reposted ? 'text-emerald-500' : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                <Repeat2 className="w-5 h-5" />
                <span className="font-mono-num">{(post.rp || []).length}</span>
              </button>

              <button
                type="button"
                onClick={() => onSharePost(post.id)}
                aria-label="Compartilhar"
                className="px-2.5 py-2 rounded-xl text-[var(--mut)] hover:text-[var(--ink)] min-h-[40px]"
              >
                <Send className="w-5 h-5" />
              </button>

              <div className="flex-1" />

              <button
                type="button"
                onClick={() => onSave(post.id)}
                aria-label={saved ? 'Remover dos salvos' : 'Salvar publicação'}
                className={`px-2.5 py-2 rounded-xl transition-colors min-h-[40px] ${
                  saved ? 'text-[var(--acc)]' : 'text-[var(--mut)] hover:text-[var(--ink)]'
                }`}
              >
                <Bookmark className={`w-5 h-5 ${saved ? 'fill-current' : ''}`} />
              </button>
            </div>

            {/* Caption & Last Comment */}
            {post.type !== 'text' && post.type !== 'poll' && post.cap && (
              <p className="px-4 pb-3 text-sm leading-relaxed">
                <span className="font-semibold mr-1.5">{u.h}</span>
                {renderRichText(post.cap)}
              </p>
            )}
            {lastComment && (
              <p className="px-4 pb-3.5 text-sm text-[var(--mut)]">
                <span className="font-medium text-[var(--ink)] mr-1">{resolveUser(lastComment.u).h}:</span>
                {lastComment.tx}
              </p>
            )}
          </article>
        );
      })}

      {visiblePosts.length > limit && (
        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => setLimit((n) => n + 10)}
            className="px-4 py-2 rounded-xl border border-[var(--line)] text-sm font-semibold hover:border-[var(--acc)]"
          >
            Carregar mais publicações
          </button>
        </div>
      )}

      {visiblePosts.length === 0 && (
        <div className="text-center py-12 text-[var(--mut)] text-sm">
          Nenhuma publicação visível ainda. Toque em Criar ou siga pessoas em Explorar.
        </div>
      )}
    </div>
  );
}

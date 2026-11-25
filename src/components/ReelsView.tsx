import React from 'react';
import { Heart, MessageCircle, Plus } from 'lucide-react';
import type { AppState, UserProfile } from '../types/pappo';
import { Avatar } from './Avatar';
import { AdaptiveMediaPlayer } from './AdaptiveMediaPlayer';

interface ReelsViewProps {
  state: AppState;
  usersMap: Record<string, UserProfile>;
  onCellular: boolean;
  saveData: boolean;
  onCreateReel: () => void;
  onLike: (postId: string) => void;
  onOpenViewer: (postId: string) => void;
  onOpenProfile: (userId: string) => void;
}

export function ReelsView({
  state,
  usersMap,
  onCellular,
  saveData,
  onCreateReel,
  onLike,
  onOpenViewer,
  onOpenProfile,
}: ReelsViewProps) {
  const reels = state.posts.filter((p) => p.type === 'video' && !state.blocked.includes(p.u));

  if (!reels.length) {
    return (
      <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
        <p className="text-sm text-[var(--mut)]">
          Nenhum Reel publicado ainda. Envie um vídeo em 9:16 com controle de qualidade e HDR adaptativo.
        </p>
        <button
          type="button"
          onClick={onCreateReel}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-semibold"
          style={{ background: 'var(--grad)' }}
        >
          <Plus className="w-4 h-4" />
          Criar primeiro Reel
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto snap-y snap-mandatory bg-black pb-14 md:pb-0">
      {reels.map((p) => {
        const u = p.u === 'me' ? state.me : usersMap[p.u] || state.me;
        const liked = p.likes.includes('me');
        return (
          <section
            key={p.id}
            className="h-full snap-start relative flex items-center justify-center bg-black text-white"
          >
            <div className="w-full max-w-[480px] relative">
              <AdaptiveMediaPlayer
                src={p.src}
                assetId={p.id}
                isReel
                autoplay={state.perf.autoplayVideo}
                defaultResolution={state.perf.playbackResolution}
                hdrPreferred={state.perf.hdrEnabled}
                onCellular={onCellular}
                saveData={saveData}
                cacheLimitMb={state.perf.cacheLimitMb}
              />

              <div className="absolute left-4 bottom-20 right-16 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => onOpenProfile(p.u)}
                  className="flex items-center gap-2.5 mb-2"
                >
                  <Avatar user={u} size={36} />
                  <span className="font-semibold text-sm drop-shadow">@{u.h}</span>
                </button>
                {p.cap && <p className="text-sm drop-shadow line-clamp-3">{p.cap}</p>}
              </div>

              <div className="absolute right-3 bottom-24 flex flex-col items-center gap-4">
                <button
                  type="button"
                  onClick={() => onLike(p.id)}
                  aria-label="Curtir Reel"
                  className="flex flex-col items-center gap-1 text-xs font-bold"
                >
                  <span className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-md grid place-items-center">
                    <Heart className={`w-5 h-5 ${liked ? 'fill-rose-500 text-rose-500' : ''}`} />
                  </span>
                  <span className="font-mono-num">{p.likes.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenViewer(p.id)}
                  aria-label="Comentar Reel"
                  className="flex flex-col items-center gap-1 text-xs font-bold"
                >
                  <span className="w-11 h-11 rounded-full bg-white/15 backdrop-blur-md grid place-items-center">
                    <MessageCircle className="w-5 h-5" />
                  </span>
                  <span className="font-mono-num">{p.cm.length}</span>
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Flag, Maximize2, Send, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Post, Story, UserProfile } from '../types/pappo';
import { ACCENT_PALETTES, CARD_GRADIENTS, buildStickerDataUrl } from '../utils/mediaTools';
import { Avatar, timeAgo } from './Avatar';
import { AdaptiveMediaPlayer } from './AdaptiveMediaPlayer';

/* ---------- Post Viewer Modal (Zoom, Pan, Comments) ---------- */
export function PostViewerModal({
  post,
  usersMap,
  me,
  onClose,
  onAddComment,
  onCellular,
  saveData,
  cacheLimitMb,
}: {
  post: Post;
  usersMap: Record<string, UserProfile>;
  me: UserProfile;
  onClose: () => void;
  onAddComment: (postId: string, text: string) => void;
  onCellular: boolean;
  saveData: boolean;
  cacheLimitMb: number;
}) {
  const [zoom, setZoom] = useState(1);
  const [comment, setComment] = useState('');
  const resolveUser = (id: string) => (id === 'me' ? me : usersMap[id] || me);
  const author = resolveUser(post.u);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col md:flex-row">
      <div className="flex-1 relative grid place-items-center overflow-hidden bg-black">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar visualizador"
          className="absolute top-3 left-3 z-10 w-10 h-10 rounded-full bg-white/15 text-white grid place-items-center"
        >
          <X className="w-5 h-5" />
        </button>

        {post.type === 'image' && (
          <>
            <img
              src={post.imgs ? post.imgs[0] : post.src}
              alt={post.cap || 'Imagem'}
              className="max-w-full max-h-full object-contain transition-transform"
              style={{ transform: `scale(${zoom})` }}
            />
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 text-white">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                aria-label="Diminuir zoom"
                className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-md grid place-items-center"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-xs font-mono-num">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
                aria-label="Aumentar zoom"
                className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-md grid place-items-center"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                aria-label="Ajustar"
                className="w-9 h-9 rounded-full bg-white/15 backdrop-blur-md grid place-items-center"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {post.type === 'video' && (
          <div className="w-full max-w-3xl">
            <AdaptiveMediaPlayer
              src={post.src}
              assetId={post.id}
              autoplay
              defaultResolution="auto"
              hdrPreferred
              onCellular={onCellular}
              saveData={saveData}
              cacheLimitMb={cacheLimitMb}
            />
          </div>
        )}

        {(post.type === 'text' || post.type === 'poll') && (
          <div
            className="w-[min(90%,480px)] aspect-square rounded-3xl p-8 grid place-items-center text-center text-white text-2xl font-display font-bold"
            style={{ background: CARD_GRADIENTS[post.bg || 0] }}
          >
            {post.cap}
          </div>
        )}
      </div>

      <aside className="w-full md:w-[360px] h-[44dvh] md:h-full bg-[var(--card)] border-t md:border-t-0 md:border-l border-[var(--line)] flex flex-col">
        <header className="flex items-center gap-3 p-4 border-b border-[var(--line)]">
          <Avatar user={author} size={36} />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{author.n}</div>
            {post.cap && post.type !== 'text' && (
              <div className="text-xs text-[var(--mut)] truncate">{post.cap}</div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {post.cm.length === 0 ? (
            <p className="text-xs text-[var(--mut)] text-center py-8">Seja o primeiro a comentar</p>
          ) : (
            post.cm.map((c) => {
              const cu = resolveUser(c.u);
              return (
                <div key={c.id} className="flex items-start gap-2.5 text-sm">
                  <Avatar user={cu} size={30} showOnline={false} />
                  <div className="min-w-0">
                    <span className="font-semibold mr-1.5">{cu.h}</span>
                    <span className="text-xs text-[var(--mut)]">{timeAgo(c.t)}</span>
                    <div className="text-sm">{c.tx}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return;
            onAddComment(post.id, comment.trim());
            setComment('');
          }}
          className="flex items-center gap-2 p-3 border-t border-[var(--line)]"
        >
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Adicione um comentário…"
            className="flex-1 px-3.5 py-2 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm outline-none"
          />
          <button
            type="submit"
            aria-label="Enviar comentário"
            className="w-10 h-10 rounded-full text-white grid place-items-center shrink-0"
            style={{ background: 'var(--grad)' }}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </aside>
    </div>
  );
}

/* ---------- Story Viewer Modal ---------- */
export function StoryViewerModal({
  stories,
  author,
  isMine,
  onClose,
  onMarkSeen,
  onDeleteStory,
  onReact,
  onReply,
}: {
  stories: Story[];
  author: UserProfile;
  isMine: boolean;
  onClose: () => void;
  onMarkSeen: (storyId: string) => void;
  onDeleteStory: (storyId: string) => void;
  onReact: (emoji: string) => void;
  onReply: (text: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');

  const cur = stories[idx];

  useEffect(() => {
    if (cur && !cur.seen.includes('me')) {
      onMarkSeen(cur.id);
    }
  }, [cur, onMarkSeen]);

  useEffect(() => {
    if (!cur || paused) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 1) {
          if (idx + 1 >= stories.length) {
            onClose();
            return 1;
          }
          setIdx((i) => i + 1);
          return 0;
        }
        return p + 0.015;
      });
    }, 60);
    return () => clearInterval(id);
  }, [cur, paused, idx, stories.length, onClose]);

  if (!cur) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black text-white grid place-items-center select-none">
      <div className="absolute top-3 inset-x-3 flex gap-1.5 z-20">
        {stories.map((s, i) => (
          <div key={s.id} className="flex-1 h-1 rounded-full bg-white/30 overflow-hidden">
            <div
              className="h-full bg-white"
              style={{ width: `${i < idx ? 100 : i === idx ? progress * 100 : 0}%` }}
            />
          </div>
        ))}
      </div>

      <header className="absolute top-7 inset-x-3 flex items-center gap-3 z-20">
        <Avatar user={author} size={36} showOnline={false} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{author.n}</div>
          <div className="text-xs text-white/75">{timeAgo(cur.t)}</div>
        </div>
        {isMine && (
          <button
            type="button"
            onClick={() => onDeleteStory(cur.id)}
            aria-label="Apagar story"
            className="w-9 h-9 rounded-full grid place-items-center bg-white/15"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar story"
          className="w-9 h-9 rounded-full grid place-items-center bg-white/15"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {cur.type === 'text' ? (
        <div
          className="w-[min(90%,420px)] aspect-[9/16] rounded-3xl p-8 grid place-items-center text-center text-2xl font-display font-bold"
          style={{ background: CARD_GRADIENTS[cur.bg || 0] }}
        >
          {cur.tx}
        </div>
      ) : (
        <img src={cur.src} alt="" className="max-w-full max-h-full object-contain" />
      )}

      {/* Left/Right Tap Zones */}
      <button
        type="button"
        aria-label="Story anterior"
        onClick={() => {
          setIdx((i) => Math.max(0, i - 1));
          setProgress(0);
        }}
        className="absolute left-0 top-20 bottom-20 w-1/3 z-10"
      />
      <button
        type="button"
        aria-label="Próximo story"
        onClick={() => {
          if (idx + 1 >= stories.length) onClose();
          else {
            setIdx((i) => i + 1);
            setProgress(0);
          }
        }}
        className="absolute right-0 top-20 bottom-20 w-1/3 z-10"
      />

      {!isMine && (
        <div className="absolute bottom-4 inset-x-3 flex items-center gap-2 z-20 max-w-lg mx-auto">
          <input
            value={replyText}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && replyText.trim()) {
                onReply(replyText.trim());
                setReplyText('');
              }
            }}
            placeholder={`Responder a ${author.n.split(' ')[0]}…`}
            className="flex-1 px-4 py-2.5 rounded-full bg-white/15 border border-white/30 text-white placeholder:text-white/70 text-sm outline-none"
          />
          {['❤️', '😂', '🔥', '👏'].map((em) => (
            <button key={em} type="button" onClick={() => onReact(em)} className="text-xl px-1">
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Sticker Maker Modal ---------- */
export function StickerMakerModal({
  onClose,
  onCreateSticker,
}: {
  onClose: () => void;
  onCreateSticker: (dataUrl: string) => void;
}) {
  const [shape, setShape] = useState<'round' | 'circle' | 'sq'>('round');
  const [border, setBorder] = useState(true);
  const [text, setText] = useState('');

  const createTextSticker = () => {
    const t = text.trim();
    if (!t) return;
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 240;
    const x = c.getContext('2d')!;
    let f = 78;
    x.font = `900 ${f}px system-ui`;
    while (x.measureText(t).width > 205 && f > 18) {
      f -= 4;
      x.font = `900 ${f}px system-ui`;
    }
    const pal = ACCENT_PALETTES[0];
    const g = x.createLinearGradient(0, 0, 240, 0);
    g.addColorStop(0, pal[0]);
    g.addColorStop(1, pal[1]);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (border) {
      x.strokeStyle = '#ffffff';
      x.lineWidth = 12;
      x.strokeText(t, 120, 120);
    }
    x.fillStyle = g;
    x.fillText(t, 120, 120);
    onCreateSticker(c.toDataURL('image/png'));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
      <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Criar figurinha</h2>
          <button type="button" onClick={onClose} aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([
            ['round', 'Arredondada'],
            ['circle', 'Redonda'],
            ['sq', 'Quadrada'],
          ] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setShape(v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                shape === v ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
              }`}
            >
              {l}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setBorder((b) => !b)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
              border ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
            }`}
          >
            Borda branca
          </button>
        </div>

        <label className="block p-6 rounded-2xl border border-dashed border-[var(--line)] text-center text-sm font-semibold cursor-pointer hover:border-[var(--acc)]">
          Escolher foto da galeria
          <input
            type="file"
            hidden
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const im = new Image();
              im.onload = () => {
                onCreateSticker(buildStickerDataUrl(im, shape, border));
                onClose();
              };
              im.src = URL.createObjectURL(f);
            }}
          />
        </label>

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={16}
            placeholder="Ou figurinha com texto…"
            className="flex-1 px-3.5 py-2 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
          />
          <button
            type="button"
            onClick={createTextSticker}
            className="px-4 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ background: 'var(--grad)' }}
          >
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Safety Report Modal ---------- */
export function ReportModal({
  targetLabel,
  onClose,
  onSubmit,
}: {
  targetLabel: string;
  onClose: () => void;
  onSubmit: (reason: string, details: string) => void;
}) {
  const [reason, setReason] = useState('Spam ou golpes');
  const [details, setDetails] = useState('');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
      <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2"><Flag className="w-4 h-4 text-rose-500" /> Denunciar {targetLabel}</h2>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-1.5">
          {['Spam ou golpes', 'Assédio ou discurso de ódio', 'Conteúdo impróprio', 'Falsidade ideológica'].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-sm font-medium ${
                reason === r ? 'border-[var(--acc)] bg-[var(--bg)]' : 'border-[var(--line)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          placeholder="Detalhes adicionais (opcional)…"
          className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
        />
        <button
          type="button"
          onClick={() => onSubmit(reason, details)}
          className="w-full py-2.5 rounded-xl bg-rose-600 text-white font-semibold"
        >
          Enviar denúncia
        </button>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  Copy,
  Flag,
  Grid,
  Link2,
  Lock,
  MapPin,
  Pin,
  Plus,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import type { AppState, Highlight, Post, ProfileLink, UserProfile } from '../types/pappo';
import { ACCENT_PALETTES, CARD_GRADIENTS } from '../utils/mediaTools';
import { canSendDirectMessage, canViewProfileContent } from '../utils/socialLogic';
import { Avatar, extractHost } from './Avatar';

interface ProfileViewProps {
  state: AppState;
  profileId: string;
  usersMap: Record<string, UserProfile>;
  onFollowToggle: (userId: string) => void;
  onOpenChat: (userId: string) => void;
  onOpenPost: (postId: string) => void;
  onUpdateProfile: (patch: Partial<UserProfile>) => void;
  onUpdateNote: (text: string | null, dur?: 24 | 48) => void;
  onCreateHighlight: (hl: Highlight) => void;
  onOpenHighlight: (hl: Highlight) => void;
  onUpdateGrid: (opts: { gar?: '1' | '45'; gord?: string[]; togglePinId?: string; crop?: { id: string; cx: number; cy: number } }) => void;
  onBlockUser: (userId: string) => void;
  onReportUser: (userId: string) => void;
  onNotify: (msg: string) => void;
}

export function ProfileView({
  state,
  profileId,
  usersMap,
  onFollowToggle,
  onOpenChat,
  onOpenPost,
  onUpdateProfile,
  onUpdateNote,
  onCreateHighlight,
  onOpenHighlight,
  onUpdateGrid,
  onBlockUser,
  onReportUser,
  onNotify,
}: ProfileViewProps) {
  const isMe = profileId === 'me';
  const target: UserProfile = isMe
    ? state.me
    : usersMap[profileId] || { id: profileId, n: 'Usuário', h: 'usuario', c: ['#6d4aff', '#ff4e88'] };

  const [tab, setTab] = useState<'p' | 'r' | 's'>('p');
  const [modalMode, setModalMode] = useState<null | 'edit' | 'note' | 'grid' | 'hl'>(null);

  // Edit profile form
  const [editName, setEditName] = useState(state.me.n);
  const [editBio, setEditBio] = useState(state.me.bio || '');
  const [editLoc, setEditLoc] = useState(state.me.loc || '');
  const [editCv, setEditCv] = useState<number | null>(state.me.cv ?? null);
  const [editLinks, setEditLinks] = useState<ProfileLink[]>(state.me.links || []);

  // Note form
  const [noteTx, setNoteTx] = useState(state.me.note && state.me.note.exp > Date.now() ? state.me.note.tx : '');
  const [noteDur, setNoteDur] = useState<24 | 48>(state.me.note?.dur || 24);

  // Grid editor selection
  const [selectedGridId, setSelectedGridId] = useState<string | null>(null);

  // Highlight form
  const [hlTitle, setHlTitle] = useState('');
  const [hlSelectedIds, setHlSelectedIds] = useState<string[]>([]);

  const isBlocked = !isMe && state.blocked.includes(target.id);
  const canView = canViewProfileContent({
    viewerId: 'me',
    target,
    targetPrivacy: isMe ? state.privacy : undefined,
    followStatus: state.fol[target.id],
    blockedIds: state.blocked,
  });

  const isPriv = isMe ? state.privacy.privateProfile : Boolean(target.priv);
  const activeNote = target.note && target.note.exp > Date.now() ? target.note : null;

  const orderPosts = (list: Post[]) => {
    if (!isMe) return list;
    const gord = state.gord || [];
    return [...list].sort((a, b) => {
      if (Boolean(b.pin) !== Boolean(a.pin)) return b.pin ? 1 : -1;
      const ia = gord.indexOf(a.id);
      const ib = gord.indexOf(b.id);
      if (ia !== ib) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      return b.t - a.t;
    });
  };

  const myPosts = state.posts.filter((p) => p.u === target.id);
  const reposts = state.posts.filter((p) => (p.rp || []).includes(target.id));
  const savedPosts = isMe ? state.posts.filter((p) => p.saved.includes('me')) : [];
  const activePosts = tab === 'r' ? reposts : tab === 's' && isMe ? savedPosts : orderPosts(myPosts);

  const followersCount = isMe
    ? state.privacy.hideFollowers
      ? '—'
      : String(state.fwr.length)
    : target.hideFollowers
    ? '—'
    : String(target.fwr ?? 12);

  const followingCount = isMe
    ? state.privacy.hideFollowing
      ? '—'
      : String(Object.values(state.fol).filter((v) => v === 'ok').length)
    : target.hideFollowing
    ? '—'
    : String(target.fg ?? 8);

  const coverBg = target.covImg
    ? `url(${target.covImg}) center/cover`
    : target.cv != null && ACCENT_PALETTES[target.cv]
    ? `linear-gradient(135deg, ${ACCENT_PALETTES[target.cv][0]}, ${ACCENT_PALETTES[target.cv][1]})`
    : `linear-gradient(135deg, ${target.c[0]}, ${target.c[1]})`;

  const dmCheck = canSendDirectMessage({
    senderId: 'me',
    target,
    blockedIds: state.blocked,
  });

  const openEditModal = () => {
    setEditName(state.me.n);
    setEditBio(state.me.bio || '');
    setEditLoc(state.me.loc || '');
    setEditCv(state.me.cv ?? null);
    setEditLinks(state.me.links || []);
    setModalMode('edit');
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const im = new Image();
    im.onload = () => {
      const s = Math.min(im.naturalWidth, im.naturalHeight);
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 256;
      cv.getContext('2d')!.drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
      onUpdateProfile({ img: cv.toDataURL('image/jpeg', 0.85) });
      onNotify('Foto de perfil atualizada');
    };
    im.src = URL.createObjectURL(file);
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = 960;
      cv.height = 320;
      const s = Math.max(960 / im.naturalWidth, 320 / im.naturalHeight);
      cv.getContext('2d')!.drawImage(
        im,
        (960 - im.naturalWidth * s) / 2,
        (320 - im.naturalHeight * s) / 2,
        im.naturalWidth * s,
        im.naturalHeight * s
      );
      onUpdateProfile({ covImg: cv.toDataURL('image/jpeg', 0.82) });
      onNotify('Foto de capa carregada');
    };
    im.src = URL.createObjectURL(file);
  };

  const saveEdit = () => {
    const cleanLinks = editLinks
      .map((l) => {
        let u = l.u.trim();
        if (!u) return null;
        if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
        return { t: l.t.trim() || extractHost(u), u };
      })
      .filter(Boolean) as ProfileLink[];

    onUpdateProfile({
      n: editName.trim() || state.me.n,
      bio: editBio.trim(),
      loc: editLoc.trim(),
      cv: editCv,
      links: cleanLinks,
    });
    setModalMode(null);
    onNotify('Perfil atualizado');
  };

  const orderedOwnPosts = orderPosts(myPosts);
  const selectedGridPost = orderedOwnPosts.find((p) => p.id === selectedGridId);

  return (
    <div className="max-w-[660px] mx-auto px-3 sm:px-4 pt-4 pb-20 md:pb-12">
      {/* Cover */}
      <div className="h-36 rounded-2xl overflow-hidden" style={{ background: coverBg }} />

      {/* Header */}
      <div className="relative -mt-12 flex flex-col items-center text-center px-3 space-y-1.5">
        {activeNote && !isBlocked && (
          <div className="mb-1 px-3.5 py-1.5 rounded-2xl bg-[var(--card)] border border-[var(--line)] text-xs font-medium shadow-sm max-w-[260px]">
            {activeNote.tx}
          </div>
        )}
        <div className="rounded-full border-4 border-[var(--bg)] shadow-md">
          <Avatar user={target} size={92} />
        </div>
        <h1 className="text-xl font-display font-bold pt-1">{target.n}</h1>
        <p className="text-sm text-[var(--mut)]">@{target.h}</p>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--mut)]">
          <span className="inline-flex items-center gap-1">
            {isPriv ? <Lock className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
            {isPriv ? 'Perfil privado' : 'Perfil público'}
          </span>
          {target.loc && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {target.loc}
            </span>
          )}
          {target.since && (
            <span>
              Desde {new Date(target.since).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>

        {target.bio && !isBlocked && (
          <p className="text-sm whitespace-pre-wrap max-w-md pt-1 leading-relaxed">{target.bio}</p>
        )}

        {!isBlocked && (target.links || []).length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {target.links!.map((l, idx) => (
              <a
                key={idx}
                href={l.u}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)]"
              >
                <Link2 className="w-3.5 h-3.5 text-[var(--acc)]" />
                {l.t}
              </a>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center justify-center gap-8 py-3 font-mono-num">
          <div>
            <div className="text-lg font-bold">{myPosts.length}</div>
            <div className="text-xs text-[var(--mut)]">posts</div>
          </div>
          <div>
            <div className="text-lg font-bold">{followersCount}</div>
            <div className="text-xs text-[var(--mut)]">seguidores</div>
          </div>
          <div>
            <div className="text-lg font-bold">{followingCount}</div>
            <div className="text-xs text-[var(--mut)]">seguindo</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {isMe ? (
            <>
              <button
                type="button"
                onClick={openEditModal}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)]"
              >
                Editar perfil
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedGridId(orderedOwnPosts[0]?.id || null);
                  setModalMode('grid');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)]"
              >
                <Grid className="w-3.5 h-3.5" />
                Editar grade
              </button>
              <button
                type="button"
                onClick={() => setModalMode('note')}
                className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)]"
              >
                Nota
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(`@${state.me.h}`);
                  onNotify('@ copiado!');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)]"
              >
                <Copy className="w-3.5 h-3.5" />
                Copiar @
              </button>
            </>
          ) : (
            <>
              {!isBlocked && (
                <>
                  <button
                    type="button"
                    onClick={() => onFollowToggle(target.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold ${
                      state.fol[target.id]
                        ? 'bg-[var(--ink)] text-[var(--bg)]'
                        : 'text-white'
                    }`}
                    style={!state.fol[target.id] ? { background: 'var(--grad)' } : undefined}
                  >
                    {state.fol[target.id] === 'ok'
                      ? 'Seguindo'
                      : state.fol[target.id] === 'pend'
                      ? 'Solicitado'
                      : 'Seguir'}
                  </button>
                  <button
                    type="button"
                    disabled={!dmCheck.allowed}
                    onClick={() => onOpenChat(target.id)}
                    className="px-4 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)] disabled:opacity-50"
                  >
                    Mensagem
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onBlockUser(target.id)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-rose-500/30 text-rose-500 text-xs font-semibold"
              >
                <Ban className="w-3.5 h-3.5" />
                {isBlocked ? 'Desbloquear' : 'Bloquear'}
              </button>
              <button
                type="button"
                onClick={() => onReportUser(target.id)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[var(--line)] text-[var(--mut)] text-xs font-semibold hover:text-rose-500"
              >
                <Flag className="w-3.5 h-3.5" />
                Denunciar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Highlights */}
      {isMe && (
        <div className="flex items-center gap-3.5 overflow-x-auto no-scrollbar pt-5 pb-2">
          <button
            type="button"
            onClick={() => {
              const myStories = state.stories.filter((s) => s.u === 'me');
              setHlSelectedIds(myStories.map((s) => s.id));
              setHlTitle('');
              setModalMode('hl');
            }}
            className="flex flex-col items-center gap-1.5 w-[68px] shrink-0 text-xs"
          >
            <div className="w-14 h-14 rounded-full border border-dashed border-[var(--line)] bg-[var(--card)] grid place-items-center text-[var(--acc)]">
              <Plus className="w-5 h-5" />
            </div>
            <span className="truncate w-full text-center">Destaque</span>
          </button>

          {state.hl.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => onOpenHighlight(h)}
              className="flex flex-col items-center gap-1.5 w-[68px] shrink-0 text-xs"
            >
              <div className="p-[2px] rounded-full" style={{ background: 'var(--grad)' }}>
                <div
                  className="w-14 h-14 rounded-full border-2 border-[var(--bg)] grid place-items-center text-white font-bold overflow-hidden"
                  style={{
                    background: h.src ? `url(${h.src}) center/cover` : 'var(--grad)',
                  }}
                >
                  {!h.src && h.t.charAt(0).toUpperCase()}
                </div>
              </div>
              <span className="truncate w-full text-center">{h.t}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-center gap-2 py-4">
        {[
          { k: 'p' as const, label: 'Publicações' },
          { k: 'r' as const, label: 'Repostados' },
          ...(isMe ? [{ k: 's' as const, label: 'Salvos' }] : []),
        ].map((item) => (
          <button
            key={item.k}
            type="button"
            onClick={() => setTab(item.k)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === item.k
                ? 'bg-[var(--acc)] text-white'
                : 'bg-[var(--card)] border border-[var(--line)] text-[var(--mut)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Grid or Private / Blocked Gate */}
      {isBlocked ? (
        <div className="py-12 text-center text-sm text-[var(--mut)] space-y-2">
          <ShieldAlert className="w-7 h-7 mx-auto text-rose-500" />
          <p>Você bloqueou @{target.h}. Desbloqueie para voltar a interagir.</p>
        </div>
      ) : !canView ? (
        <div className="py-12 text-center text-sm text-[var(--mut)] space-y-2">
          <Lock className="w-7 h-7 mx-auto" />
          <p>Conta privada. Envie e aguarde a aprovação para ver publicações.</p>
        </div>
      ) : activePosts.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--mut)]">Nada por aqui ainda.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden">
          {activePosts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenPost(p.id)}
              className={`relative overflow-hidden bg-[var(--card)] ${
                state.gar === '45' ? 'aspect-[4/5]' : 'aspect-square'
              }`}
            >
              {p.type === 'image' && p.src ? (
                <img
                  src={p.src}
                  alt={p.cap || 'Publicação'}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `${p.cx ?? 50}% ${p.cy ?? 50}%` }}
                />
              ) : (
                <div
                  className="w-full h-full grid place-items-center p-2 text-white text-xs font-bold text-center"
                  style={{ background: p.type === 'text' ? CARD_GRADIENTS[p.bg || 0] : 'var(--grad)' }}
                >
                  <span className="line-clamp-3">{p.cap || (p.type === 'video' ? 'Vídeo' : 'Post')}</span>
                </div>
              )}
              {p.pin && (
                <span className="absolute top-1.5 left-1.5 p-1 rounded-md bg-black/60 text-white">
                  <Pin className="w-3 h-3" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Modal: Edit Profile */}
      {modalMode === 'edit' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] sticky top-0 bg-[var(--card)] z-10">
              <h2 className="font-bold">Editar perfil</h2>
              <button type="button" onClick={() => setModalMode(null)} aria-label="Fechar" className="w-9 h-9 rounded-full grid place-items-center">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar user={state.me} size={60} showOnline={false} />
                <label className="px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold cursor-pointer">
                  Foto de perfil
                  <input type="file" hidden accept="image/*" onChange={handleAvatarUpload} />
                </label>
                <label className="px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold cursor-pointer">
                  Foto de capa
                  <input type="file" hidden accept="image/*" onChange={handleCoverUpload} />
                </label>
                {(state.me.img || state.me.covImg) && (
                  <button
                    type="button"
                    onClick={() => onUpdateProfile({ img: undefined, covImg: undefined })}
                    className="px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold text-rose-500"
                  >
                    Limpar fotos
                  </button>
                )}
              </div>

              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={36}
                placeholder="Nome"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
              />
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Bio"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
              />
              <input
                value={editLoc}
                onChange={(e) => setEditLoc(e.target.value)}
                maxLength={40}
                placeholder="Localização (ex: Maceió, AL)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
              />

              <div className="space-y-2">
                <div className="text-xs text-[var(--mut)]">Cor da capa</div>
                <div className="flex gap-2">
                  {ACCENT_PALETTES.map((pal, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setEditCv(i)}
                      aria-label={`Cor de capa ${i + 1}`}
                      className={`w-8 h-8 rounded-full border-2 ${editCv === i ? 'border-[var(--ink)] scale-110' : 'border-transparent'}`}
                      style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Links ({editLinks.length}/10)</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (editLinks.length < 10) setEditLinks([...editLinks, { t: '', u: '' }]);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-[var(--line)] text-xs font-semibold"
                  >
                    + Adicionar
                  </button>
                </div>
                {editLinks.map((lk, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      value={lk.t}
                      onChange={(e) => {
                        const next = [...editLinks];
                        next[idx] = { ...lk, t: e.target.value };
                        setEditLinks(next);
                      }}
                      placeholder="Nome"
                      className="w-1/3 px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
                    />
                    <input
                      value={lk.u}
                      onChange={(e) => {
                        const next = [...editLinks];
                        next[idx] = { ...lk, u: e.target.value };
                        setEditLinks(next);
                      }}
                      placeholder="https://…"
                      className="flex-1 px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setEditLinks(editLinks.filter((_, i) => i !== idx))}
                      aria-label="Remover link"
                      className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={saveEdit}
                className="w-full py-3 rounded-xl text-white font-semibold"
                style={{ background: 'var(--grad)' }}
              >
                Salvar perfil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Note */}
      {modalMode === 'note' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
              <h2 className="font-bold">Nota no perfil</h2>
              <button type="button" onClick={() => setModalMode(null)} aria-label="Fechar" className="w-9 h-9 rounded-full grid place-items-center">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <textarea
                value={noteTx}
                onChange={(e) => setNoteTx(e.target.value)}
                rows={2}
                maxLength={60}
                placeholder="O que você está pensando?"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
              />
              <div className="flex gap-2">
                {([24, 48] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNoteDur(d)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold ${
                      noteDur === d ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                    }`}
                  >
                    {d}h
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!noteTx.trim()) return;
                  onUpdateNote(noteTx.trim(), noteDur);
                  setModalMode(null);
                }}
                className="w-full py-2.5 rounded-xl text-white font-semibold"
                style={{ background: 'var(--grad)' }}
              >
                Publicar nota
              </button>
              {activeNote && (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateNote(null);
                    setModalMode(null);
                  }}
                  className="w-full py-2.5 rounded-xl border border-rose-500/40 text-rose-500 text-sm font-semibold"
                >
                  Remover nota
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Grid Editor */}
      {modalMode === 'grid' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] sticky top-0 bg-[var(--card)] z-10">
              <h2 className="font-bold">Editar grade do perfil</h2>
              <button type="button" onClick={() => setModalMode(null)} aria-label="Fechar" className="w-9 h-9 rounded-full grid place-items-center">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-[var(--mut)]">
                Toque em uma publicação para reorganizar a posição, fixar até 3 no topo ou ajustar o enquadramento.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateGrid({ gar: '1' })}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                    state.gar !== '45' ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                  }`}
                >
                  Grade 1:1
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateGrid({ gar: '45' })}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                    state.gar === '45' ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                  }`}
                >
                  Grade 4:5
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 rounded-xl overflow-hidden">
                {orderedOwnPosts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedGridId(p.id)}
                    className={`relative overflow-hidden ${state.gar === '45' ? 'aspect-[4/5]' : 'aspect-square'} ${
                      selectedGridId === p.id ? 'ring-3 ring-[var(--acc)] ring-inset' : ''
                    }`}
                  >
                    {p.type === 'image' && p.src ? (
                      <img
                        src={p.src}
                        alt=""
                        className="w-full h-full object-cover"
                        style={{ objectPosition: `${p.cx ?? 50}% ${p.cy ?? 50}%` }}
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center p-2 text-white text-xs font-bold" style={{ background: 'var(--grad)' }}>
                        {p.cap.slice(0, 28)}
                      </div>
                    )}
                    {p.pin && (
                      <span className="absolute top-1 left-1 p-1 rounded bg-black/60 text-white">
                        <Pin className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {selectedGridPost && (
                <div className="p-3.5 rounded-2xl bg-[var(--bg)] border border-[var(--line)] space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const ids = orderedOwnPosts.map((p) => p.id);
                        const idx = ids.indexOf(selectedGridPost.id);
                        if (idx > 0) {
                          [ids[idx], ids[idx - 1]] = [ids[idx - 1], ids[idx]];
                          onUpdateGrid({ gord: ids });
                        }
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Mover antes
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const ids = orderedOwnPosts.map((p) => p.id);
                        const idx = ids.indexOf(selectedGridPost.id);
                        if (idx >= 0 && idx < ids.length - 1) {
                          [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
                          onUpdateGrid({ gord: ids });
                        }
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold"
                    >
                      Mover depois <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateGrid({ togglePinId: selectedGridPost.id })}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                        selectedGridPost.pin ? 'bg-[var(--ink)] text-[var(--bg)]' : 'border border-[var(--line)] bg-[var(--card)]'
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" /> {selectedGridPost.pin ? 'Desafixar' : 'Fixar no topo'}
                    </button>
                  </div>
                  {selectedGridPost.type === 'image' && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-[var(--mut)]">Enquadramento da capa</div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={selectedGridPost.cx ?? 50}
                        onChange={(e) =>
                          onUpdateGrid({
                            crop: { id: selectedGridPost.id, cx: Number(e.target.value), cy: selectedGridPost.cy ?? 50 },
                          })
                        }
                        className="w-full"
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={selectedGridPost.cy ?? 50}
                        onChange={(e) =>
                          onUpdateGrid({
                            crop: { id: selectedGridPost.id, cx: selectedGridPost.cx ?? 50, cy: Number(e.target.value) },
                          })
                        }
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Highlight */}
      {modalMode === 'hl' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
              <h2 className="font-bold">Novo Destaque</h2>
              <button type="button" onClick={() => setModalMode(null)} aria-label="Fechar" className="w-9 h-9 rounded-full grid place-items-center">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <input
                value={hlTitle}
                onChange={(e) => setHlTitle(e.target.value)}
                maxLength={18}
                placeholder="Nome do destaque (ex: Viagens)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
              />
              <div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto">
                {state.stories
                  .filter((s) => s.u === 'me')
                  .map((s) => {
                    const checked = hlSelectedIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          setHlSelectedIds((prev) =>
                            checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                          )
                        }
                        className={`relative aspect-square rounded-xl overflow-hidden border-2 ${
                          checked ? 'border-[var(--acc)]' : 'border-transparent'
                        }`}
                      >
                        {s.src ? (
                          <img src={s.src} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full grid place-items-center p-1 text-white text-xs" style={{ background: 'var(--grad)' }}>
                            {s.tx}
                          </div>
                        )}
                        {checked && (
                          <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[var(--acc)] text-white grid place-items-center">
                            <Check className="w-3 h-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
              {state.stories.some((s) => s.u === 'me') ? (
                <button
                  type="button"
                  onClick={() => {
                    const items = state.stories.filter((s) => hlSelectedIds.includes(s.id));
                    if (!items.length) return onNotify('Selecione ao menos 1 story');
                    onCreateHighlight({
                      id: `hl_${Date.now()}`,
                      t: hlTitle.trim() || 'Destaque',
                      src: items[0].src || '',
                      items,
                    });
                    setModalMode(null);
                  }}
                  className="w-full py-2.5 rounded-xl text-white font-semibold"
                  style={{ background: 'var(--grad)' }}
                >
                  Criar destaque
                </button>
              ) : (
                <p className="text-xs text-[var(--mut)] text-center">
                  Publique um story primeiro para salvar nos destaques.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  BarChart2,
  Check,
  FileText,
  Flag,
  MapPin,
  Mic,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  AppState,
  ChatMessage,
  ChatThreadConfig,
  GroupInfo,
  StickerItem,
  UserProfile,
} from '../types/pappo';
import { ACCENT_PALETTES, STICKER_EMOJIS, formatBytes } from '../utils/mediaTools';
import { canSendDirectMessage } from '../utils/socialLogic';
import { Avatar, formatHour } from './Avatar';

interface ChatViewProps {
  state: AppState;
  usersMap: Record<string, UserProfile>;
  allUsers: UserProfile[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string | null) => void;
  onSendMessage: (threadId: string, msg: Partial<ChatMessage>) => void;
  onMutateThreadMessages: (threadId: string, fn: (msgs: ChatMessage[]) => ChatMessage[]) => void;
  onUpdateThreadConfig: (threadId: string, patch: Partial<ChatThreadConfig>) => void;
  onUpsertGroup: (group: GroupInfo, sysText?: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onOpenProfile: (userId: string) => void;
  onBlockUser: (userId: string) => void;
  onReportUser: (userId: string) => void;
  onOpenStickerMaker: () => void;
  onNotify: (msg: string) => void;
}

export function ChatView({
  state,
  usersMap,
  allUsers,
  activeThreadId,
  onSelectThread,
  onSendMessage,
  onMutateThreadMessages,
  onUpdateThreadConfig,
  onUpsertGroup,
  onDeleteGroup,
  onOpenProfile,
  onBlockUser,
  onReportUser,
  onOpenStickerMaker,
  onNotify,
}: ChatViewProps) {
  const [listFilter, setListFilter] = useState<'all' | 'unread' | 'groups' | 'fav'>('all');
  const [listQuery, setListQuery] = useState('');
  const [showThreadSearch, setShowThreadSearch] = useState(false);
  const [threadQuery, setThreadQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [replyQuote, setReplyQuote] = useState('');
  const [panel, setPanel] = useState<null | 'plus' | 'stk' | 'sty'>(null);
  const [textStyle, setTextStyle] = useState('');
  const [bubbleFx, setBubbleFx] = useState('');
  const [screenFx, setScreenFx] = useState('');
  const [activeScreenBurst, setActiveScreenBurst] = useState<string>('');
  const [revealedInvisible, setRevealedInvisible] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState(false);
  const [modal, setModal] = useState<
    null | 'newGroup' | 'groupInfo' | 'chatSettings' | 'poll' | 'once' | 'loc' | 'starred' | 'forward' | 'editMsg'
  >(null);
  const [modalMsg, setModalMsg] = useState<ChatMessage | null>(null);
  const [viewOnceMsg, setViewOnceMsg] = useState<ChatMessage | null>(null);

  // Sub-form states
  const [grpName, setGrpName] = useState('');
  const [grpDesc, setGrpDesc] = useState('');
  const [grpRules, setGrpRules] = useState('');
  const [grpMembers, setGrpMembers] = useState<string[]>([]);
  const [grpNicks, setGrpNicks] = useState<Record<string, string>>({});
  const [grpAdminOnly, setGrpAdminOnly] = useState(false);
  const [grpEmoji, setGrpEmoji] = useState('✨');
  const [nickInput, setNickInput] = useState('');

  const [pollQ, setPollQ] = useState('');
  const [pollO, setPollO] = useState(['', '', '']);
  const [onceText, setOnceText] = useState('');
  const [locPlace, setLocPlace] = useState('Maceió, AL · Ponta Verde');
  const [editText, setEditText] = useState('');

  const msgsEndRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThreadId, state.chat[activeThreadId || '']?.length]);

  useEffect(() => {
    if (activeThreadId && state.ct[activeThreadId]?.unread) {
      onUpdateThreadConfig(activeThreadId, { unread: 0 });
    }
  }, [activeThreadId, state.ct, onUpdateThreadConfig]);

  const resolveUser = (id: string): UserProfile =>
    id === 'me'
      ? state.me
      : usersMap[id] || { id, n: 'Usuário', h: 'usuario', c: ['#6d4aff', '#ff4e88'] };

  const allThreads = [
    ...Object.values(state.groups).map((g) => ({
      id: g.id,
      name: g.n,
      user: { n: g.n, c: g.c, img: g.img } as UserProfile,
      isGroup: true,
      themeEmoji: g.themeEmoji,
    })),
    ...allUsers
      .filter((u) => !state.blocked.includes(u.id))
      .map((u) => ({
        id: u.id,
        name: state.ct[u.id]?.nick || u.n,
        user: u,
        isGroup: false,
        themeEmoji: '',
      })),
  ].sort((a, b) => Number(Boolean(state.ct[b.id]?.pin)) - Number(Boolean(state.ct[a.id]?.pin)));

  const filteredThreads = allThreads.filter((th) => {
    if (listQuery.trim() && !th.name.toLowerCase().includes(listQuery.trim().toLowerCase())) {
      return false;
    }
    if (listFilter === 'unread') return (state.ct[th.id]?.unread || 0) > 0;
    if (listFilter === 'groups') return th.isGroup;
    if (listFilter === 'fav') return Boolean(state.ct[th.id]?.pin);
    return true;
  });

  const activeThread = allThreads.find((t) => t.id === activeThreadId) || null;
  const activeGroup = activeThreadId ? state.groups[activeThreadId] : undefined;
  const activeCfg = (activeThreadId && state.ct[activeThreadId]) || {};
  const rawMsgs = (activeThreadId && state.chat[activeThreadId]) || [];
  const now = Date.now();
  const visibleMsgs = rawMsgs.filter((m) => !m.exp || m.exp > now);
  const pinnedMsg = [...visibleMsgs].reverse().find((m) => m.pin);

  const dmAllowed = activeThread && !activeThread.isGroup
    ? canSendDirectMessage({
        senderId: 'me',
        target: activeThread.user,
        blockedIds: state.blocked,
      })
    : { allowed: true };

  const triggerBurst = (sfx: string) => {
    if (!sfx) return;
    setActiveScreenBurst(sfx);
    window.setTimeout(() => setActiveScreenBurst(''), 2600);
  };

  const handleSend = () => {
    if (!activeThreadId) return;
    const text = inputText.trim();
    if (!text && activeCfg.quickEmoji) {
      onSendMessage(activeThreadId, {
        k: 'stk',
        tx: activeCfg.quickEmoji,
        qt: replyQuote,
        sfx: screenFx || undefined,
      });
      if (screenFx) triggerBurst(screenFx);
      setReplyQuote('');
      setScreenFx('');
      return;
    }
    if (!text) return;
    onSendMessage(activeThreadId, {
      k: 't',
      tx: text,
      qt: replyQuote,
      st: textStyle || undefined,
      fx: bubbleFx || undefined,
      sfx: screenFx || undefined,
    });
    if (screenFx) triggerBurst(screenFx);
    setInputText('');
    setReplyQuote('');
    setScreenFx('');
  };

  const handleToggleRec = async () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      setRecording(false);
      return;
    }
    if (!activeThreadId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recChunksRef.current = [];
      mr.ondataavailable = (ev) => recChunksRef.current.push(ev.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size > 600) {
          onSendMessage(activeThreadId, {
            k: 'aud',
            tx: 'Áudio gravado',
            mediaUrl: URL.createObjectURL(blob),
          });
        }
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      onNotify('Permita o uso do microfone para gravar áudio');
    }
  };

  const handleAttachFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeThreadId || !e.target.files) return;
    for (const file of [...e.target.files]) {
      if (file.size > 25_000_000) {
        onNotify('Arquivo acima do limite de 25 MB');
        continue;
      }
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('image/')) {
        onSendMessage(activeThreadId, { k: 'img', img: url, tx: file.name });
      } else if (file.type.startsWith('video/')) {
        onSendMessage(activeThreadId, { k: 'vid', mediaUrl: url, tx: file.name });
      } else {
        onSendMessage(activeThreadId, { k: 'file', mediaUrl: url, nm: file.name, sz: file.size, tx: file.name });
      }
    }
    e.target.value = '';
    setPanel(null);
  };

  const openChatSettings = () => {
    if (!activeThread) return;
    if (activeGroup) {
      setGrpName(activeGroup.n);
      setGrpDesc(activeGroup.desc);
      setGrpRules(activeGroup.rules);
      setGrpMembers(activeGroup.mem);
      setGrpNicks(activeGroup.nicks || {});
      setGrpAdminOnly(activeGroup.adminOnly);
      setGrpEmoji(activeGroup.themeEmoji || '✨');
    } else {
      setNickInput(activeCfg.nick || activeThread.user.n);
    }
    setModal('chatSettings');
  };

  const wpClass = activeCfg.wp ? `wp-${activeCfg.wp}` : '';
  const bubbleGradient =
    activeCfg.ci != null && ACCENT_PALETTES[activeCfg.ci]
      ? `linear-gradient(135deg, ${ACCENT_PALETTES[activeCfg.ci][0]}, ${ACCENT_PALETTES[activeCfg.ci][1]})`
      : 'var(--grad)';

  const burstMap: Record<string, string[]> = {
    hearts: ['💜', '❤️', '💖', '💕'],
    confetti: ['🎉', '✨', '🎊', '🥳'],
    fire: ['🔥', '💥', '⚡'],
    stars: ['⭐', '🌟', '✨'],
  };

  return (
    <div className="h-[calc(100%-56px)] md:h-full grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
      {/* Left Thread List */}
      <div
        className={`flex flex-col border-r border-[var(--line)] bg-[var(--card)] p-3.5 gap-2.5 overflow-hidden ${
          activeThreadId ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-display font-bold">Mensagens</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setModal('starred')}
              aria-label="Mensagens favoritas"
              className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)]"
            >
              <Star className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setGrpName('');
                setGrpDesc('');
                setGrpMembers(allUsers.map((u) => u.id));
                setModal('newGroup');
              }}
              aria-label="Novo grupo"
              className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)]"
            >
              <Users className="w-4 h-4" />
            </button>
          </div>
        </div>

        <input
          value={listQuery}
          onChange={(e) => setListQuery(e.target.value)}
          placeholder="Buscar conversas…"
          aria-label="Buscar conversas"
          className="px-3.5 py-2 rounded-full bg-[var(--bg)] border border-[var(--line)] text-sm outline-none focus:border-[var(--acc)]"
        />

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            ['all', 'Todas'],
            ['unread', 'Não lidas'],
            ['groups', 'Grupos'],
            ['fav', 'Fixadas'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setListFilter(k as typeof listFilter)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                listFilter === k
                  ? 'bg-[var(--acc)] text-white'
                  : 'border border-[var(--line)] text-[var(--mut)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {filteredThreads.map((th) => {
            const last = (state.chat[th.id] || []).slice(-1)[0];
            const unread = state.ct[th.id]?.unread || 0;
            const cfg = state.ct[th.id];
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => onSelectThread(th.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-colors ${
                  activeThreadId === th.id ? 'bg-[var(--bg)]' : 'hover:bg-[var(--bg)]'
                }`}
              >
                <Avatar user={th.user} size={44} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 font-semibold text-sm truncate">
                    <span className="truncate">{th.name}</span>
                    {cfg?.pin && <Pin className="w-3 h-3 text-[var(--acc)] shrink-0" />}
                  </div>
                  <div className="text-xs text-[var(--mut)] truncate">
                    {last ? last.tx || 'Mídia' : 'Iniciar conversa'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {last && <span className="text-[11px] text-[var(--mut)] font-mono-num">{formatHour(last.t)}</span>}
                  {unread > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--acc)] text-white text-[11px] font-bold grid place-items-center font-mono-num">
                      {unread}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {filteredThreads.length === 0 && (
            <p className="text-center py-8 text-xs text-[var(--mut)]">Nenhuma conversa neste filtro.</p>
          )}
        </div>
      </div>

      {/* Right Active Thread */}
      <div className={`relative flex flex-col min-h-0 bg-[var(--bg)] ${wpClass} ${activeThreadId ? 'flex' : 'hidden md:flex'}`}>
        {activeThread ? (
          <>
            {/* Thread Header */}
            <header className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[var(--line)] bg-[var(--card)] z-10">
              <button
                type="button"
                onClick={() => onSelectThread(null)}
                aria-label="Voltar para conversas"
                className="md:hidden w-9 h-9 rounded-full grid place-items-center"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => (activeGroup ? setModal('groupInfo') : onOpenProfile(activeThread.id))}
                className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
              >
                <Avatar user={activeThread.user} size={38} />
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {activeThread.name}
                    {activeThread.themeEmoji && !activeThread.name.includes(activeThread.themeEmoji)
                      ? ` ${activeThread.themeEmoji}`
                      : ''}
                  </div>
                  <div className="text-xs text-[var(--mut)] truncate">
                    {activeGroup
                      ? `${activeGroup.mem.length + 1} participantes · toque p/ detalhes`
                      : activeThread.user.on
                      ? 'online agora'
                      : 'visto recentemente'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowThreadSearch((v) => !v);
                  setThreadQuery('');
                }}
                aria-label="Buscar na conversa"
                className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)]"
              >
                <Search className="w-4 h-4" />
              </button>

              {!activeGroup && (
                <>
                  <button
                    type="button"
                    onClick={() => onBlockUser(activeThread.id)}
                    aria-label="Bloquear usuário"
                    className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:text-rose-500 hover:bg-[var(--bg)]"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReportUser(activeThread.id)}
                    aria-label="Denunciar conversa"
                    className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:text-rose-500 hover:bg-[var(--bg)]"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={openChatSettings}
                aria-label="Configurações da conversa"
                className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)]"
              >
                <Settings className="w-4 h-4" />
              </button>
            </header>

            {showThreadSearch && (
              <div className="flex items-center gap-2 px-3.5 py-2 bg-[var(--card)] border-b border-[var(--line)]">
                <input
                  value={threadQuery}
                  onChange={(e) => setThreadQuery(e.target.value)}
                  placeholder="Buscar nesta conversa…"
                  className="flex-1 px-3 py-1.5 rounded-full bg-[var(--bg)] border border-[var(--line)] text-sm outline-none"
                />
                <button type="button" onClick={() => setShowThreadSearch(false)} aria-label="Fechar busca">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {pinnedMsg && (
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--card)] border-b border-[var(--line)] text-xs">
                <Pin className="w-3.5 h-3.5 text-[var(--acc)] shrink-0" />
                <button
                  type="button"
                  onClick={() => document.getElementById(`msg-${pinnedMsg.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  className="flex-1 text-left truncate"
                >
                  <span className="font-semibold">Fixada:</span> {pinnedMsg.tx || 'Mídia'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onMutateThreadMessages(activeThreadId!, (arr) =>
                      arr.map((m) => (m.id === pinnedMsg.id ? { ...m, pin: false } : m))
                    )
                  }
                  aria-label="Desafixar mensagem"
                  className="text-[var(--mut)] hover:text-[var(--ink)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {visibleMsgs.map((m) => {
                if (m.m === 'sys') {
                  return (
                    <div key={m.id} className="text-center my-1">
                      <span className="inline-block px-3 py-1 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs text-[var(--mut)]">
                        {m.tx}
                      </span>
                    </div>
                  );
                }

                const isMe = m.m === 'me';
                const senderName =
                  activeGroup && !isMe ? activeGroup.nicks?.[m.m] || resolveUser(m.m).n : '';
                const matched =
                  threadQuery.trim() &&
                  (m.tx || '').toLowerCase().includes(threadQuery.trim().toLowerCase());

                const fxCls =
                  m.fx && Date.now() - m.t < 2500
                    ? m.fx === 'slam'
                      ? 'fx-slam'
                      : m.fx === 'loud'
                      ? 'fx-loud'
                      : m.fx === 'gentle'
                      ? 'fx-gentle'
                      : ''
                    : '';

                const totalVotes = (m.opts || []).reduce((s, o) => s + o.v.length, 0);
                const userVoted = (m.opts || []).some((o) => o.v.includes('me'));

                return (
                  <div
                    key={m.id}
                    id={`msg-${m.id}`}
                    className={`group flex flex-col max-w-[82%] ${isMe ? 'ml-auto items-end' : 'items-start'}`}
                  >
                    {m.k === 'stk' ? (
                      <div className="py-1">
                        {m.img ? (
                          <img src={m.img} alt="Figurinha" className="w-32 h-32 object-contain" />
                        ) : (
                          <div className="text-5xl leading-none">{m.tx}</div>
                        )}
                      </div>
                    ) : (
                      <div
                        className={`px-3.5 py-2.5 rounded-2xl shadow-sm break-words ${fxCls} ${
                          matched ? 'ring-2 ring-amber-400' : ''
                        } ${
                          isMe
                            ? 'text-white rounded-br-sm'
                            : 'bg-[var(--card)] border border-[var(--line)] rounded-bl-sm'
                        }`}
                        style={isMe ? { background: bubbleGradient } : undefined}
                      >
                        {senderName && (
                          <div className="text-xs font-bold text-[var(--acc)] mb-0.5">{senderName}</div>
                        )}
                        {m.qt && (
                          <div className="text-xs px-2.5 py-1 rounded-lg bg-black/10 dark:bg-white/10 mb-1.5 truncate">
                            ↩ {m.qt}
                          </div>
                        )}

                        {m.once ? (
                          m.opened ? (
                            <span className="text-xs italic opacity-75">
                              Mensagem de visualização única aberta
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                onMutateThreadMessages(activeThreadId!, (arr) =>
                                  arr.map((x) => (x.id === m.id ? { ...x, opened: true } : x))
                                );
                                setViewOnceMsg(m);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-black/15 text-xs font-semibold"
                            >
                              Ver mensagem única
                            </button>
                          )
                        ) : m.k === 'poll' && m.opts ? (
                          <div className="min-w-[220px] space-y-1.5 text-[var(--ink)]">
                            <div className="font-bold text-sm">{m.tx}</div>
                            {m.opts.map((opt, idx) => {
                              const pct = totalVotes ? Math.round((opt.v.length * 100) / totalVotes) : 0;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    onMutateThreadMessages(activeThreadId!, (arr) =>
                                      arr.map((x) => {
                                        if (x.id !== m.id || !x.opts) return x;
                                        return {
                                          ...x,
                                          opts: x.opts.map((o, i) => ({
                                            ...o,
                                            v: i === idx ? [...o.v.filter((u) => u !== 'me'), 'me'] : o.v.filter((u) => u !== 'me'),
                                          })),
                                        };
                                      })
                                    );
                                  }}
                                  className="relative w-full overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-left text-xs font-semibold flex justify-between"
                                >
                                  {userVoted && (
                                    <span
                                      className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--acc)_22%,transparent)]"
                                      style={{ width: `${pct}%` }}
                                    />
                                  )}
                                  <span className="relative z-10">{opt.t}</span>
                                  {userVoted && <span className="relative z-10 font-mono-num">{pct}%</span>}
                                </button>
                              );
                            })}
                          </div>
                        ) : m.k === 'loc' ? (
                          <div className="min-w-[190px] space-y-1">
                            <div className="h-16 rounded-xl bg-gradient-to-br from-emerald-500 to-sky-500 text-white grid place-items-center font-semibold text-xs px-2 text-center">
                              {m.place || 'Localização atual'}
                            </div>
                            <div className="text-[11px] opacity-80">Compartilhada na conversa</div>
                          </div>
                        ) : m.k === 'img' && m.img ? (
                          <img src={m.img} alt={m.tx || 'Imagem'} className="max-w-[240px] rounded-xl" />
                        ) : m.k === 'vid' && m.mediaUrl ? (
                          <video src={m.mediaUrl} controls playsInline className="max-w-[240px] rounded-xl" />
                        ) : m.k === 'aud' && m.mediaUrl ? (
                          <audio src={m.mediaUrl} controls className="max-w-[230px]" />
                        ) : m.k === 'file' && m.mediaUrl ? (
                          <a href={m.mediaUrl} download={m.nm} className="flex items-center gap-2 underline text-sm">
                            <FileText className="w-4 h-4 shrink-0" />
                            <span>
                              {m.nm} ({formatBytes(m.sz || 0)})
                            </span>
                          </a>
                        ) : (
                          <span
                            onClick={() => {
                              if (m.fx === 'invisible') {
                                setRevealedInvisible((r) => ({ ...r, [m.id]: !r[m.id] }));
                              }
                            }}
                            className={`text-sm ${m.st === 'bold' ? 'font-bold' : ''} ${
                              m.st === 'mono' ? 'font-mono-num' : ''
                            } ${m.st === 'big' ? 'text-xl font-bold' : ''} ${
                              m.fx === 'invisible' && !revealedInvisible[m.id] ? 'blur-sm cursor-pointer select-none' : ''
                            }`}
                          >
                            {m.tx}
                          </span>
                        )}

                        <div className="flex items-center justify-end gap-1.5 text-[10px] opacity-75 mt-1 font-mono-num">
                          <span>{formatHour(m.t)}</span>
                          {m.ed && <span>· editada</span>}
                          {m.star && <span>★</span>}
                          {m.pin && <span>📌</span>}
                          {isMe && <span>{m.pending ? '⏳' : m.read ? '✓✓' : '✓'}</span>}
                        </div>
                      </div>
                    )}

                    {m.rx && (
                      <span className="-mt-2 px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs shadow-sm z-10">
                        {m.rx}
                      </span>
                    )}

                    {/* Hover actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity mt-1">
                      <button
                        type="button"
                        onClick={() => setReplyQuote((m.tx || 'Mídia').slice(0, 48))}
                        className="px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs"
                        title="Responder"
                      >
                        ↩
                      </button>
                      {['❤️', '😂', '🔥', '👍'].map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() =>
                            onMutateThreadMessages(activeThreadId!, (arr) =>
                              arr.map((x) => (x.id === m.id ? { ...x, rx: x.rx === e ? '' : e } : x))
                            )
                          }
                          className="px-1.5 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs"
                        >
                          {e}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          onMutateThreadMessages(activeThreadId!, (arr) =>
                            arr.map((x) => (x.id === m.id ? { ...x, star: !x.star } : x))
                          )
                        }
                        className="px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs"
                        title="Favoritar"
                      >
                        {m.star ? '★' : '☆'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onMutateThreadMessages(activeThreadId!, (arr) =>
                            arr.map((x) => (x.id === m.id ? { ...x, pin: !x.pin } : x))
                          )
                        }
                        className="px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs"
                        title="Fixar"
                      >
                        📌
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModalMsg(m);
                          setModal('forward');
                        }}
                        className="px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs"
                        title="Encaminhar"
                      >
                        ⤴
                      </button>
                      {isMe && m.k === 't' && !m.once && (
                        <button
                          type="button"
                          onClick={() => {
                            setModalMsg(m);
                            setEditText(m.tx || '');
                            setModal('editMsg');
                          }}
                          className="px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs"
                          title="Editar"
                        >
                          ✎
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onMutateThreadMessages(activeThreadId!, (arr) => arr.filter((x) => x.id !== m.id))
                        }
                        className="px-2 py-0.5 rounded-full bg-[var(--card)] border border-[var(--line)] text-xs text-rose-500"
                        title="Apagar"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
              <div ref={msgsEndRef} />
            </div>

            {replyQuote && (
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--card)] border-t border-[var(--line)] text-xs">
                <span className="flex-1 truncate">
                  Respondendo: <b>{replyQuote}</b>
                </span>
                <button type="button" onClick={() => setReplyQuote('')} aria-label="Cancelar resposta">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Quick Panels */}
            {panel && (
              <div className="p-3 border-t border-[var(--line)] bg-[var(--card)] max-h-52 overflow-y-auto">
                {panel === 'plus' && (
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold cursor-pointer">
                      <Paperclip className="w-3.5 h-3.5" /> Foto / Vídeo / Arquivo
                      <input type="file" hidden multiple onChange={handleAttachFiles} />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setPollQ('');
                        setPollO(['', '', '']);
                        setModal('poll');
                        setPanel(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold"
                    >
                      <BarChart2 className="w-3.5 h-3.5" /> Enquete no chat
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOnceText('');
                        setModal('once');
                        setPanel(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold"
                    >
                      Visualização única
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModal('loc');
                        setPanel(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold"
                    >
                      <MapPin className="w-3.5 h-3.5" /> Localização
                    </button>
                  </div>
                )}

                {panel === 'stk' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={onOpenStickerMaker}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--acc)] text-white"
                      >
                        + Criar figurinha
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {state.stk.map((s: StickerItem) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            onSendMessage(activeThreadId!, { k: 'stk', img: s.src, tx: 'Figurinha' });
                            setPanel(null);
                          }}
                          className="p-1 rounded-xl hover:bg-[var(--bg)]"
                        >
                          <img src={s.src} alt="Figurinha" className="w-12 h-12 object-contain" />
                        </button>
                      ))}
                      {STICKER_EMOJIS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => {
                            onSendMessage(activeThreadId!, { k: 'stk', tx: em });
                            setPanel(null);
                          }}
                          className="text-2xl p-1.5 rounded-xl hover:bg-[var(--bg)]"
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {panel === 'sty' && (
                  <div className="space-y-2 text-xs">
                    <div className="text-[var(--mut)]">Estilo do texto</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ['', 'Normal'],
                        ['bold', 'Negrito'],
                        ['mono', 'Mono'],
                        ['big', 'Grande'],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTextStyle(v)}
                          className={`px-2.5 py-1 rounded-lg font-semibold ${
                            textStyle === v ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>

                    <div className="text-[var(--mut)]">Animação do balão</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ['', 'Nenhuma'],
                        ['slam', 'Impacto'],
                        ['loud', 'Vibrar'],
                        ['gentle', 'Suave'],
                        ['invisible', 'Tinta invisível'],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setBubbleFx(v)}
                          className={`px-2.5 py-1 rounded-lg font-semibold ${
                            bubbleFx === v ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>

                    <div className="text-[var(--mut)]">Efeito de tela cheia</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        ['', 'Nenhum'],
                        ['hearts', '💜 Corações'],
                        ['confetti', '🎉 Confete'],
                        ['fire', '🔥 Fogo'],
                        ['stars', '⭐ Estrelas'],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setScreenFx(v)}
                          className={`px-2.5 py-1 rounded-lg font-semibold ${
                            screenFx === v ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Composer Bar */}
            {activeGroup?.adminOnly && !(activeGroup.admins || []).includes('me') ? (
              <div className="p-3.5 text-center text-xs text-[var(--mut)] bg-[var(--card)] border-t border-[var(--line)]">
                Apenas administradores podem enviar mensagens neste grupo.
              </div>
            ) : !dmAllowed.allowed ? (
              <div className="p-3.5 text-center text-xs text-rose-500 bg-[var(--card)] border-t border-[var(--line)]">
                {dmAllowed.reason}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 p-2.5 bg-[var(--card)] border-t border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => setPanel((p) => (p === 'plus' ? null : 'plus'))}
                  aria-label="Mais recursos"
                  className="w-10 h-10 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)] shrink-0"
                >
                  <Plus className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPanel((p) => (p === 'stk' ? null : 'stk'))}
                  aria-label="Figurinhas"
                  className="w-10 h-10 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)] shrink-0"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPanel((p) => (p === 'sty' ? null : 'sty'))}
                  aria-label="Estilos e efeitos"
                  className="w-10 h-10 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)] shrink-0"
                >
                  <Sparkles className="w-5 h-5" />
                </button>
                <input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSend();
                  }}
                  placeholder={activeCfg.quickEmoji ? `Mensagem ou ${activeCfg.quickEmoji}…` : 'Mensagem…'}
                  aria-label="Digite sua mensagem"
                  className="flex-1 min-w-0 px-4 py-2 rounded-full bg-[var(--bg)] border border-[var(--line)] text-sm outline-none focus:border-[var(--acc)]"
                />
                <button
                  type="button"
                  onClick={() => void handleToggleRec()}
                  aria-label="Gravar áudio"
                  className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${
                    recording ? 'bg-rose-500 text-white' : 'text-[var(--mut)] hover:bg-[var(--bg)]'
                  }`}
                >
                  <Mic className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  aria-label="Enviar mensagem"
                  className="w-10 h-10 rounded-full grid place-items-center text-white shrink-0"
                  style={{ background: 'var(--grad)' }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Screen Burst Animation */}
            {activeScreenBurst && burstMap[activeScreenBurst] && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden z-30">
                {Array.from({ length: 20 }).map((_, i) => {
                  const arr = burstMap[activeScreenBurst];
                  return (
                    <span
                      key={i}
                      className="fall-fx absolute -top-8"
                      style={{
                        left: `${(i * 19) % 94}%`,
                        animationDelay: `${(i % 6) * 0.14}s`,
                        fontSize: `${18 + (i % 4) * 5}px`,
                      }}
                    >
                      {arr[i % arr.length]}
                    </span>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="m-auto text-center p-6 text-sm text-[var(--mut)]">
            Selecione uma conversa ou crie um grupo para começar.
          </div>
        )}
      </div>

      {/* Sub-modals */}
      {modal === 'newGroup' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
              <h2 className="font-bold">Criar novo grupo</h2>
              <button type="button" onClick={() => setModal(null)} aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <input value={grpName} onChange={(e) => setGrpName(e.target.value)} placeholder="Nome do grupo" maxLength={32} className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
              <textarea value={grpDesc} onChange={(e) => setGrpDesc(e.target.value)} rows={2} placeholder="Descrição (opcional)" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
              <div className="text-xs text-[var(--mut)]">Participantes</div>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {allUsers.map((u) => {
                  const checked = grpMembers.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setGrpMembers((prev) =>
                          checked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                        )
                      }
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--bg)]"
                    >
                      <Avatar user={u} size={32} />
                      <span className="flex-1 text-left text-sm font-medium">{u.n}</span>
                      <span className={`w-5 h-5 rounded-md grid place-items-center border ${checked ? 'bg-[var(--acc)] border-[var(--acc)] text-white' : 'border-[var(--line)]'}`}>
                        {checked && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!grpName.trim() || !grpMembers.length) return onNotify('Informe um nome e participantes');
                  const id = `g_${Date.now()}`;
                  onUpsertGroup(
                    {
                      id,
                      n: grpName.trim(),
                      desc: grpDesc.trim(),
                      rules: '',
                      themeEmoji: '✨',
                      adminOnly: false,
                      slowMode: 0,
                      disappear: 0,
                      mem: grpMembers,
                      admins: ['me'],
                      nicks: {},
                      c: ACCENT_PALETTES[Math.floor(Math.random() * ACCENT_PALETTES.length)],
                    },
                    `Você criou o grupo "${grpName.trim()}"`
                  );
                  setModal(null);
                  onSelectThread(id);
                }}
                className="w-full py-2.5 rounded-xl text-white font-semibold"
                style={{ background: 'var(--grad)' }}
              >
                Criar grupo
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'groupInfo' && activeGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-lg max-h-[88dvh] overflow-y-auto bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
              <h2 className="font-bold">Dados do Grupo</h2>
              <button type="button" onClick={() => setModal(null)} aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar user={{ n: activeGroup.n, c: activeGroup.c, img: activeGroup.img }} size={56} showOnline={false} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-lg truncate">{activeGroup.n} {activeGroup.themeEmoji}</div>
                  <div className="text-xs text-[var(--mut)]">{activeGroup.mem.length + 1} participantes</div>
                </div>
                <button type="button" onClick={openChatSettings} className="px-3 py-1.5 rounded-xl border border-[var(--line)] text-xs font-semibold">
                  Personalizar
                </button>
              </div>
              {activeGroup.desc && (
                <div className="p-3 rounded-xl bg-[var(--bg)] text-sm">
                  <div className="text-xs text-[var(--mut)] mb-1">Descrição</div>
                  {activeGroup.desc}
                </div>
              )}
              {activeGroup.rules && (
                <div className="p-3 rounded-xl bg-[var(--bg)] text-sm whitespace-pre-wrap">
                  <div className="text-xs text-[var(--mut)] mb-1">Regras</div>
                  {activeGroup.rules}
                </div>
              )}
              <div className="space-y-2">
                <div className="text-xs text-[var(--mut)]">Participantes</div>
                <div className="flex items-center gap-3 p-2 rounded-xl bg-[var(--bg)]">
                  <Avatar user={state.me} size={34} />
                  <span className="flex-1 text-sm font-semibold">{state.me.n} (Você)</span>
                  <span className="text-xs font-semibold text-[var(--acc)]">Admin</span>
                </div>
                {activeGroup.mem.map((uid) => {
                  const u = resolveUser(uid);
                  const isAdm = (activeGroup.admins || []).includes(uid);
                  return (
                    <div key={uid} className="flex items-center gap-3 p-2 rounded-xl">
                      <Avatar user={u} size={34} />
                      <span className="flex-1 text-sm font-medium">{activeGroup.nicks?.[uid] || u.n}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextAdmins = isAdm
                            ? activeGroup.admins.filter((a) => a !== uid)
                            : [...(activeGroup.admins || ['me']), uid];
                          onUpsertGroup({ ...activeGroup, admins: nextAdmins });
                        }}
                        className="px-2.5 py-1 rounded-lg border border-[var(--line)] text-xs font-semibold"
                      >
                        {isAdm ? 'Admin ✓' : 'Tornar admin'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {modal === 'chatSettings' && activeThread && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[var(--card)] rounded-3xl border border-[var(--line)] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] sticky top-0 bg-[var(--card)]">
              <h2 className="font-bold">{activeGroup ? 'Personalizar Grupo' : 'Configurar Conversa'}</h2>
              <button type="button" onClick={() => setModal(null)} aria-label="Fechar"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <input
                value={activeGroup ? grpName : nickInput}
                onChange={(e) => (activeGroup ? setGrpName(e.target.value) : setNickInput(e.target.value))}
                placeholder={activeGroup ? 'Nome do grupo' : 'Apelido do contato'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
              />

              {activeGroup && (
                <>
                  <textarea value={grpDesc} onChange={(e) => setGrpDesc(e.target.value)} rows={2} placeholder="Descrição do grupo" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
                  <textarea value={grpRules} onChange={(e) => setGrpRules(e.target.value)} rows={2} placeholder="Regras do grupo" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
                  <div className="flex flex-wrap gap-1.5">
                    {['☕', '✨', '🔥', '🎮', '💜', '🚀'].map((em) => (
                      <button key={em} type="button" onClick={() => setGrpEmoji(em)} className={`px-2.5 py-1 rounded-lg ${grpEmoji === em ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'}`}>{em}</button>
                    ))}
                  </div>
                </>
              )}

              <div>
                <div className="text-xs text-[var(--mut)] mb-1.5">Cor dos seus balões</div>
                <div className="flex gap-2">
                  {ACCENT_PALETTES.map((pal, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => onUpdateThreadConfig(activeThreadId!, { ci: i })}
                      aria-label={`Cor ${i + 1}`}
                      className={`w-8 h-8 rounded-full border-2 ${activeCfg.ci === i ? 'border-[var(--ink)] scale-110' : 'border-transparent'}`}
                      style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-[var(--mut)] mb-1.5">Papel de parede</div>
                <div className="flex flex-wrap gap-1.5">
                  {['Padrão', 'Pontos', 'Degradê', 'Aurora', 'Listras'].map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onUpdateThreadConfig(activeThreadId!, { wp: i })}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold ${(activeCfg.wp || 0) === i ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-[var(--mut)] mb-1.5">Mensagens temporárias</div>
                <div className="flex flex-wrap gap-1.5">
                  {[[0, 'Desativadas'], [15, '15 seg'], [60, '1 min'], [86400, '24 horas']].map(([sec, lbl]) => (
                    <button
                      key={String(sec)}
                      type="button"
                      onClick={() => {
                        if (activeGroup) onUpsertGroup({ ...activeGroup, disappear: Number(sec) });
                        else onUpdateThreadConfig(activeThreadId!, { disappear: Number(sec) });
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold ${(activeGroup ? activeGroup.disappear : activeCfg.disappear || 0) === Number(sec) ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'}`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {activeGroup && (
                <>
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <span className="font-semibold">Apenas admins enviam mensagens</span>
                    <input type="checkbox" checked={grpAdminOnly} onChange={(e) => setGrpAdminOnly(e.target.checked)} />
                  </label>
                  <div className="space-y-1.5">
                    <div className="text-xs text-[var(--mut)]">Apelidos dos participantes</div>
                    {activeGroup.mem.map((uid) => (
                      <div key={uid} className="flex items-center gap-2">
                        <span className="w-24 truncate text-xs">{resolveUser(uid).n.split(' ')[0]}</span>
                        <input
                          value={grpNicks[uid] || ''}
                          onChange={(e) => setGrpNicks((n) => ({ ...n, [uid]: e.target.value }))}
                          placeholder="Apelido…"
                          className="flex-1 px-3 py-1.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="font-semibold">Fixar conversa no topo</span>
                <input type="checkbox" checked={Boolean(activeCfg.pin)} onChange={(e) => onUpdateThreadConfig(activeThreadId!, { pin: e.target.checked })} />
              </label>

              <button
                type="button"
                onClick={() => {
                  if (activeGroup) {
                    onUpsertGroup({
                      ...activeGroup,
                      n: grpName.trim() || activeGroup.n,
                      desc: grpDesc.trim(),
                      rules: grpRules.trim(),
                      themeEmoji: grpEmoji,
                      adminOnly: grpAdminOnly,
                      nicks: grpNicks,
                    });
                  } else {
                    onUpdateThreadConfig(activeThreadId!, { nick: nickInput.trim() });
                  }
                  setModal(null);
                  onNotify('Configurações da conversa salvas');
                }}
                className="w-full py-2.5 rounded-xl text-white font-semibold"
                style={{ background: 'var(--grad)' }}
              >
                Salvar alterações
              </button>

              <button
                type="button"
                onClick={() => {
                  if (activeGroup) {
                    onDeleteGroup(activeGroup.id);
                    onSelectThread(null);
                  } else {
                    onMutateThreadMessages(activeThreadId!, () => []);
                  }
                  setModal(null);
                }}
                className="w-full py-2.5 rounded-xl border border-rose-500/40 text-rose-500 font-semibold flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                {activeGroup ? 'Sair e apagar grupo' : 'Limpar mensagens'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'poll' && activeThreadId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Enquete na conversa</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            <input value={pollQ} onChange={(e) => setPollQ(e.target.value)} placeholder="Pergunta…" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            {pollO.map((o, i) => (
              <input key={i} value={o} onChange={(e) => { const n = [...pollO]; n[i] = e.target.value; setPollO(n); }} placeholder={`Opção ${i + 1}`} className="w-full px-3.5 py-2 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm" />
            ))}
            <button
              type="button"
              onClick={() => {
                const opts = pollO.map((t) => t.trim()).filter(Boolean);
                if (!pollQ.trim() || opts.length < 2) return onNotify('Pergunta e 2+ opções são obrigatórias');
                onSendMessage(activeThreadId, { k: 'poll', tx: pollQ.trim(), opts: opts.map((t) => ({ t, v: [] })) });
                setModal(null);
              }}
              className="w-full py-2.5 rounded-xl text-white font-semibold"
              style={{ background: 'var(--grad)' }}
            >
              Enviar enquete
            </button>
          </div>
        </div>
      )}

      {modal === 'once' && activeThreadId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Mensagem de visualização única</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            <textarea value={onceText} onChange={(e) => setOnceText(e.target.value)} rows={3} placeholder="Digite a mensagem secreta…" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            <button
              type="button"
              onClick={() => {
                if (!onceText.trim()) return;
                onSendMessage(activeThreadId, { k: 't', tx: onceText.trim(), once: true });
                setModal(null);
              }}
              className="w-full py-2.5 rounded-xl text-white font-semibold"
              style={{ background: 'var(--grad)' }}
            >
              Enviar mensagem única
            </button>
          </div>
        </div>
      )}

      {modal === 'loc' && activeThreadId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Compartilhar localização</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            <input value={locPlace} onChange={(e) => setLocPlace(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            <button
              type="button"
              onClick={() => {
                onSendMessage(activeThreadId, { k: 'loc', tx: `📍 ${locPlace}`, place: locPlace });
                setModal(null);
              }}
              className="w-full py-2.5 rounded-xl text-white font-semibold"
              style={{ background: 'var(--grad)' }}
            >
              Enviar localização
            </button>
          </div>
        </div>
      )}

      {modal === 'editMsg' && modalMsg && activeThreadId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Editar mensagem</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            <button
              type="button"
              onClick={() => {
                if (!editText.trim()) return;
                onMutateThreadMessages(activeThreadId, (arr) =>
                  arr.map((x) => (x.id === modalMsg.id ? { ...x, tx: editText.trim(), ed: true } : x))
                );
                setModal(null);
              }}
              className="w-full py-2.5 rounded-xl text-white font-semibold"
              style={{ background: 'var(--grad)' }}
            >
              Salvar alteração
            </button>
          </div>
        </div>
      )}

      {modal === 'forward' && modalMsg && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-sm bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-2">
            <div className="flex items-center justify-between pb-2"><h2 className="font-bold">Encaminhar para</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            {allThreads.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSendMessage(t.id, { k: modalMsg.k, tx: `⤴ Encaminhada: ${modalMsg.tx || 'Mídia'}`, img: modalMsg.img });
                  setModal(null);
                  onNotify(`Encaminhada para ${t.name}`);
                }}
                className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--bg)] text-left"
              >
                <Avatar user={t.user} size={32} />
                <span className="font-medium text-sm">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {modal === 'starred' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md max-h-[80dvh] overflow-y-auto bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Mensagens favoritas</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            {Object.entries(state.chat).flatMap(([cid, arr]) =>
              arr.filter((m) => m.star).map((m) => (
                <div key={m.id} className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm">
                  <div className="text-xs text-[var(--mut)]">{state.groups[cid]?.n || resolveUser(cid).n} · {formatHour(m.t)}</div>
                  <div className="mt-1">{m.tx || 'Mídia'}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {viewOnceMsg && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-sm bg-[var(--card)] rounded-3xl border border-[var(--line)] p-6 text-center space-y-4">
            <h2 className="font-bold">Visualização única</h2>
            <p className="text-lg font-semibold py-4">{viewOnceMsg.tx}</p>
            <p className="text-xs text-[var(--mut)]">Esta mensagem foi marcada como lida e não pode ser reaberta.</p>
            <button type="button" onClick={() => setViewOnceMsg(null)} className="w-full py-2.5 rounded-xl text-white font-semibold" style={{ background: 'var(--grad)' }}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

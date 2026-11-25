import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  AccountVaultRecord,
  AppState,
  ChatMessage,
  ChatThreadConfig,
  GroupInfo,
  Highlight,
  Post,
  Story,
  UserProfile,
} from './types/pappo';
import { ACCENT_PALETTES } from './utils/mediaTools';
import { createInitialAppState, SEED_USERS } from './data/seed';
import {
  buildFullPortableSnapshot,
  generateRecoveryCredentials,
  generateSaltHex,
  hashClientSecret,
  hydrateLocalVaultFromEmbeddedOrOpfs,
  kvDel,
  kvGet,
  kvPut,
  loadAccountsMap,
  loadAccountState,
  putMediaCache,
  restorePortableSnapshot,
  saveAccountsMap,
  saveAccountState,
  syncLiveLocalSnapshot,
} from './storage/vault';
import {
  buildStandaloneAppHtml,
  extractEmbeddedSnapshotFromHtml,
  isValidPortableSnapshot,
  linkAndSaveLocalAppFile,
  type PappoPortableSnapshot,
} from './storage/selfContainedApp';
import { mergeMessagesIdempotent } from './utils/socialLogic';
import { meshClient, type MeshSnapshot } from './network/p2pClient';
import { AuthScreen } from './components/AuthScreen';
import { SidebarNav, type NavTab } from './components/SidebarNav';
import { FeedView } from './components/FeedView';
import { ExploreView } from './components/ExploreView';
import { ReelsView } from './components/ReelsView';
import { ChatView } from './components/ChatView';
import { NotificationsView } from './components/NotificationsView';
import { ProfileView } from './components/ProfileView';
import { SettingsView } from './components/SettingsView';
import { ComposerModal } from './components/ComposerModal';
import {
  PostViewerModal,
  ReportModal,
  StickerMakerModal,
  StoryViewerModal,
} from './components/ViewersAndModals';
import { Avatar } from './components/Avatar';

export default function App() {
  const [booted, setBooted] = useState(false);
  const [accounts, setAccounts] = useState<Record<string, AccountVaultRecord>>({});
  const [state, setState] = useState<AppState | null>(null);
  const [authMode, setAuthMode] = useState<'in' | 'new' | 'recover'>('in');
  const [tab, setTab] = useState<NavTab>('feed');
  const [viewProfileId, setViewProfileId] = useState<string>('me');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [composerMode, setComposerMode] = useState<'post' | 'story' | null>(null);
  const [viewerPostId, setViewerPostId] = useState<string | null>(null);
  const [storyViewer, setStoryViewer] = useState<{ authorId: string; custom?: Story[] } | null>(null);
  const [stickerMakerOpen, setStickerMakerOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: 'user' | 'post' | 'message';
    id: string;
    label: string;
  } | null>(null);
  const [editCapPost, setEditCapPost] = useState<Post | null>(null);
  const [editCapText, setEditCapText] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [mesh, setMesh] = useState<MeshSnapshot>(() => meshClient.getSnapshot());
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number>(() => Date.now());
  const [opfsActive, setOpfsActive] = useState(false);

  // Keep server auth Bearer token strictly in memory (never in localStorage)
  const authTokenRef = useRef<string | null>(null);
  const pendingSignupStateRef = useRef<AppState | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const latestStateRef = useRef<AppState | null>(null);

  const usersMap = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const u of SEED_USERS) map[u.id] = u;
    return map;
  }, []);

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(''), 2600);
  }, []);

  const persistState = useCallback((next: AppState | null) => {
    if (!next?.me?.h) return;
    latestStateRef.current = next;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      await saveAccountState(next.me.h, next);
      const res = await syncLiveLocalSnapshot(next.me.h);
      setLastAutoSavedAt(res.savedAt);
      setOpfsActive(res.opfsSaved);
      meshClient.broadcastSocialEvent({
        kind: 'state:sync',
        handle: next.me.h,
        exportedAt: res.savedAt,
      });
    }, 45);
  }, []);

  const updateState = useCallback(
    (updater: (prev: AppState) => AppState) => {
      setState((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        persistState(next);
        return next;
      });
    },
    [persistState]
  );

  // Boot accounts & active session (hydrating from embedded standalone HTML or OPFS if present)
  useEffect(() => {
    meshClient.start();
    const unsubMesh = meshClient.subscribe(setMesh);

    if (
      import.meta.env.PROD &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      window.location.protocol.startsWith('http')
    ) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const flushOnExit = () => {
      const cur = latestStateRef.current;
      if (!cur?.me?.h) return;
      void saveAccountState(cur.me.h, cur).then(() => syncLiveLocalSnapshot(cur.me.h));
    };
    window.addEventListener('pagehide', flushOnExit);
    window.addEventListener('beforeunload', flushOnExit);

    const init = async () => {
      await hydrateLocalVaultFromEmbeddedOrOpfs();
      const accs = await loadAccountsMap();
      setAccounts(accs);

      let sesHandle = await kvGet<string>('__active_session');

      // Optional ?autostart=1 quick-entry support
      if (!sesHandle && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1') {
          const demoH = 'visitante';
          if (!accs[demoH]) {
            const salt = generateSaltHex();
            const rec = generateRecoveryCredentials();
            accs[demoH] = {
              h: demoH,
              n: 'Visitante',
              salt,
              passHash: await hashClientSecret('pappo123', salt),
              recoveryKeyHash: await hashClientSecret(rec.recoveryKey, salt),
              recoveryCodesHashes: await Promise.all(rec.recoveryCodes.map((c) => hashClientSecret(c, salt))),
              createdAt: Date.now(),
            };
            await saveAccountsMap(accs);
            setAccounts({ ...accs });
          }
          sesHandle = demoH;
          await kvPut('__active_session', demoH);
        }
      }

      if (sesHandle && accs[sesHandle]) {
        const loaded = await loadAccountState(sesHandle);
        if (loaded) {
          latestStateRef.current = loaded;
          setState(loaded);
          setTab(loaded.ini || 'feed');
        } else {
          const fresh = createInitialAppState(
            {
              id: 'me',
              n: accs[sesHandle].n,
              h: sesHandle,
              c: ACCENT_PALETTES[0],
              since: accs[sesHandle].createdAt,
            },
            false
          );
          await saveAccountState(sesHandle, fresh);
          latestStateRef.current = fresh;
          setState(fresh);
          setTab(fresh.ini || 'feed');
        }
      }
      const syncRes = await syncLiveLocalSnapshot(sesHandle || null);
      setOpfsActive(syncRes.opfsSaved);
      setLastAutoSavedAt(syncRes.savedAt);
      setBooted(true);
    };

    void init();
    return () => {
      unsubMesh();
      window.removeEventListener('pagehide', flushOnExit);
      window.removeEventListener('beforeunload', flushOnExit);
    };
  }, []);

  // Configure P2P mesh client whenever session or sharing policy changes
  useEffect(() => {
    if (!state) {
      meshClient.configure({
        handle: 'offline',
        loggedIn: false,
        policy: {
          allowSharing: false,
          wifiOnly: true,
          minBatteryPct: 20,
          pauseOnThermal: true,
          pauseOnSaveData: true,
          maxBandwidthMbps: 0,
          onlyAuthorizedFiles: true,
        },
      });
      return;
    }

    meshClient.configure({
      handle: state.me.h,
      loggedIn: true,
      policy: state.sharing,
    });
  }, [state]);

  // Real-time incoming P2P / WebSocket chat & social state sync events
  useEffect(() => {
    const unsubChat = meshClient.onChatEvent((threadId, incomingMsg) => {
      updateState((prev) => {
        const existing = prev.chat[threadId] || [];
        const merged = mergeMessagesIdempotent(existing, [incomingMsg]);
        const isCurrentChat = tab === 'chat' && activeThreadId === threadId;
        const prevCfg = prev.ct[threadId] || {};
        return {
          ...prev,
          chat: { ...prev.chat, [threadId]: merged },
          ct: {
            ...prev.ct,
            [threadId]: {
              ...prevCfg,
              unread: isCurrentChat ? 0 : (prevCfg.unread || 0) + 1,
            },
          },
        };
      });
    });

    const unsubSocial = meshClient.onSocialEvent((ev) => {
      if (ev.kind === 'state:sync') {
        void loadAccountState(ev.handle).then((remote) => {
          if (!remote) return;
          setState((prev) => {
            if (!prev || prev.me.h !== ev.handle) return prev;
            return remote;
          });
        });
      } else if (ev.kind === 'post:upsert') {
        const incomingPost = ev.post as Post;
        setState((prev) => {
          if (!prev) return prev;
          if (prev.posts.some((p) => p.id === incomingPost.id)) return prev;
          return { ...prev, posts: [incomingPost, ...prev.posts] };
        });
      } else if (ev.kind === 'story:upsert') {
        const incomingStory = ev.story as Story;
        setState((prev) => {
          if (!prev) return prev;
          if (prev.stories.some((s) => s.id === incomingStory.id)) return prev;
          return { ...prev, stories: [...prev.stories, incomingStory] };
        });
      }
    });

    return () => {
      unsubChat();
      unsubSocial();
    };
  }, [updateState, tab, activeThreadId]);

  useEffect(() => {
    if (!mesh.wsConnected || !state?.offlineQueue?.length) return;
    const queue = [...state.offlineQueue];
    for (const item of queue) {
      meshClient.sendChatMessage(item.threadId, { ...item.msg, pending: false });
    }
    updateState((prev) => {
      const nextChat = { ...prev.chat };
      for (const item of queue) {
        nextChat[item.threadId] = (nextChat[item.threadId] || []).map((m) =>
          (m.clientMsgId || m.id) === (item.msg.clientMsgId || item.msg.id)
            ? { ...m, pending: false }
            : m
        );
      }
      return { ...prev, chat: nextChat, offlineQueue: [] };
    });
  }, [mesh.wsConnected, state?.offlineQueue, updateState]);

  // Apply Theme, Accent Palette, Font Size, and Reduced Motion cleanly
  useEffect(() => {
    const root = document.documentElement;
    const mediaDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const theme = state?.theme || 'auto';
    const isDark = theme === 'dark' || (theme === 'auto' && mediaDark);
    root.classList.toggle('dark', isDark);
    root.classList.toggle('rmo', Boolean(state?.perf.reduceMotion));

    const pal = ACCENT_PALETTES[state?.ac || 0] || ACCENT_PALETTES[0];
    root.style.setProperty('--acc', pal[0]);
    root.style.setProperty('--acc2', pal[1]);
    root.style.setProperty('--grad', `linear-gradient(135deg, ${pal[0]}, ${pal[1]})`);

    document.body.style.fontSize =
      state?.fs === 'p' ? '14px' : state?.fs === 'g' ? '17px' : '';
  }, [state?.theme, state?.ac, state?.fs, state?.perf.reduceMotion]);

  // Reset main content scroll position when switching primary tabs
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  // Disappearing messages sweeper
  useEffect(() => {
    if (!state || tab !== 'chat' || !activeThreadId) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const arr = state.chat[activeThreadId];
      if (!arr) return;
      if (arr.some((m) => m.exp && m.exp <= now)) {
        updateState((prev) => ({
          ...prev,
          chat: {
            ...prev.chat,
            [activeThreadId]: (prev.chat[activeThreadId] || []).filter((m) => !m.exp || m.exp > now),
          },
        }));
      }
    }, 2000);
    return () => clearInterval(id);
  }, [state, tab, activeThreadId, updateState]);

  /* ---------- Auth Handlers ---------- */
  const handleSignup = async (opts: {
    name: string;
    handle: string;
    password: string;
    privateProfile: boolean;
    verifiedContact: string;
  }) => {
    if (accounts[opts.handle]) {
      return { error: 'Esse @ já existe neste dispositivo.' };
    }

    const salt = generateSaltHex();
    const passHash = await hashClientSecret(opts.password, salt);

    let recoveryKey = '';
    let recoveryCodes: string[] = [];

    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      try {
        const resp = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
        });
        if (resp.status === 409 && resp.headers.get('content-type')?.includes('application/json')) {
          const d = (await resp.json()) as { error?: string };
          return { error: d.error || 'Esse @ já está em uso.' };
        }
        if (resp.ok && resp.headers.get('content-type')?.includes('application/json')) {
          const data = (await resp.json()) as {
            token: string;
            recoveryKey: string;
            recoveryCodes: string[];
          };
          authTokenRef.current = data.token;
          recoveryKey = data.recoveryKey;
          recoveryCodes = data.recoveryCodes;
        }
      } catch {
        // 100% browser-local operation continues seamlessly without server
      }
    }

    if (!recoveryKey) {
      const gen = generateRecoveryCredentials();
      recoveryKey = gen.recoveryKey;
      recoveryCodes = gen.recoveryCodes;
    }

    const record: AccountVaultRecord = {
      h: opts.handle,
      n: opts.name,
      salt,
      passHash,
      recoveryKeyHash: await hashClientSecret(recoveryKey, salt),
      recoveryCodesHashes: await Promise.all(recoveryCodes.map((c) => hashClientSecret(c, salt))),
      verifiedContact: opts.verifiedContact || undefined,
      createdAt: Date.now(),
    };

    const nextAccs = { ...accounts, [opts.handle]: record };
    await saveAccountsMap(nextAccs);
    setAccounts(nextAccs);

    const fresh = createInitialAppState(
      {
        id: 'me',
        n: opts.name,
        h: opts.handle,
        c: ACCENT_PALETTES[Math.floor(Math.random() * ACCENT_PALETTES.length)],
        since: Date.now(),
      },
      opts.privateProfile
    );
    await saveAccountState(opts.handle, fresh);
    await kvPut('__active_session', opts.handle);
    const res = await syncLiveLocalSnapshot(opts.handle);
    setLastAutoSavedAt(res.savedAt);
    setOpfsActive(res.opfsSaved);
    latestStateRef.current = fresh;
    pendingSignupStateRef.current = fresh;
    return { recoveryKey, recoveryCodes };
  };

  const handleLogin = async (rawHandle: string, password: string): Promise<string | null> => {
    const h = rawHandle.trim().toLowerCase().replace(/^@/, '');
    const localRec = accounts[h];

    if (localRec) {
      const check = await hashClientSecret(password, localRec.salt);
      if (check !== localRec.passHash) {
        return '@ ou senha incorretos.';
      }
    }

    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle: h, password }),
        });
        if (resp.ok && resp.headers.get('content-type')?.includes('application/json')) {
          const d = (await resp.json()) as { token: string; name: string; privateProfile: boolean };
          authTokenRef.current = d.token;
          if (!localRec) {
            const salt = generateSaltHex();
            const gen = generateRecoveryCredentials();
            const created: AccountVaultRecord = {
              h,
              n: d.name,
              salt,
              passHash: await hashClientSecret(password, salt),
              recoveryKeyHash: await hashClientSecret(gen.recoveryKey, salt),
              recoveryCodesHashes: [],
              createdAt: Date.now(),
            };
            const nextAccs = { ...accounts, [h]: created };
            await saveAccountsMap(nextAccs);
            setAccounts(nextAccs);
          }
        }
      } catch {
        // Pure browser-local auth works offline without server
      }
    }

    if (!localRec && !authTokenRef.current) {
      return 'Conta não encontrada neste dispositivo.';
    }

    let loaded = await loadAccountState(h);
    if (!loaded) {
      loaded = createInitialAppState(
        { id: 'me', n: accounts[h]?.n || h, h, c: ACCENT_PALETTES[0], since: Date.now() },
        false
      );
      await saveAccountState(h, loaded);
    }
    await kvPut('__active_session', h);
    latestStateRef.current = loaded;
    setState(loaded);
    setTab(loaded.ini || 'feed');
    return null;
  };

  const handleRecover = async (opts: {
    handle: string;
    credential: string;
    newPassword: string;
  }): Promise<string | null> => {
    const h = opts.handle.trim().toLowerCase().replace(/^@/, '');
    const cred = opts.credential.trim().toUpperCase();
    if (!h || !cred) return 'Informe o @ e a chave ou código de recuperação.';
    if (opts.newPassword.length < 6) return 'A nova senha deve ter pelo menos 6 caracteres.';

    let serverOk = false;
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      try {
        const resp = await fetch('/api/auth/recover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ handle: h, recoveryCredential: cred, newPassword: opts.newPassword }),
        });
        if (resp.ok && resp.headers.get('content-type')?.includes('application/json')) serverOk = true;
        else if (resp.status === 403 && resp.headers.get('content-type')?.includes('application/json')) {
          const d = (await resp.json()) as { error?: string };
          return d.error || 'Chave ou código de recuperação inválido.';
        }
      } catch {
        // local verification fallback
      }
    }

    const rec = accounts[h];
    if (rec) {
      const credHash = await hashClientSecret(cred, rec.salt);
      const keyMatch = credHash === rec.recoveryKeyHash;
      const codeIdx = rec.recoveryCodesHashes.indexOf(credHash);
      if (!serverOk && !keyMatch && codeIdx < 0) {
        return 'Chave ou código de recuperação inválido.';
      }
      const nextCodes = [...rec.recoveryCodesHashes];
      if (codeIdx >= 0) nextCodes.splice(codeIdx, 1);
      const updated: AccountVaultRecord = {
        ...rec,
        passHash: await hashClientSecret(opts.newPassword, rec.salt),
        recoveryCodesHashes: nextCodes,
      };
      const nextAccs = { ...accounts, [h]: updated };
      await saveAccountsMap(nextAccs);
      await syncLiveLocalSnapshot(null);
      setAccounts(nextAccs);
      notify('Senha redefinida com sucesso! Entre com sua nova senha.');
      return null;
    }

    if (!serverOk) return 'Conta não encontrada.';
    notify('Senha redefinida!');
    return null;
  };

  const handleSwitchAccount = async (targetHandle: string) => {
    if (!state || targetHandle === state.me.h) return;
    await saveAccountState(state.me.h, state);
    const nextState = await loadAccountState(targetHandle);
    await kvPut('__active_session', targetHandle);
    if (nextState) {
      latestStateRef.current = nextState;
      setState(nextState);
      setTab(nextState.ini || 'feed');
    } else if (accounts[targetHandle]) {
      const fresh = createInitialAppState(
        { id: 'me', n: accounts[targetHandle].n, h: targetHandle, c: ACCENT_PALETTES[0], since: Date.now() },
        false
      );
      await saveAccountState(targetHandle, fresh);
      setState(fresh);
      setTab('feed');
    }
    notify(`Conta alterada para @${targetHandle}`);
  };

  const handleSignOut = async () => {
    if (state) await saveAccountState(state.me.h, state);
    authTokenRef.current = null;
    await kvDel(['__active_session']);
    setState(null);
    setAuthMode('in');
  };

  const handleExportBackup = (st: AppState = state!) => {
    if (!st) return;
    const payload = {
      v: 1,
      h: st.me.h,
      acc: accounts[st.me.h],
      state: st,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pappo-${st.me.h}-backup.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    notify('Dados exportados (.json)');
  };

  const handleDeleteOrRemoveAccount = async (
    targetHandle: string,
    password: string,
    mode: 'rem' | 'del'
  ): Promise<string | null> => {
    const rec = accounts[targetHandle];
    if (!rec) return 'Conta não encontrada.';
    if (password && (await hashClientSecret(password, rec.salt)) !== rec.passHash) {
      return 'Senha incorreta.';
    }

    if (mode === 'rem' && state && state.me.h === targetHandle) {
      handleExportBackup(state);
    }

    const nextAccs = { ...accounts };
    delete nextAccs[targetHandle];
    await saveAccountsMap(nextAccs);
    setAccounts(nextAccs);
    await kvDel([`acct:${targetHandle}`]);

    if (state?.me.h === targetHandle) {
      await kvDel(['__active_session']);
      setState(null);
      authTokenRef.current = null;
    }
    notify(mode === 'del' ? 'Conta excluída permanentemente' : 'Conta removida deste aparelho');
    return null;
  };

  /* ---------- Social & Messaging Handlers ---------- */
  const handleFollowToggle = (userId: string) => {
    updateState((prev) => {
      const nextFol = { ...prev.fol };
      const cur = nextFol[userId];
      if (cur) {
        delete nextFol[userId];
        return { ...prev, fol: nextFol };
      }
      const u = usersMap[userId];
      if (u?.priv) {
        nextFol[userId] = 'pend';
        window.setTimeout(() => {
          updateState((p2) => {
            if (p2.fol[userId] !== 'pend') return p2;
            return {
              ...p2,
              fol: { ...p2.fol, [userId]: 'ok' },
              nt: [{ id: `n_${Date.now()}`, type: 'acc', u: userId, t: Date.now(), r: false }, ...p2.nt],
            };
          });
          notify(`${u.n} aceitou sua solicitação`);
        }, 2200);
      } else {
        nextFol[userId] = 'ok';
      }
      return { ...prev, fol: nextFol };
    });
  };

  const togglePostArray = (postId: string, field: 'likes' | 'saved' | 'rp') => {
    updateState((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => {
        if (p.id !== postId) return p;
        const arr = p[field] || [];
        const has = arr.includes('me');
        return {
          ...p,
          [field]: has ? arr.filter((x) => x !== 'me') : [...arr, 'me'],
        };
      }),
    }));
  };

  const handleSendChatMessage = (threadId: string, partial: Partial<ChatMessage>) => {
    if (!state) return;
    const g = state.groups[threadId];
    const cfg = state.ct[threadId];
    const disappear = g?.disappear || cfg?.disappear || 0;
    const clientMsgId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const msg: ChatMessage = {
      id: clientMsgId,
      clientMsgId,
      m: 'me',
      k: 't',
      t: Date.now(),
      exp: disappear ? Date.now() + disappear * 1000 : 0,
      pending: !mesh.wsConnected,
      ...partial,
    };

    const delivered = meshClient.sendChatMessage(threadId, msg);

    updateState((prev) => ({
      ...prev,
      chat: {
        ...prev.chat,
        [threadId]: mergeMessagesIdempotent(prev.chat[threadId] || [], [{ ...msg, pending: !delivered }]),
      },
      offlineQueue: delivered ? prev.offlineQueue : [...prev.offlineQueue, { threadId, msg }],
    }));
  };

  const handleSubmitReport = async (reason: string, details: string) => {
    if (!reportTarget) return;
    try {
      await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authTokenRef.current ? { Authorization: `Bearer ${authTokenRef.current}` } : {}),
        },
        body: JSON.stringify({ targetType: reportTarget.type, targetId: reportTarget.id, reason }),
      });
    } catch {
      // recorded locally as well
    }
    updateState((prev) => ({
      ...prev,
      reports: [
        {
          id: `rep_${Date.now()}`,
          targetType: reportTarget.type,
          targetId: reportTarget.id,
          reason,
          details,
          t: Date.now(),
        },
        ...prev.reports,
      ],
    }));
    setReportTarget(null);
    notify('Denúncia registrada. Obrigado por ajudar a manter o Pappo seguro.');
  };

  if (!booted) {
    return (
      <div className="h-full grid place-items-center bg-[var(--bg)] text-sm text-[var(--mut)]">
        Carregando Pappo…
      </div>
    );
  }

  if (!state) {
    return (
      <>
        <AuthScreen
          accounts={accounts}
          initialMode={authMode}
          onLogin={handleLogin}
          onSignup={handleSignup}
          onCompleteSignup={() => {
            if (pendingSignupStateRef.current) {
              setState(pendingSignupStateRef.current);
              setTab('feed');
              pendingSignupStateRef.current = null;
            }
          }}
          onRecover={handleRecover}
          onRemoveAccount={(h) => handleDeleteOrRemoveAccount(h, '', 'rem').then(() => {})}
          onRestoreBackup={async (payload) => {
            if (isValidPortableSnapshot(payload)) {
              await restorePortableSnapshot(payload);
              const nextAccs = await loadAccountsMap();
              setAccounts(nextAccs);
              notify('Aplicativo e contas restaurados localmente! Entre com sua senha.');
              return null;
            }
            if (!payload?.v || !payload.h || !payload.acc || !payload.state) return 'Backup inválido.';
            const nextAccs = { ...accounts, [payload.h]: payload.acc };
            await saveAccountsMap(nextAccs);
            await saveAccountState(payload.h, payload.state);
            await syncLiveLocalSnapshot(null);
            setAccounts(nextAccs);
            notify('Backup restaurado! Entre com sua senha.');
            return null;
          }}
        />
        {toastMsg && (
          <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold shadow-lg">
            {toastMsg}
          </div>
        )}
      </>
    );
  }

  const unreadChat = Object.values(state.ct).reduce((s, x) => s + (x.unread || 0), 0);
  const unreadNotif = state.reqs.length + state.nt.filter((n) => !n.r).length;
  const suggestions = SEED_USERS.filter(
    (u) => !state.blocked.includes(u.id) && (!state.fol[u.id] || state.fol[u.id] === 'pend')
  );
  const showRightRail = !state.perf.hideSuggestions && ['feed', 'ex', 'me', 'pr'].includes(tab);
  const viewerPost = viewerPostId ? state.posts.find((p) => p.id === viewerPostId) : null;

  return (
    <div className="h-full flex flex-col md:flex-row bg-[var(--bg)] text-[var(--ink)] overflow-hidden">
      <SidebarNav
        active={tab}
        unreadChat={unreadChat}
        unreadNotif={unreadNotif}
        hideMobileTopBar={tab === 'chat' && Boolean(activeThreadId)}
        onNavigate={(nextTab) => {
          if (tab === 'nt') {
            updateState((prev) => ({ ...prev, nt: prev.nt.map((n) => ({ ...n, r: true })) }));
          }
          if (nextTab === 'me') setViewProfileId('me');
          setTab(nextTab);
        }}
        onCreate={() => setComposerMode('post')}
      />

      <main ref={mainRef} className="flex-1 min-w-0 h-full overflow-y-auto">
        {tab === 'feed' && (
          <FeedView
            state={state}
            usersMap={usersMap}
            suggestions={suggestions}
            onCellular={mesh.localTelemetry.onCellular}
            saveData={mesh.localTelemetry.saveData || state.perf.batteryDataSaver}
            onOpenProfile={(id) => {
              setViewProfileId(id);
              setTab(id === 'me' ? 'me' : 'pr');
            }}
            onFollowToggle={handleFollowToggle}
            onLike={(id) => togglePostArray(id, 'likes')}
            onSave={(id) => {
              const wasSaved = state.posts.find((p) => p.id === id)?.saved.includes('me');
              togglePostArray(id, 'saved');
              notify(wasSaved ? 'Removido dos salvos' : 'Salvo');
            }}
            onRepost={(id) => {
              const wasRp = state.posts.find((p) => p.id === id)?.rp.includes('me');
              togglePostArray(id, 'rp');
              notify(wasRp ? 'Repost removido' : 'Repostado');
            }}
            onVotePoll={(postId, idx) =>
              updateState((prev) => ({
                ...prev,
                posts: prev.posts.map((p) => {
                  if (p.id !== postId || !p.opts) return p;
                  return {
                    ...p,
                    opts: p.opts.map((o, i) => ({
                      ...o,
                      v: i === idx ? [...o.v.filter((u) => u !== 'me'), 'me'] : o.v.filter((u) => u !== 'me'),
                    })),
                  };
                }),
              }))
            }
            onOpenViewer={(id) => setViewerPostId(id)}
            onEditCaption={(id) => {
              const p = state.posts.find((x) => x.id === id);
              if (p) {
                setEditCapPost(p);
                setEditCapText(p.cap);
              }
            }}
            onDeletePost={(id) => {
              updateState((prev) => ({ ...prev, posts: prev.posts.filter((p) => p.id !== id) }));
              notify('Publicação apagada');
            }}
            onSharePost={async (id) => {
              const p = state.posts.find((x) => x.id === id);
              if (!p) return;
              const txt = `${p.u === 'me' ? state.me.n : usersMap[p.u]?.n || 'Pappo'}: ${p.cap}`;
              try {
                if (navigator.share) await navigator.share({ title: 'Pappo', text: txt });
                else {
                  await navigator.clipboard.writeText(txt);
                  notify('Link/texto copiado!');
                }
              } catch {
                // ignore cancelled share
              }
            }}
            onReportPost={(id) => setReportTarget({ type: 'post', id, label: 'publicação' })}
            onTagClick={(tag) => {
              setExploreQuery(tag);
              setTab('ex');
            }}
            onMentionClick={(h) => {
              const found = SEED_USERS.find((u) => u.h === h);
              if (found) {
                setViewProfileId(found.id);
                setTab('pr');
              } else if (h === state.me.h) {
                setViewProfileId('me');
                setTab('me');
              }
            }}
            onOpenStory={(uid) => setStoryViewer({ authorId: uid })}
            onNewStory={() => setComposerMode('story')}
            onHideSuggestions={() =>
              updateState((prev) => ({ ...prev, perf: { ...prev.perf, hideSuggestions: true } }))
            }
          />
        )}

        {tab === 'ex' && (
          <ExploreView
            state={state}
            usersMap={usersMap}
            allUsers={SEED_USERS}
            query={exploreQuery}
            onQueryChange={setExploreQuery}
            onOpenProfile={(id) => {
              setViewProfileId(id);
              setTab(id === 'me' ? 'me' : 'pr');
            }}
            onFollowToggle={handleFollowToggle}
            onOpenPost={(id) => setViewerPostId(id)}
          />
        )}

        {tab === 'reels' && (
          <ReelsView
            state={state}
            usersMap={usersMap}
            onCellular={mesh.localTelemetry.onCellular}
            saveData={mesh.localTelemetry.saveData || state.perf.batteryDataSaver}
            onCreateReel={() => setComposerMode('post')}
            onLike={(id) => togglePostArray(id, 'likes')}
            onOpenViewer={(id) => setViewerPostId(id)}
            onOpenProfile={(id) => {
              setViewProfileId(id);
              setTab(id === 'me' ? 'me' : 'pr');
            }}
          />
        )}

        {tab === 'chat' && (
          <ChatView
            state={state}
            usersMap={usersMap}
            allUsers={SEED_USERS}
            activeThreadId={activeThreadId}
            onSelectThread={setActiveThreadId}
            onSendMessage={handleSendChatMessage}
            onMutateThreadMessages={(tid, fn) =>
              updateState((prev) => ({
                ...prev,
                chat: { ...prev.chat, [tid]: fn(prev.chat[tid] || []) },
              }))
            }
            onUpdateThreadConfig={(tid, patch) =>
              updateState((prev) => ({
                ...prev,
                ct: { ...prev.ct, [tid]: { ...(prev.ct[tid] || {}), ...patch } },
              }))
            }
            onUpsertGroup={(grp: GroupInfo, sysText?: string) =>
              updateState((prev) => ({
                ...prev,
                groups: { ...prev.groups, [grp.id]: grp },
                chat: sysText
                  ? {
                      ...prev.chat,
                      [grp.id]: [
                        ...(prev.chat[grp.id] || []),
                        { id: `sys_${Date.now()}`, m: 'sys', k: 't', tx: sysText, t: Date.now() },
                      ],
                    }
                  : prev.chat,
              }))
            }
            onDeleteGroup={(gid) =>
              updateState((prev) => {
                const nextGroups = { ...prev.groups };
                const nextChat = { ...prev.chat };
                delete nextGroups[gid];
                delete nextChat[gid];
                return { ...prev, groups: nextGroups, chat: nextChat };
              })
            }
            onOpenProfile={(id) => {
              setViewProfileId(id);
              setTab('pr');
            }}
            onBlockUser={(uid) => {
              updateState((prev) => {
                const isB = prev.blocked.includes(uid);
                return {
                  ...prev,
                  blocked: isB ? prev.blocked.filter((x) => x !== uid) : [...prev.blocked, uid],
                };
              });
              notify('Lista de bloqueios atualizada');
            }}
            onReportUser={(uid) => setReportTarget({ type: 'user', id: uid, label: 'usuário' })}
            onOpenStickerMaker={() => setStickerMakerOpen(true)}
            onNotify={notify}
          />
        )}

        {tab === 'nt' && (
          <NotificationsView
            state={state}
            usersMap={usersMap}
            onAcceptFollow={(uid) => {
              updateState((prev) => ({
                ...prev,
                reqs: prev.reqs.filter((x) => x !== uid),
                fwr: prev.fwr.includes(uid) ? prev.fwr : [...prev.fwr, uid],
                nt: [{ id: `n_${Date.now()}`, type: 'fw', u: uid, t: Date.now(), r: true }, ...prev.nt],
              }));
              notify('Solicitação aceita');
            }}
            onDeclineFollow={(uid) =>
              updateState((prev) => ({ ...prev, reqs: prev.reqs.filter((x) => x !== uid) }))
            }
            onOpenProfile={(id) => {
              setViewProfileId(id);
              setTab('pr');
            }}
          />
        )}

        {(tab === 'me' || tab === 'pr') && (
          <ProfileView
            state={state}
            profileId={tab === 'me' ? 'me' : viewProfileId}
            usersMap={usersMap}
            onFollowToggle={handleFollowToggle}
            onOpenChat={(uid) => {
              setActiveThreadId(uid);
              setTab('chat');
            }}
            onOpenPost={(pid) => setViewerPostId(pid)}
            onUpdateProfile={(patch) => {
              updateState((prev) => {
                const nextMe = { ...prev.me, ...patch };
                const rec = accounts[prev.me.h];
                if (rec && patch.n) {
                  const nextAccs = { ...accounts, [prev.me.h]: { ...rec, n: patch.n } };
                  setAccounts(nextAccs);
                  void saveAccountsMap(nextAccs);
                }
                return { ...prev, me: nextMe };
              });
            }}
            onUpdateNote={(text, dur = 24) =>
              updateState((prev) => ({
                ...prev,
                me: {
                  ...prev.me,
                  note: text ? { tx: text, dur, exp: Date.now() + dur * 3_600_000 } : null,
                },
              }))
            }
            onCreateHighlight={(hl: Highlight) => {
              updateState((prev) => ({ ...prev, hl: [...prev.hl, hl] }));
              notify('Destaque criado!');
            }}
            onOpenHighlight={(hl: Highlight) => setStoryViewer({ authorId: 'me', custom: hl.items })}
            onUpdateGrid={(opts) => {
              updateState((prev) => {
                let nextPosts = prev.posts;
                if (opts.togglePinId) {
                  const target = prev.posts.find((p) => p.id === opts.togglePinId);
                  if (target && !target.pin && prev.posts.filter((p) => p.u === 'me' && p.pin).length >= 3) {
                    notify('Máximo de 3 posts fixados');
                    return prev;
                  }
                  nextPosts = prev.posts.map((p) =>
                    p.id === opts.togglePinId ? { ...p, pin: !p.pin } : p
                  );
                }
                if (opts.crop) {
                  nextPosts = prev.posts.map((p) =>
                    p.id === opts.crop!.id ? { ...p, cx: opts.crop!.cx, cy: opts.crop!.cy } : p
                  );
                }
                return {
                  ...prev,
                  gar: opts.gar ?? prev.gar,
                  gord: opts.gord ?? prev.gord,
                  posts: nextPosts,
                };
              });
            }}
            onBlockUser={(uid) => {
              updateState((prev) => {
                const isB = prev.blocked.includes(uid);
                return {
                  ...prev,
                  blocked: isB ? prev.blocked.filter((x) => x !== uid) : [...prev.blocked, uid],
                };
              });
              notify('Bloqueio atualizado');
            }}
            onReportUser={(uid) => setReportTarget({ type: 'user', id: uid, label: 'perfil' })}
            onNotify={notify}
          />
        )}

        {tab === 'set' && (
          <SettingsView
            state={state}
            accounts={accounts}
            usersMap={usersMap}
            mesh={mesh}
            lastAutoSavedAt={lastAutoSavedAt}
            opfsActive={opfsActive}
            onUpdateState={updateState}
            onSwitchAccount={(h) => void handleSwitchAccount(h)}
            onAddAccount={() => {
              setAuthMode('new');
              void handleSignOut();
            }}
            onSignOut={() => void handleSignOut()}
            onChangePassword={async (oldPw, newPw) => {
              const rec = accounts[state.me.h];
              if (!rec || (await hashClientSecret(oldPw, rec.salt)) !== rec.passHash) {
                return 'Senha atual incorreta.';
              }
              if (newPw.length < 6) return 'A nova senha deve ter 6+ caracteres.';
              const nextRec = { ...rec, passHash: await hashClientSecret(newPw, rec.salt) };
              const nextAccs = { ...accounts, [state.me.h]: nextRec };
              await saveAccountsMap(nextAccs);
              await syncLiveLocalSnapshot(state.me.h);
              setAccounts(nextAccs);
              notify('Senha atualizada!');
              return null;
            }}
            onRegenerateRecovery={async () => {
              const rec = accounts[state.me.h];
              const creds = generateRecoveryCredentials();
              if (rec) {
                const nextRec: AccountVaultRecord = {
                  ...rec,
                  recoveryKeyHash: await hashClientSecret(creds.recoveryKey, rec.salt),
                  recoveryCodesHashes: await Promise.all(
                    creds.recoveryCodes.map((c) => hashClientSecret(c, rec.salt))
                  ),
                };
                const nextAccs = { ...accounts, [state.me.h]: nextRec };
                await saveAccountsMap(nextAccs);
                await syncLiveLocalSnapshot(state.me.h);
                setAccounts(nextAccs);
              }
              return creds;
            }}
            onExportBackup={() => handleExportBackup(state)}
            onDownloadStandaloneApp={async () => {
              await saveAccountState(state.me.h, state);
              const snap = await buildFullPortableSnapshot(state.me.h);
              const html = await buildStandaloneAppHtml(snap);
              const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `pappo-local-${state.me.h}.html`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              notify('App completo auto-contido (.html) baixado com seus dados!');
            }}
            onLinkLocalAppFile={async () => {
              try {
                await saveAccountState(state.me.h, state);
                const snap = await buildFullPortableSnapshot(state.me.h);
                const name = await linkAndSaveLocalAppFile(snap);
                if (name) {
                  notify(`Auto-save em tempo real vinculado a "${name}"!`);
                }
              } catch {
                notify('Seleção de arquivo cancelada ou não suportada neste navegador.');
              }
            }}
            onImportAppFile={async (file) => {
              try {
                const text = await file.text();
                let snap: PappoPortableSnapshot | null = null;
                if (file.name.toLowerCase().endsWith('.html') || text.trimStart().startsWith('<')) {
                  snap = extractEmbeddedSnapshotFromHtml(text);
                } else {
                  const parsed = JSON.parse(text);
                  if (isValidPortableSnapshot(parsed)) snap = parsed;
                  else if (parsed?.h && parsed?.acc && parsed?.state) {
                    snap = {
                      v: 2,
                      exportedAt: Date.now(),
                      activeHandle: parsed.h,
                      accounts: { ...accounts, [parsed.h]: parsed.acc },
                      states: { [parsed.h]: parsed.state },
                    };
                  }
                }
                if (!snap) {
                  notify('Arquivo não contém dados válidos do Pappo.');
                  return;
                }
                await restorePortableSnapshot(snap);
                const nextAccs = await loadAccountsMap();
                setAccounts(nextAccs);
                const targetHandle = snap.activeHandle || state.me.h;
                const nextSt = await loadAccountState(targetHandle);
                if (nextSt) {
                  latestStateRef.current = nextSt;
                  setState(nextSt);
                }
                notify('Dados importados e salvos localmente!');
              } catch {
                notify('Não foi possível importar este arquivo.');
              }
            }}
            onDeleteAccount={handleDeleteOrRemoveAccount}
            onTestFailover={() => {
              meshClient.simulateFailoverTest();
              notify('Rota P2P verificada e otimizada');
            }}
            onNotify={notify}
          />
        )}
      </main>

      {/* Desktop Right Rail (Suggestions & Hybrid Route Overview) */}
      {showRightRail && (
        <aside className="hidden xl:flex flex-col w-80 shrink-0 border-l border-[var(--line)] bg-[var(--bg)] p-5 gap-6 overflow-y-auto">
          <button
            type="button"
            onClick={() => {
              setViewProfileId('me');
              setTab('me');
            }}
            className="flex items-center gap-3 text-left"
          >
            <Avatar user={state.me} size={46} />
            <div className="min-w-0">
              <div className="font-bold text-sm truncate">{state.me.n}</div>
              <div className="text-xs text-[var(--mut)] truncate">@{state.me.h}</div>
            </div>
          </button>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
              Sugestões para você
            </h3>
            {suggestions.length === 0 ? (
              <p className="text-xs text-[var(--mut)]">Você já segue todas as sugestões!</p>
            ) : (
              suggestions.slice(0, 4).map((u) => {
                const st = state.fol[u.id];
                return (
                  <div key={u.id} className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setViewProfileId(u.id);
                        setTab('pr');
                      }}
                    >
                      <Avatar user={u} size={38} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{u.n}</div>
                      <div className="text-xs text-[var(--mut)] truncate">@{u.h}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleFollowToggle(u.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap ${
                        st ? 'bg-[var(--ink)] text-[var(--bg)]' : 'border border-[var(--line)] bg-[var(--card)]'
                      }`}
                    >
                      {st === 'ok' ? 'Seguindo' : st === 'pend' ? 'Solicitado' : 'Seguir'}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-auto p-4 rounded-2xl bg-[var(--card)] border border-[var(--line)] space-y-2 text-xs">
            <div className="font-semibold text-[var(--ink)]">Distribuição híbrida ativa</div>
            <div className="text-[var(--mut)]">Rota atual: {mesh.activeRouteLabel}</div>
            <button
              type="button"
              onClick={() => setTab('set')}
              className="text-[var(--acc)] font-semibold hover:underline"
            >
              Configurar rede e cache
            </button>
          </div>
        </aside>
      )}

      {/* Composer Modal */}
      {composerMode && (
        <ComposerModal
          mode={composerMode}
          defaultQuality={
            mesh.localTelemetry.onCellular ? state.perf.mobileQuality : state.perf.wifiQuality
          }
          authToken={authTokenRef.current}
          onClose={() => setComposerMode(null)}
          onPublishPost={(post) => {
            if (post.src && post.src.startsWith('data:')) {
              void putMediaCache(post.id, post.src, post.quality || 'media', state.perf.cacheLimitMb);
            }
            updateState((prev) => ({ ...prev, posts: [post, ...prev.posts] }));
            meshClient.broadcastSocialEvent({ kind: 'post:upsert', handle: state.me.h, post });
            if (post.reel) setTab('reels');
            else setTab('feed');
            mainRef.current?.scrollTo({ top: 0 });
            notify('Publicado e salvo localmente!');
          }}
          onPublishStory={(storyItem) => {
            updateState((prev) => ({ ...prev, stories: [...prev.stories, storyItem] }));
            meshClient.broadcastSocialEvent({ kind: 'story:upsert', handle: state.me.h, story: storyItem });
            notify('Story publicado e salvo localmente!');
          }}
          onNotify={notify}
        />
      )}

      {/* Post Viewer */}
      {viewerPost && (
        <PostViewerModal
          post={viewerPost}
          usersMap={usersMap}
          me={state.me}
          onClose={() => setViewerPostId(null)}
          onAddComment={(postId, text) =>
            updateState((prev) => ({
              ...prev,
              posts: prev.posts.map((p) =>
                p.id === postId
                  ? { ...p, cm: [...p.cm, { id: `cm_${Date.now()}`, u: 'me', tx: text, t: Date.now() }] }
                  : p
              ),
            }))
          }
          onCellular={mesh.localTelemetry.onCellular}
          saveData={mesh.localTelemetry.saveData || state.perf.batteryDataSaver}
          cacheLimitMb={state.perf.cacheLimitMb}
        />
      )}

      {/* Story Viewer */}
      {storyViewer && (
        <StoryViewerModal
          stories={
            storyViewer.custom ||
            state.stories.filter((s) => s.u === storyViewer.authorId && s.exp > Date.now())
          }
          author={storyViewer.authorId === 'me' ? state.me : usersMap[storyViewer.authorId] || state.me}
          isMine={storyViewer.authorId === 'me' && !storyViewer.custom}
          onClose={() => setStoryViewer(null)}
          onMarkSeen={(sid) =>
            updateState((prev) => ({
              ...prev,
              stories: prev.stories.map((s) =>
                s.id === sid && !s.seen.includes('me') ? { ...s, seen: [...s.seen, 'me'] } : s
              ),
            }))
          }
          onDeleteStory={(sid) => {
            updateState((prev) => ({ ...prev, stories: prev.stories.filter((s) => s.id !== sid) }));
            setStoryViewer(null);
            notify('Story apagado');
          }}
          onReact={(em) => {
            handleSendChatMessage(storyViewer.authorId, { k: 't', tx: `Reagiu ao seu story ${em}` });
            notify(`${em} enviado`);
          }}
          onReply={(tx) => {
            handleSendChatMessage(storyViewer.authorId, { k: 't', tx: `Respondeu ao story: ${tx}` });
            notify('Resposta enviada');
          }}
        />
      )}

      {/* Edit Caption Modal */}
      {editCapPost && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">Editar legenda</h2>
              <button type="button" onClick={() => setEditCapPost(null)}><X className="w-5 h-5" /></button>
            </div>
            <textarea
              value={editCapText}
              onChange={(e) => setEditCapText(e.target.value)}
              rows={4}
              maxLength={280}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
            />
            <button
              type="button"
              onClick={() => {
                updateState((prev) => ({
                  ...prev,
                  posts: prev.posts.map((p) =>
                    p.id === editCapPost.id ? { ...p, cap: editCapText.trim() } : p
                  ),
                }));
                setEditCapPost(null);
                notify('Legenda atualizada');
              }}
              className="w-full py-2.5 rounded-xl text-white font-semibold"
              style={{ background: 'var(--grad)' }}
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* Sticker Maker */}
      {stickerMakerOpen && (
        <StickerMakerModal
          onClose={() => setStickerMakerOpen(false)}
          onCreateSticker={(src) => {
            updateState((prev) => ({
              ...prev,
              stk: [{ id: `stk_${Date.now()}`, src }, ...prev.stk],
            }));
            notify('Figurinha criada!');
          }}
        />
      )}

      {/* Report Modal */}
      {reportTarget && (
        <ReportModal
          targetLabel={reportTarget.label}
          onClose={() => setReportTarget(null)}
          onSubmit={(reason, details) => void handleSubmitReport(reason, details)}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div
          role="status"
          className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-[var(--ink)] text-[var(--bg)] text-sm font-semibold shadow-lg whitespace-nowrap"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}

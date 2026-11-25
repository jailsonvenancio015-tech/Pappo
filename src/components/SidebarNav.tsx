import React from 'react';
import { Bell, Compass, Film, Home, MessageCircle, Plus, Settings, User } from 'lucide-react';

export type NavTab = 'feed' | 'ex' | 'reels' | 'chat' | 'nt' | 'me' | 'pr' | 'set';

interface SidebarNavProps {
  active: NavTab;
  unreadChat: number;
  unreadNotif: number;
  hideMobileTopBar?: boolean;
  onNavigate: (tab: NavTab) => void;
  onCreate: () => void;
}

export function SidebarNav({
  active,
  unreadChat,
  unreadNotif,
  hideMobileTopBar = false,
  onNavigate,
  onCreate,
}: SidebarNavProps) {
  const items: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'feed', label: 'Início', icon: <Home className="w-5 h-5" /> },
    { id: 'ex', label: 'Explorar', icon: <Compass className="w-5 h-5" /> },
    { id: 'reels', label: 'Reels', icon: <Film className="w-5 h-5" /> },
    { id: 'chat', label: 'Mensagens', icon: <MessageCircle className="w-5 h-5" />, badge: unreadChat },
    { id: 'nt', label: 'Notificações', icon: <Bell className="w-5 h-5" />, badge: unreadNotif },
    { id: 'me', label: 'Perfil', icon: <User className="w-5 h-5" /> },
    { id: 'set', label: 'Ajustes', icon: <Settings className="w-5 h-5" /> },
  ];

  const mobileTabs: Array<{ id: NavTab | 'create'; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'feed', label: 'Início', icon: <Home className="w-5 h-5" /> },
    { id: 'ex', label: 'Explorar', icon: <Compass className="w-5 h-5" /> },
    { id: 'create', label: 'Criar', icon: <Plus className="w-5 h-5" /> },
    { id: 'chat', label: 'Chat', icon: <MessageCircle className="w-5 h-5" />, badge: unreadChat },
    { id: 'me', label: 'Perfil', icon: <User className="w-5 h-5" /> },
  ];

  return (
    <>
      {/* Mobile Compact Top App Bar (h-12 + bottom h-14 = 104px < 15% of 844px) */}
      {!hideMobileTopBar && (
        <header className="md:hidden h-12 shrink-0 px-3.5 border-b border-[var(--line)] bg-[var(--card)]/95 backdrop-blur-md flex items-center justify-between z-20">
          <button
            type="button"
            onClick={() => onNavigate('feed')}
            className="font-display font-extrabold text-xl tracking-tight bg-clip-text text-transparent whitespace-nowrap"
            style={{ backgroundImage: 'var(--grad)' }}
          >
            Pappo
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onNavigate('reels')}
              aria-label="Reels"
              className={`w-10 h-10 rounded-full grid place-items-center ${
                active === 'reels' ? 'text-[var(--acc)]' : 'text-[var(--mut)]'
              }`}
            >
              <Film className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('nt')}
              aria-label="Notificações"
              className={`relative w-10 h-10 rounded-full grid place-items-center ${
                active === 'nt' ? 'text-[var(--acc)]' : 'text-[var(--mut)]'
              }`}
            >
              <Bell className="w-5 h-5" />
              {unreadNotif > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold grid place-items-center">
                  {unreadNotif}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('set')}
              aria-label="Ajustes"
              className={`w-10 h-10 rounded-full grid place-items-center ${
                active === 'set' ? 'text-[var(--acc)]' : 'text-[var(--mut)]'
              }`}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>
      )}

      {/* Desktop / Tablet Sidebar */}
      <aside className="hidden md:flex flex-col w-20 lg:w-60 shrink-0 border-r border-[var(--line)] bg-[var(--card)] p-3 lg:p-4 gap-1 z-20">
        <div className="px-2 pb-4 pt-1 flex items-center justify-center lg:justify-start">
          <span
            className="font-display font-extrabold text-2xl tracking-tight bg-clip-text text-transparent whitespace-nowrap"
            style={{ backgroundImage: 'var(--grad)' }}
          >
            <span className="lg:hidden">P</span>
            <span className="hidden lg:inline">Pappo</span>
          </span>
        </div>

        {items.slice(0, 4).map((it) => {
          const isOn = active === it.id;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onNavigate(it.id)}
              aria-label={it.label}
              className={`relative flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                isOn
                  ? 'bg-[var(--bg)] text-[var(--ink)]'
                  : 'text-[var(--mut)] hover:bg-[var(--bg)] hover:text-[var(--ink)]'
              }`}
            >
              {it.icon}
              <span className="hidden lg:inline">{it.label}</span>
              {Boolean(it.badge) && (
                <span className="absolute top-1.5 left-7 lg:static lg:ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center font-mono-num">
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onCreate}
          aria-label="Criar publicação"
          className="my-2 flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 rounded-xl font-bold text-sm text-white shadow-md transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 min-h-[44px]"
          style={{ background: 'var(--grad)' }}
        >
          <Plus className="w-5 h-5" />
          <span className="hidden lg:inline">Criar</span>
        </button>

        {items.slice(4).map((it) => {
          const isOn = active === it.id || (it.id === 'me' && active === 'pr');
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onNavigate(it.id)}
              aria-label={it.label}
              className={`relative flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-colors whitespace-nowrap shrink-0 min-h-[44px] ${
                isOn
                  ? 'bg-[var(--bg)] text-[var(--ink)]'
                  : 'text-[var(--mut)] hover:bg-[var(--bg)] hover:text-[var(--ink)]'
              }`}
            >
              {it.icon}
              <span className="hidden lg:inline">{it.label}</span>
              {Boolean(it.badge) && (
                <span className="absolute top-1.5 left-7 lg:static lg:ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold grid place-items-center font-mono-num">
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Mobile Bottom Thumb-Zone Bar */}
      <nav
        aria-label="Navegação principal"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 bg-[var(--card)]/95 backdrop-blur-md border-t border-[var(--line)] grid grid-cols-5 items-center px-1"
      >
        {mobileTabs.map((t) => {
          if (t.id === 'create') {
            return (
              <button
                key="create"
                type="button"
                onClick={onCreate}
                aria-label="Criar"
                className="mx-auto w-11 h-11 rounded-full grid place-items-center text-white shadow-sm active:scale-95 transition-transform"
                style={{ background: 'var(--grad)' }}
              >
                {t.icon}
              </button>
            );
          }
          const tabId = t.id as NavTab;
          const isOn = active === tabId || (tabId === 'me' && active === 'pr');
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => onNavigate(tabId)}
              aria-label={t.label}
              className={`relative flex flex-col items-center justify-center h-11 rounded-xl transition-colors ${
                isOn ? 'text-[var(--acc)] font-semibold' : 'text-[var(--mut)]'
              }`}
            >
              {t.icon}
              <span className="text-[10px] leading-tight mt-0.5">{t.label}</span>
              {Boolean(t.badge) && (
                <span className="absolute top-0.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold grid place-items-center">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}

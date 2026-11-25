import React from 'react';
import { Bell, Check, X } from 'lucide-react';
import type { AppState, UserProfile } from '../types/pappo';
import { Avatar, timeAgo } from './Avatar';

interface NotificationsViewProps {
  state: AppState;
  usersMap: Record<string, UserProfile>;
  onAcceptFollow: (userId: string) => void;
  onDeclineFollow: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
}

export function NotificationsView({
  state,
  usersMap,
  onAcceptFollow,
  onDeclineFollow,
  onOpenProfile,
}: NotificationsViewProps) {
  const resolveUser = (id: string): UserProfile =>
    usersMap[id] || { id, n: 'Usuário', h: 'usuario', c: ['#6d4aff', '#ff4e88'] };

  const visibleReqs = state.reqs.filter((id) => !state.blocked.includes(id));

  return (
    <div className="max-w-[650px] mx-auto px-3 sm:px-4 pt-5 pb-20 md:pb-12 space-y-5">
      <h1 className="text-2xl font-display font-bold tracking-tight">Notificações</h1>

      {visibleReqs.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
            Solicitações para seguir
          </h2>
          <div className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-4 space-y-3 shadow-[var(--sh)]">
            {visibleReqs.map((id) => {
              const u = resolveUser(id);
              return (
                <div key={id} className="flex items-center gap-3">
                  <button type="button" onClick={() => onOpenProfile(id)}>
                    <Avatar user={u} size={42} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{u.n}</div>
                    <div className="text-xs text-[var(--mut)] truncate">@{u.h} quer seguir você</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAcceptFollow(id)}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white flex items-center gap-1 whitespace-nowrap"
                    style={{ background: 'var(--grad)' }}
                  >
                    <Check className="w-3.5 h-3.5" />
                    Aceitar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeclineFollow(id)}
                    aria-label={`Recusar ${u.n}`}
                    className="w-9 h-9 rounded-full grid place-items-center text-[var(--mut)] hover:bg-[var(--bg)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">Atividade</h2>
        <div className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-4 space-y-3 shadow-[var(--sh)]">
          {state.nt.length === 0 ? (
            <p className="text-sm text-[var(--mut)] text-center py-6">Sem novidades no momento.</p>
          ) : (
            state.nt.map((n) => {
              const u = n.u ? resolveUser(n.u) : null;
              const fallbackTxt: Record<string, string> = {
                like: 'curtiu sua publicação',
                acc: 'aceitou sua solicitação para seguir',
                cm: 'comentou na sua publicação',
                fw: 'começou a seguir você',
                news: 'Atualização do Pappo',
              };
              return (
                <div key={n.id} className="flex items-center gap-3 py-1">
                  {u ? (
                    <button type="button" onClick={() => onOpenProfile(u.id)}>
                      <Avatar user={u} size={40} />
                    </button>
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full grid place-items-center text-white shrink-0"
                      style={{ background: 'var(--grad)' }}
                    >
                      <Bell className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-sm">
                    {u && <span className="font-semibold mr-1">{u.n}</span>}
                    <span>{n.tx || fallbackTxt[n.type] || ''}</span>
                    <div className="text-xs text-[var(--mut)] mt-0.5">{timeAgo(n.t)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

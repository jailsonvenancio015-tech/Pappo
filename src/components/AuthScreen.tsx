import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, Trash2, Upload, Users } from 'lucide-react';
import type { AccountVaultRecord, AppState } from '../types/pappo';
import {
  extractEmbeddedSnapshotFromHtml,
  isValidPortableSnapshot,
  type PappoPortableSnapshot,
} from '../storage/selfContainedApp';
import { evaluatePasswordStrength, validateHandle } from '../utils/socialLogic';

interface AuthScreenProps {
  accounts: Record<string, AccountVaultRecord>;
  initialMode?: 'in' | 'new' | 'recover';
  onLogin: (handle: string, password: string) => Promise<string | null>;
  onSignup: (opts: {
    name: string;
    handle: string;
    password: string;
    privateProfile: boolean;
    verifiedContact: string;
  }) => Promise<{ error?: string; recoveryKey?: string; recoveryCodes?: string[] }>;
  onCompleteSignup: () => void;
  onRecover: (opts: {
    handle: string;
    credential: string;
    newPassword: string;
  }) => Promise<string | null>;
  onRemoveAccount: (handle: string) => Promise<void>;
  onRestoreBackup: (
    payload: { v: number; h: string; acc: AccountVaultRecord; state: AppState } | PappoPortableSnapshot
  ) => Promise<string | null>;
}

export function AuthScreen({
  accounts,
  initialMode = 'in',
  onLogin,
  onSignup,
  onCompleteSignup,
  onRecover,
  onRemoveAccount,
  onRestoreBackup,
}: AuthScreenProps) {
  const [mode, setMode] = useState<'in' | 'new' | 'recover'>(initialMode);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [verifiedContact, setVerifiedContact] = useState('');
  const [privateProfile, setPrivateProfile] = useState(false);
  const [recoveryCred, setRecoveryCred] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [handleAvail, setHandleAvail] = useState<{ checked: boolean; available: boolean; msg: string }>({
    checked: false,
    available: false,
    msg: '',
  });
  const [createdRecovery, setCreatedRecovery] = useState<{
    handle: string;
    recoveryKey: string;
    recoveryCodes: string[];
  } | null>(null);

  const accountEntries = Object.entries(accounts);
  const strength = evaluatePasswordStrength(password);

  useEffect(() => {
    if (mode !== 'new') return;
    const check = validateHandle(handle);
    if (!handle.trim()) {
      setHandleAvail({ checked: false, available: false, msg: '' });
      return;
    }
    if (!check.valid) {
      setHandleAvail({ checked: true, available: false, msg: check.error || 'Formato inválido' });
      return;
    }
    if (accounts[check.normalized]) {
      setHandleAvail({ checked: true, available: false, msg: 'Esse @ já existe neste aparelho' });
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
        try {
          const res = await fetch(`/api/handles/${encodeURIComponent(check.normalized)}/available`);
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            const data = (await res.json()) as { available: boolean };
            if (!cancelled) {
              setHandleAvail({
                checked: true,
                available: data.available,
                msg: data.available ? `@${check.normalized} disponível` : `@${check.normalized} já está em uso`,
              });
            }
            return;
          }
        } catch {
          // fall through to local availability
        }
      }
      if (!cancelled) {
        setHandleAvail({ checked: true, available: true, msg: `@${check.normalized} disponível localmente` });
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [handle, mode, accounts]);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const err = await onLogin(handle, password);
    setBusy(false);
    if (err) setError(err);
  };

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (accountEntries.length >= 5) {
      setError('Limite de 5 contas locais atingido neste dispositivo.');
      return;
    }
    if (name.trim().length < 2) {
      setError('Digite seu nome completo ou apelido.');
      return;
    }
    const hv = validateHandle(handle);
    if (!hv.valid) {
      setError(hv.error || 'Nome de usuário @ inválido.');
      return;
    }
    if (password.length < 6) {
      setError('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== password2) {
      setError('As senhas não coincidem.');
      return;
    }

    setBusy(true);
    const res = await onSignup({
      name: name.trim(),
      handle: hv.normalized,
      password,
      privateProfile,
      verifiedContact: verifiedContact.trim(),
    });
    setBusy(false);

    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.recoveryKey && res.recoveryCodes) {
      setCreatedRecovery({
        handle: hv.normalized,
        recoveryKey: res.recoveryKey,
        recoveryCodes: res.recoveryCodes,
      });
    }
  };

  const submitRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const err = await onRecover({ handle, credential: recoveryCred, newPassword: password });
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setMode('in');
      setPassword('');
      setRecoveryCred('');
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.html') || text.trimStart().startsWith('<')) {
        const snap = extractEmbeddedSnapshotFromHtml(text);
        if (!snap) {
          setError('Este arquivo HTML não contém dados salvos do Pappo.');
        } else {
          const err = await onRestoreBackup(snap);
          if (err) setError(err);
        }
      } else {
        const parsed = JSON.parse(text) as
          | { v: number; h: string; acc: AccountVaultRecord; state: AppState }
          | PappoPortableSnapshot;
        if (!isValidPortableSnapshot(parsed) && !('h' in parsed && 'acc' in parsed)) {
          setError('Arquivo de backup inválido.');
        } else {
          const err = await onRestoreBackup(parsed);
          if (err) setError(err);
        }
      }
    } catch {
      setError('Não foi possível ler o arquivo de backup.');
    }
    e.target.value = '';
  };

  if (createdRecovery) {
    return (
      <div className="min-h-full flex items-center justify-center p-4 bg-[var(--bg)]">
        <div className="w-full max-w-md bg-[var(--card)] border border-[var(--line)] rounded-3xl p-6 shadow-[var(--sh)] space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl grid place-items-center text-white" style={{ background: 'var(--grad)' }}>
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Salve sua recuperação</h1>
              <p className="text-sm text-[var(--mut)]">@{createdRecovery.handle}</p>
            </div>
          </div>

          <p className="text-sm text-[var(--mut)] leading-relaxed">
            Apenas conhecer o seu @ não permite recuperar a conta. Guarde a chave mestra ou um dos códigos de uso único abaixo em local seguro.
          </p>

          <div className="p-4 rounded-2xl bg-[var(--bg)] border border-[var(--line)] space-y-2">
            <span className="text-xs font-medium text-[var(--mut)]">Chave de recuperação</span>
            <p className="font-mono-num text-sm font-semibold select-all">{createdRecovery.recoveryKey}</p>
          </div>

          <div className="p-4 rounded-2xl bg-[var(--bg)] border border-[var(--line)] space-y-2">
            <span className="text-xs font-medium text-[var(--mut)]">Códigos de recuperação (uso único)</span>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {createdRecovery.recoveryCodes.map((c) => (
                <code key={c} className="font-mono-num text-xs py-1.5 px-2 rounded-lg bg-[var(--card)] border border-[var(--line)] text-center select-all">
                  {c}
                </code>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onCompleteSignup}
            className="w-full py-3 px-4 rounded-xl text-white font-semibold transition-transform active:scale-[0.98]"
            style={{ background: 'var(--grad)' }}
          >
            Já salvei, entrar no Pappo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-full flex items-center justify-center p-4 overflow-y-auto"
      style={{
        background:
          'radial-gradient(65% 45% at 50% 0%, color-mix(in srgb, var(--acc) 18%, transparent), transparent), var(--bg)',
      }}
    >
      <div className="w-full max-w-md bg-[var(--card)] border border-[var(--line)] rounded-3xl p-6 sm:p-7 shadow-[var(--sh)] space-y-5">
        <div className="text-center space-y-1">
          <div
            className="text-4xl font-extrabold font-display tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: 'var(--grad)' }}
          >
            Pappo
          </div>
          <p className="text-sm text-[var(--mut)]">
            {mode === 'new'
              ? 'Crie sua conta com privacidade e recuperação segura'
              : mode === 'recover'
              ? 'Recupere o acesso com sua chave ou código'
              : 'Entre para conectar com pessoas e dispositivos'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 bg-[var(--bg)] rounded-xl border border-[var(--line)]">
          <button
            type="button"
            onClick={() => { setMode('in'); setError(''); }}
            className={`py-2 px-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
              mode === 'in' ? 'bg-[var(--card)] text-[var(--ink)] shadow-sm' : 'text-[var(--mut)]'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => { setMode('new'); setError(''); }}
            className={`py-2 px-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
              mode === 'new' ? 'bg-[var(--card)] text-[var(--ink)] shadow-sm' : 'text-[var(--mut)]'
            }`}
          >
            Criar conta
          </button>
          <button
            type="button"
            onClick={() => { setMode('recover'); setError(''); }}
            className={`py-2 px-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
              mode === 'recover' ? 'bg-[var(--card)] text-[var(--ink)] shadow-sm' : 'text-[var(--mut)]'
            }`}
          >
            Recuperar
          </button>
        </div>

        <form
          onSubmit={mode === 'new' ? submitSignup : mode === 'recover' ? submitRecover : submitLogin}
          className="space-y-3"
        >
          {mode === 'new' && (
            <div>
              <label className="sr-only" htmlFor="auth-name">Nome</label>
              <input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                maxLength={36}
                autoComplete="name"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] focus:border-[var(--acc)] outline-none"
              />
            </div>
          )}

          <div>
            <label className="sr-only" htmlFor="auth-handle">Nome de usuário</label>
            <div className="flex items-center gap-1.5 px-3.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] focus-within:border-[var(--acc)]">
              <span className="text-[var(--mut)] font-semibold">@</span>
              <input
                id="auth-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="usuário"
                maxLength={21}
                autoCapitalize="none"
                autoComplete="username"
                className="w-full py-2.5 bg-transparent outline-none"
              />
            </div>
            {mode === 'new' && handleAvail.checked && (
              <p className={`text-xs mt-1 ${handleAvail.available ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                {handleAvail.msg}
              </p>
            )}
          </div>

          {mode === 'recover' && (
            <div>
              <label className="sr-only" htmlFor="auth-rec">Chave ou código de recuperação</label>
              <div className="flex items-center gap-2 px-3.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] focus-within:border-[var(--acc)]">
                <KeyRound className="w-4 h-4 text-[var(--mut)] shrink-0" />
                <input
                  id="auth-rec"
                  value={recoveryCred}
                  onChange={(e) => setRecoveryCred(e.target.value)}
                  placeholder="Chave PAPPO-... ou código de 6 dígitos"
                  className="w-full py-2.5 bg-transparent outline-none font-mono-num text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="sr-only" htmlFor="auth-pw">Senha</label>
            <div className="flex items-center gap-2 pl-3.5 pr-1.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] focus-within:border-[var(--acc)]">
              <input
                id="auth-pw"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'recover' ? 'Nova senha (6+ caracteres)' : 'Senha'}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                className="w-full py-2.5 bg-transparent outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                className="min-w-[40px] min-h-[40px] grid place-items-center rounded-lg text-[var(--mut)] hover:text-[var(--ink)]"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mode === 'new' && (
            <>
              <div>
                <label className="sr-only" htmlFor="auth-pw2">Confirmar senha</label>
                <input
                  id="auth-pw2"
                  type={showPw ? 'text' : 'password'}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Confirmar senha"
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] focus:border-[var(--acc)] outline-none"
                />
              </div>

              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                  <div
                    className="h-full transition-all duration-200"
                    style={{
                      width: `${strength.score * 25}%`,
                      backgroundColor:
                        strength.score <= 1 ? '#f43f5e' : strength.score === 2 ? '#f59e0b' : '#10b981',
                    }}
                  />
                </div>
                <p className="text-xs text-[var(--mut)]">Força da senha: {strength.label}</p>
              </div>

              <div>
                <label className="sr-only" htmlFor="auth-contact">E-mail ou telefone de recuperação</label>
                <input
                  id="auth-contact"
                  value={verifiedContact}
                  onChange={(e) => setVerifiedContact(e.target.value)}
                  placeholder="E-mail ou telefone verificado (opcional)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] focus:border-[var(--acc)] outline-none text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setPrivateProfile(false)}
                  className={`p-3 rounded-2xl border text-center space-y-1 transition-colors ${
                    !privateProfile
                      ? 'border-[var(--acc)] bg-[color-mix(in_srgb,var(--acc)_8%,transparent)]'
                      : 'border-[var(--line)]'
                  }`}
                >
                  <Users className="w-5 h-5 mx-auto text-[var(--acc)]" />
                  <div className="text-sm font-bold">Público</div>
                  <div className="text-xs text-[var(--mut)]">Qualquer pessoa segue</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPrivateProfile(true)}
                  className={`p-3 rounded-2xl border text-center space-y-1 transition-colors ${
                    privateProfile
                      ? 'border-[var(--acc)] bg-[color-mix(in_srgb,var(--acc)_8%,transparent)]'
                      : 'border-[var(--line)]'
                  }`}
                >
                  <Lock className="w-5 h-5 mx-auto text-[var(--acc)]" />
                  <div className="text-sm font-bold">Privado</div>
                  <div className="text-xs text-[var(--mut)]">Você aprova seguidores</div>
                </button>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-rose-500 font-medium text-center">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 px-4 rounded-xl text-white font-semibold transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'var(--grad)' }}
          >
            {busy
              ? 'Processando…'
              : mode === 'new'
              ? 'Criar conta'
              : mode === 'recover'
              ? 'Redefinir senha'
              : 'Entrar'}
          </button>
        </form>

        {mode === 'in' && accountEntries.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-xs font-medium text-[var(--mut)]">
              Contas salvas neste dispositivo ({accountEntries.length}/5)
            </div>
            <div className="space-y-1.5">
              {accountEntries.map(([h, acc]) => (
                <div
                  key={h}
                  className="flex items-center gap-2 p-2 rounded-xl bg-[var(--bg)] border border-[var(--line)]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setHandle(h);
                      document.getElementById('auth-pw')?.focus();
                    }}
                    className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                  >
                    <div
                      className="w-9 h-9 rounded-full grid place-items-center text-white font-bold shrink-0"
                      style={{ background: 'var(--grad)' }}
                    >
                      {acc.n.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{acc.n}</div>
                      <div className="text-xs text-[var(--mut)] truncate">@{h}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemoveAccount(h)}
                    aria-label={`Remover conta @${h}`}
                    className="min-w-[40px] min-h-[40px] grid place-items-center rounded-lg text-[var(--mut)] hover:text-rose-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'in' && (
          <label className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-[var(--line)] text-sm font-medium cursor-pointer hover:border-[var(--acc)] transition-colors">
            <Upload className="w-4 h-4" />
            <span>Restaurar backup (.json ou .html)</span>
            <input type="file" hidden accept=".json,.html,application/json,text/html" onChange={handleRestoreFile} />
          </label>
        )}

        <p className="text-xs text-center text-[var(--mut)]">
          100% local no navegador · Sem nuvem externa · Até 5 contas por dispositivo.
        </p>
      </div>
    </div>
  );
}

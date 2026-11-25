import React, { useEffect, useState } from 'react';
import {
  BatteryCharging,
  CheckCircle2,
  Download,
  FileCode2,
  HardDrive,
  KeyRound,
  LogOut,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Upload,
  UserCheck,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type {
  AccountVaultRecord,
  AppState,
  DeviceSharingPolicy,
  FontScale,
  MediaQuality,
  MessagePermission,
  PerformanceSettings,
  PlaybackResolution,
  PrivacySettings,
  StartScreen,
  ThemeMode,
  UserProfile,
} from '../types/pappo';
import type { MeshSnapshot } from '../network/p2pClient';
import { ACCENT_PALETTES, checkHdrCompatibility, formatBytes } from '../utils/mediaTools';
import { clearTemporaryMediaCache, enforceCacheLimit, getCacheStats } from '../storage/vault';
import {
  clearLinkedLocalFile,
  getLinkedLocalFileName,
  supportsFileSystemAutoSave,
} from '../storage/selfContainedApp';
import { Avatar } from './Avatar';

interface SettingsViewProps {
  state: AppState;
  accounts: Record<string, AccountVaultRecord>;
  usersMap: Record<string, UserProfile>;
  mesh: MeshSnapshot;
  lastAutoSavedAt: number;
  opfsActive: boolean;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onSwitchAccount: (handle: string) => void;
  onAddAccount: () => void;
  onSignOut: () => void;
  onChangePassword: (oldPw: string, newPw: string) => Promise<string | null>;
  onRegenerateRecovery: () => Promise<{ recoveryKey: string; recoveryCodes: string[] }>;
  onExportBackup: () => void;
  onDownloadStandaloneApp: () => Promise<void>;
  onLinkLocalAppFile: () => Promise<void>;
  onImportAppFile: (file: File) => Promise<void>;
  onDeleteAccount: (handle: string, password: string, mode: 'rem' | 'del') => Promise<string | null>;
  onTestFailover: () => void;
  onNotify: (msg: string) => void;
}

export function SettingsView({
  state,
  accounts,
  usersMap,
  mesh,
  lastAutoSavedAt,
  opfsActive,
  onUpdateState,
  onSwitchAccount,
  onAddAccount,
  onSignOut,
  onChangePassword,
  onRegenerateRecovery,
  onExportBackup,
  onDownloadStandaloneApp,
  onLinkLocalAppFile,
  onImportAppFile,
  onDeleteAccount,
  onTestFailover,
  onNotify,
}: SettingsViewProps) {
  const [exportingApp, setExportingApp] = useState(false);
  const [linkedFile, setLinkedFile] = useState<string | null>(() => getLinkedLocalFileName());
  const [cacheStats, setCacheStats] = useState({ count: 0, totalBytes: 0 });
  const [modal, setModal] = useState<null | 'accounts' | 'password' | 'recovery' | 'delete'>(null);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [delPw, setDelPw] = useState('');
  const [delConfirm, setDelConfirm] = useState('');
  const [delMode, setDelMode] = useState<'rem' | 'del'>('rem');
  const [err, setErr] = useState('');
  const [newRecovery, setNewRecovery] = useState<{ recoveryKey: string; recoveryCodes: string[] } | null>(null);

  const hdrCompat = checkHdrCompatibility();

  const refreshCache = async () => {
    const stats = await getCacheStats();
    setCacheStats(stats);
  };

  useEffect(() => {
    void refreshCache();
  }, []);

  const updatePerf = (patch: Partial<PerformanceSettings>) => {
    onUpdateState((prev) => ({ ...prev, perf: { ...prev.perf, ...patch } }));
    if (patch.cacheLimitMb !== undefined) {
      void enforceCacheLimit(patch.cacheLimitMb).then(refreshCache);
    }
  };

  const updateSharing = (patch: Partial<DeviceSharingPolicy>) => {
    onUpdateState((prev) => ({ ...prev, sharing: { ...prev.sharing, ...patch } }));
  };

  const updatePrivacy = (patch: Partial<PrivacySettings>) => {
    onUpdateState((prev) => ({
      ...prev,
      privacy: { ...prev.privacy, ...patch },
      me: {
        ...prev.me,
        priv: patch.privateProfile ?? prev.privacy.privateProfile,
        showActivity: patch.showActivityStatus ?? prev.privacy.showActivityStatus,
      },
    }));
  };

  const ToggleRow = ({
    label,
    desc,
    checked,
    onChange,
  }: {
    label: string;
    desc?: string;
    checked: boolean;
    onChange: (next: boolean) => void;
  }) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {desc && <div className="text-xs text-[var(--mut)]">{desc}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`w-12 h-7 rounded-full relative transition-colors shrink-0 ${
          checked ? 'bg-[var(--acc)]' : 'bg-[var(--line)]'
        }`}
      >
        <span
          className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  );

  const accountEntries = Object.entries(accounts);

  return (
    <div className="max-w-[680px] mx-auto px-3 sm:px-4 pt-5 pb-20 md:pb-12 space-y-5">
      <h1 className="text-2xl font-display font-bold tracking-tight">Ajustes</h1>

      {/* 1. Contas e Recuperação */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
          Contas e Recuperação ({accountEntries.length}/5 neste dispositivo)
        </h2>

        <div className="flex items-center gap-3">
          <Avatar user={state.me} size={48} showOnline={false} />
          <div className="flex-1 min-w-0">
            <div className="font-bold truncate">{state.me.n}</div>
            <div className="text-xs text-[var(--mut)] truncate">@{state.me.h}</div>
          </div>
          <button
            type="button"
            onClick={() => setModal('accounts')}
            className="px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)] whitespace-nowrap"
          >
            Trocar / Gerenciar
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setErr('');
              setOldPw('');
              setNewPw('');
              setModal('password');
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)]"
          >
            Alterar senha
          </button>
          <button
            type="button"
            onClick={async () => {
              const creds = await onRegenerateRecovery();
              setNewRecovery(creds);
              setModal('recovery');
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)]"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Gerar nova chave de recuperação
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)]"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair desta conta
          </button>
        </div>
      </section>

      {/* 2. Rede Híbrida & Compartilhamento entre Dispositivos */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
            Rede Híbrida e Compartilhamento P2P
          </h2>
          <button
            type="button"
            onClick={onTestFailover}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Testar troca automática
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">Melhor rota selecionada automaticamente</span>
            <span className="font-mono-num font-semibold text-[var(--acc)]">{mesh.activeRouteLabel}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--mut)]">
            <span className="inline-flex items-center gap-1">
              <Wifi className="w-3.5 h-3.5" />
              {mesh.wsConnected ? 'Apoio & sinalização conectados' : 'Operando via cache local'}
            </span>
            <span className="inline-flex items-center gap-1 font-mono-num">
              <BatteryCharging className="w-3.5 h-3.5" />
              Bateria: {mesh.localTelemetry.batteryPct}%{mesh.localTelemetry.charging ? ' (carregando)' : ''}
            </span>
            <span className="font-mono-num">
              Nós candidatos: {mesh.peers.length}
            </span>
          </div>
          <div className="text-[var(--ink)]">
            Estado do compartilhamento: <span className="font-semibold">{mesh.sharingEligibility.reason}</span>
          </div>
          {mesh.lastFailoverReason && (
            <div className="text-[var(--mut)]">{mesh.lastFailoverReason}</div>
          )}
        </div>

        <div className="divide-y divide-[var(--line)]">
          <ToggleRow
            label="Autorizar meu dispositivo a ajudar na distribuição"
            desc="Compartilha somente arquivos autorizados em cache com outros usuários"
            checked={state.sharing.allowSharing}
            onChange={(v) => updateSharing({ allowSharing: v })}
          />
          <ToggleRow
            label="Compartilhar somente no Wi-Fi"
            desc="Interrompe automaticamente o envio ao usar dados móveis"
            checked={state.sharing.wifiOnly}
            onChange={(v) => updateSharing({ wifiOnly: v })}
          />
          <ToggleRow
            label="Pausar com economia de dados ou temperatura elevada"
            desc="Protege bateria, memória e consumo do aparelho"
            checked={state.sharing.pauseOnThermal}
            onChange={(v) => updateSharing({ pauseOnThermal: v, pauseOnSaveData: v })}
          />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Bateria mínima para compartilhar</span>
            <span className="font-mono-num font-semibold">{state.sharing.minBatteryPct}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={state.sharing.minBatteryPct}
            onChange={(e) => updateSharing({ minBatteryPct: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      </section>

      {/* 3. Desempenho, Cache e Mídia */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
          Desempenho, Cache e Mídia
        </h2>

        <div className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-[var(--acc)]" />
              <span>Cache temporário</span>
            </div>
            <div className="text-xs text-[var(--mut)] font-mono-num">
              {formatBytes(cacheStats.totalBytes)} em {cacheStats.count} item(ns) · limite {state.perf.cacheLimitMb} MB
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await clearTemporaryMediaCache();
              await refreshCache();
              onNotify('Cache temporário esvaziado (posts e mensagens preservados)');
            }}
            className="px-3.5 py-2 rounded-xl border border-[var(--line)] bg-[var(--card)] text-xs font-semibold hover:border-[var(--acc)] whitespace-nowrap"
          >
            Esvaziar cache
          </button>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>Limite de cache local</span>
            <span className="font-mono-num font-semibold">{state.perf.cacheLimitMb} MB</span>
          </div>
          <input
            type="range"
            min={50}
            max={500}
            step={25}
            value={state.perf.cacheLimitMb}
            onChange={(e) => updatePerf({ cacheLimitMb: Number(e.target.value) })}
            className="w-full"
          />
        </div>

        <div className="divide-y divide-[var(--line)]">
          <ToggleRow
            label="Reprodução automática de vídeos"
            checked={state.perf.autoplayVideo}
            onChange={(v) => updatePerf({ autoplayVideo: v })}
          />
          <ToggleRow
            label="Pré-carregamento inteligente"
            desc="Desative para economizar dados móveis e memória"
            checked={state.perf.preloadEnabled}
            onChange={(v) => updatePerf({ preloadEnabled: v })}
          />
          <ToggleRow
            label="Reprodução em HDR"
            desc={hdrCompat.reason}
            checked={state.perf.hdrEnabled}
            onChange={(v) => updatePerf({ hdrEnabled: v })}
          />
          <ToggleRow
            label="Economia de bateria e dados"
            desc="Reduz qualidade automática e pausa pré-carregamentos"
            checked={state.perf.batteryDataSaver}
            onChange={(v) => updatePerf({ batteryDataSaver: v })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5">
            <div className="text-[var(--mut)]">Qualidade no Wi-Fi</div>
            <div className="flex gap-1.5">
              {(['baixa', 'media', 'alta'] as MediaQuality[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => updatePerf({ wifiQuality: q })}
                  className={`flex-1 py-1.5 rounded-lg font-semibold capitalize ${
                    state.perf.wifiQuality === q ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                  }`}
                >
                  {q === 'media' ? 'Média' : q}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[var(--mut)]">Qualidade em dados móveis</div>
            <div className="flex gap-1.5">
              {(['baixa', 'media', 'alta'] as MediaQuality[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => updatePerf({ mobileQuality: q })}
                  className={`flex-1 py-1.5 rounded-lg font-semibold capitalize ${
                    state.perf.mobileQuality === q ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                  }`}
                >
                  {q === 'media' ? 'Média' : q}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="text-[var(--mut)]">Resolução padrão de reprodução</div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['auto', 'Padrão (Auto)'],
              ['baixa', 'Baixa (360p)'],
              ['media', 'Média (720p)'],
              ['alta', 'Alta (1080p+)'],
            ] as Array<[PlaybackResolution, string]>).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => updatePerf({ playbackResolution: val })}
                className={`px-3 py-1.5 rounded-lg font-semibold ${
                  state.perf.playbackResolution === val ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Privacidade e Segurança */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
          Privacidade e Segurança
        </h2>

        <div className="divide-y divide-[var(--line)]">
          <ToggleRow
            label="Conta privada"
            desc="Solicitações para seguir precisam da sua aprovação"
            checked={state.privacy.privateProfile}
            onChange={(v) => updatePrivacy({ privateProfile: v, hidePostsFromPublic: v })}
          />
          <ToggleRow
            label="Ocultar lista de seguidores"
            checked={state.privacy.hideFollowers}
            onChange={(v) => updatePrivacy({ hideFollowers: v })}
          />
          <ToggleRow
            label="Ocultar quem eu sigo"
            checked={state.privacy.hideFollowing}
            onChange={(v) => updatePrivacy({ hideFollowing: v })}
          />
          <ToggleRow
            label="Mostrar status de atividade (online)"
            checked={state.privacy.showActivityStatus}
            onChange={(v) => updatePrivacy({ showActivityStatus: v })}
          />
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="text-[var(--mut)]">Quem pode enviar mensagens diretas</div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['todos', 'Todos'],
              ['seguindo', 'Apenas seguidores'],
              ['ninguem', 'Ninguém'],
            ] as Array<[MessagePermission, string]>).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => updatePrivacy({ whoCanMessage: val })}
                className={`px-3 py-1.5 rounded-lg font-semibold ${
                  state.privacy.whoCanMessage === val ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {state.blocked.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold text-[var(--mut)]">Usuários bloqueados</div>
            {state.blocked.map((uid) => {
              const u = usersMap[uid];
              return (
                <div key={uid} className="flex items-center justify-between p-2 rounded-xl bg-[var(--bg)]">
                  <span className="text-sm font-medium">{u ? `${u.n} (@${u.h})` : uid}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateState((prev) => ({
                        ...prev,
                        blocked: prev.blocked.filter((id) => id !== uid),
                      }))
                    }
                    className="px-3 py-1 rounded-lg border border-[var(--line)] text-xs font-semibold"
                  >
                    Desbloquear
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. Aparência */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">Aparência</h2>

        <div className="space-y-1.5 text-xs">
          <div className="text-[var(--mut)]">Tema</div>
          <div className="flex gap-1.5">
            {([
              ['auto', 'Automático'],
              ['light', 'Claro'],
              ['dark', 'Escuro'],
            ] as Array<[ThemeMode, string]>).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => onUpdateState((prev) => ({ ...prev, theme: val }))}
                className={`px-3.5 py-1.5 rounded-lg font-semibold ${
                  state.theme === val ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="text-[var(--mut)]">Cor de destaque</div>
          <div className="flex gap-2">
            {ACCENT_PALETTES.map((pal, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onUpdateState((prev) => ({ ...prev, ac: i }))}
                aria-label={`Paleta ${i + 1}`}
                className={`w-8 h-8 rounded-full border-2 ${state.ac === i ? 'border-[var(--ink)] scale-110' : 'border-transparent'}`}
                style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1.5">
            <div className="text-[var(--mut)]">Tamanho do texto</div>
            <div className="flex gap-1.5">
              {([
                ['p', 'Pequeno'],
                ['m', 'Médio'],
                ['g', 'Grande'],
              ] as Array<[FontScale, string]>).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onUpdateState((prev) => ({ ...prev, fs: val }))}
                  className={`flex-1 py-1.5 rounded-lg font-semibold ${
                    state.fs === val ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[var(--mut)]">Tela inicial</div>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['feed', 'Início'],
                ['reels', 'Reels'],
                ['chat', 'Chat'],
                ['me', 'Perfil'],
              ] as Array<[StartScreen, string]>).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => onUpdateState((prev) => ({ ...prev, ini: val }))}
                  className={`px-2.5 py-1.5 rounded-lg font-semibold ${
                    state.ini === val ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Armazenamento Local & App Auto-Contido (Sem Google Cloud) */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
          App Local Auto-Contido (Sem Nuvem Externa)
        </h2>

        <div className="p-3.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Auto-salvamento local em tempo real ativo
            </span>
            <span className="font-mono-num text-[var(--mut)]">
              {lastAutoSavedAt
                ? new Date(lastAutoSavedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'agora'}
            </span>
          </div>
          <p className="text-[var(--mut)]">
            Tudo o que você publica, edita ou conversa fica salvo automaticamente no navegador (IndexedDB{opfsActive ? ' + OPFS' : ''}) e sincronizado em tempo real com abas e dispositivos conectados.
          </p>
          <div className="font-mono-num text-[var(--mut)] pt-1">
            {accountEntries.length} conta(s) · {state.posts.length} publicações · {Object.values(state.chat).reduce((s, a) => s + a.length, 0)} mensagens
            {linkedFile ? ` · Arquivo vinculado: ${linkedFile}` : ''}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exportingApp}
            onClick={async () => {
              setExportingApp(true);
              try {
                await onDownloadStandaloneApp();
              } finally {
                setExportingApp(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-xs font-semibold whitespace-nowrap disabled:opacity-60"
            style={{ background: 'var(--grad)' }}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            {exportingApp ? 'Gerando pacote local…' : 'Baixar App Completo Local (.html)'}
          </button>

          {supportsFileSystemAutoSave() && (
            linkedFile ? (
              <button
                type="button"
                onClick={() => {
                  clearLinkedLocalFile();
                  setLinkedFile(null);
                  onNotify('Auto-salvamento em arquivo externo pausado');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-xs font-semibold whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                Desvincular ({linkedFile})
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await onLinkLocalAppFile();
                  setLinkedFile(getLinkedLocalFileName());
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)] whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                Auto-salvar direto em arquivo (.html)
              </button>
            )
          )}

          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)] cursor-pointer whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" />
            <span>Importar App/Backup (.html ou .json)</span>
            <input
              type="file"
              hidden
              accept=".html,.json,text/html,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImportAppFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </section>

      {/* 7. Dados Pessoais e Exclusão */}
      <section className="bg-[var(--card)] border border-[var(--line)] rounded-2xl p-5 shadow-[var(--sh)] space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
          Dados Pessoais e Conta
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExportBackup}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[var(--line)] text-xs font-semibold hover:border-[var(--acc)]"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar dados pessoais (.json)
          </button>
          <button
            type="button"
            onClick={() => {
              setErr('');
              setDelPw('');
              setDelConfirm('');
              setDelMode('rem');
              setModal('delete');
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-500/40 text-rose-500 text-xs font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remover ou excluir conta
          </button>
        </div>
      </section>

      {/* Modals */}
      {modal === 'accounts' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2"><Users className="w-4 h-4" /> Contas neste aparelho ({accountEntries.length}/5)</h2>
              <button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              {accountEntries.map(([h, a]) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    onSwitchAccount(h);
                    setModal(null);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-left hover:border-[var(--acc)]"
                >
                  <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold shrink-0" style={{ background: 'var(--grad)' }}>
                    {a.n.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{a.n}</div>
                    <div className="text-xs text-[var(--mut)] truncate">@{h}</div>
                  </div>
                  {h === state.me.h && <UserCheck className="w-4 h-4 text-[var(--acc)]" />}
                </button>
              ))}
            </div>
            {accountEntries.length < 5 && (
              <button
                type="button"
                onClick={() => {
                  setModal(null);
                  onAddAccount();
                }}
                className="w-full py-2.5 rounded-xl text-white font-semibold"
                style={{ background: 'var(--grad)' }}
              >
                + Adicionar outra conta
              </button>
            )}
          </div>
        </div>
      )}

      {modal === 'password' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-sm bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Alterar senha</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="Senha atual" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Nova senha (6+ caracteres)" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            {err && <p className="text-xs text-rose-500">{err}</p>}
            <button
              type="button"
              onClick={async () => {
                const msg = await onChangePassword(oldPw, newPw);
                if (msg) setErr(msg);
                else setModal(null);
              }}
              className="w-full py-2.5 rounded-xl text-white font-semibold"
              style={{ background: 'var(--grad)' }}
            >
              Salvar nova senha
            </button>
          </div>
        </div>
      )}

      {modal === 'recovery' && newRecovery && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2"><Shield className="w-4 h-4 text-[var(--acc)]" /> Novas credenciais de recuperação</h2>
              <button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--line)]">
              <div className="text-xs text-[var(--mut)]">Chave mestra</div>
              <div className="font-mono-num text-sm font-bold select-all">{newRecovery.recoveryKey}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {newRecovery.recoveryCodes.map((c) => (
                <code key={c} className="font-mono-num text-xs py-1.5 px-2 rounded-lg bg-[var(--bg)] border border-[var(--line)] text-center select-all">
                  {c}
                </code>
              ))}
            </div>
            <button type="button" onClick={() => setModal(null)} className="w-full py-2.5 rounded-xl text-white font-semibold" style={{ background: 'var(--grad)' }}>
              Concluído
            </button>
          </div>
        </div>
      )}

      {modal === 'delete' && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-3">
          <div className="w-full max-w-md bg-[var(--card)] rounded-3xl border border-[var(--line)] p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">Remover ou excluir conta</h2><button type="button" onClick={() => setModal(null)}><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button type="button" onClick={() => setDelMode('rem')} className={`p-2.5 rounded-xl border text-left ${delMode === 'rem' ? 'border-[var(--acc)] bg-[var(--bg)]' : 'border-[var(--line)]'}`}>
                <b>Remover do aparelho</b><br /><span className="text-[var(--mut)]">Baixa backup antes</span>
              </button>
              <button type="button" onClick={() => setDelMode('del')} className={`p-2.5 rounded-xl border text-left ${delMode === 'del' ? 'border-rose-500 bg-rose-500/10' : 'border-[var(--line)]'}`}>
                <b>Excluir conta</b><br /><span className="text-[var(--mut)]">Apaga dados locais</span>
              </button>
            </div>
            <input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)} placeholder="Confirme com sua senha" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            {delMode === 'del' && (
              <input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder="Digite EXCLUIR para confirmar" className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)]" />
            )}
            {err && <p className="text-xs text-rose-500">{err}</p>}
            <button
              type="button"
              onClick={async () => {
                if (delMode === 'del' && delConfirm.trim().toUpperCase() !== 'EXCLUIR') {
                  setErr('Digite EXCLUIR para confirmar.');
                  return;
                }
                const msg = await onDeleteAccount(state.me.h, delPw, delMode);
                if (msg) setErr(msg);
              }}
              className="w-full py-2.5 rounded-xl bg-rose-600 text-white font-semibold"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

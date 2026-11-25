import type {
  CachedAssetEntry,
  DeviceSharingPolicy,
  PeerNodeMetrics,
  NodeDecision,
} from '../types/pappo';

export interface LocalDeviceTelemetry {
  batteryPct: number;
  charging: boolean;
  onCellular: boolean;
  saveData: boolean;
  thermalThrottled: boolean;
  freeStorageMb: number;
  online: boolean;
  loggedIn: boolean;
}

/**
 * Evaluates whether the current user device may act as a content server/peer
 * based on user policy, battery, network, thermal, and storage limits.
 */
export function evaluateDeviceSharingEligibility(
  policy: DeviceSharingPolicy,
  telemetry: LocalDeviceTelemetry
): { eligible: boolean; reason: string } {
  if (!telemetry.loggedIn) {
    return { eligible: false, reason: 'Sessão encerrada' };
  }
  if (!telemetry.online) {
    return { eligible: false, reason: 'Dispositivo offline' };
  }
  if (!policy.allowSharing) {
    return { eligible: false, reason: 'Compartilhamento desativado pelo proprietário' };
  }
  if (policy.wifiOnly && telemetry.onCellular) {
    return { eligible: false, reason: 'Pausado em dados móveis (somente Wi-Fi)' };
  }
  if (policy.pauseOnSaveData && telemetry.saveData) {
    return { eligible: false, reason: 'Economia de dados ativa no sistema' };
  }
  if (!telemetry.charging && telemetry.batteryPct < policy.minBatteryPct) {
    return { eligible: false, reason: `Bateria abaixo de ${policy.minBatteryPct}%` };
  }
  if (policy.pauseOnThermal && telemetry.thermalThrottled) {
    return { eligible: false, reason: 'Temperatura elevada detectada' };
  }
  if (telemetry.freeStorageMb < 40) {
    return { eligible: false, reason: 'Espaço livre insuficiente' };
  }
  return { eligible: true, reason: 'Disponível para distribuir conteúdo autorizado' };
}

/**
 * Computes a deterministic health & speed score (0..1000) for a candidate node.
 * Higher score = faster, healthier, more reliable node.
 */
export function scoreNode(
  node: PeerNodeMetrics,
  assetId?: string,
  preferWifi = true
): { score: number; eligible: boolean; reason?: string } {
  if (!node.online) {
    return { score: -1, eligible: false, reason: 'Offline' };
  }
  if (!node.authorized) {
    return { score: -1, eligible: false, reason: 'Não autorizado' };
  }
  if (node.failureCount >= 3) {
    return { score: -1, eligible: false, reason: 'Circuit breaker aberto por falhas' };
  }
  if (node.kind === 'webrtc-peer' || node.kind === 'broadcast-tab') {
    if (!node.charging && node.batteryPct < 15) {
      return { score: -1, eligible: false, reason: 'Bateria crítica no peer' };
    }
    if (node.thermalThrottled) {
      return { score: -1, eligible: false, reason: 'Sobreaquecimento no peer' };
    }
    if (preferWifi && node.onCellular && node.saveData) {
      return { score: -1, eligible: false, reason: 'Peer em dados móveis restritos' };
    }
    if (assetId && node.hasAssetIds && !node.hasAssetIds.includes(assetId)) {
      return { score: -1, eligible: false, reason: 'Arquivo não está no cache do peer' };
    }
  }

  // Base priority by locality and transport overhead
  const kindBase: Record<PeerNodeMetrics['kind'], number> = {
    'local-cache': 900,
    'broadcast-tab': 760,
    'webrtc-peer': 680,
    'ws-relay': 500,
    'recovery-storage': 420,
  };

  let score = kindBase[node.kind];

  // Latency penalty (ultra-fast peers with <30ms get bonus, high RTT penalized)
  const clampedRtt = Math.min(2000, Math.max(0, node.rttMs));
  score -= clampedRtt * 0.35;

  // Bandwidth bonus (up to +100)
  score += Math.min(100, Math.max(0, node.bandwidthMbps) * 2.5);

  // Battery & power bonus for peer nodes
  if (node.kind === 'webrtc-peer') {
    if (node.charging) score += 25;
    else score += Math.min(20, (node.batteryPct - 15) * 0.25);
    if (node.onCellular) score -= 45;
  }

  // Failure penalty
  score -= node.failureCount * 90;

  return { score: Math.round(score * 10) / 10, eligible: true };
}

/**
 * Automatically selects the best available node and produces an ordered failover chain.
 */
export function selectBestNode(
  nodes: PeerNodeMetrics[],
  assetId?: string,
  preferWifi = true
): NodeDecision {
  const evaluated = nodes.map((node) => {
    const res = scoreNode(node, assetId, preferWifi);
    return { node, ...res };
  });

  const eligibleNodes = evaluated
    .filter((x) => x.eligible)
    .sort((a, b) => b.score - a.score);

  const ineligibleNodes = evaluated
    .filter((x) => !x.eligible)
    .sort((a, b) => a.node.label.localeCompare(b.node.label));

  return {
    selected: eligibleNodes[0]?.node ?? null,
    ranked: [...eligibleNodes, ...ineligibleNodes],
    failoverChain: eligibleNodes.map((x) => x.node.nodeId),
  };
}

/**
 * Computes which temporary cache entries should be evicted (expired first, then LRU)
 * to stay under cacheLimitMb. Never touches account posts/messages.
 */
export function planCacheEviction(
  entries: CachedAssetEntry[],
  cacheLimitMb: number,
  now = Date.now()
): { keep: CachedAssetEntry[]; evictIds: string[]; totalBytesAfter: number } {
  const limitBytes = Math.max(10, cacheLimitMb) * 1024 * 1024;
  const expired: CachedAssetEntry[] = [];
  const valid: CachedAssetEntry[] = [];

  for (const item of entries) {
    if (item.expiresAt > 0 && item.expiresAt <= now) {
      expired.push(item);
    } else {
      valid.push(item);
    }
  }

  // Sort valid items by most recently accessed first (keep hot entries)
  valid.sort((a, b) => b.lastAccessed - a.lastAccessed);

  const keep: CachedAssetEntry[] = [];
  const evictIds = expired.map((e) => e.assetId);
  let usedBytes = 0;

  for (const item of valid) {
    if (usedBytes + item.bytes <= limitBytes) {
      keep.push(item);
      usedBytes += item.bytes;
    } else {
      evictIds.push(item.assetId);
    }
  }

  return { keep, evictIds, totalBytesAfter: usedBytes };
}

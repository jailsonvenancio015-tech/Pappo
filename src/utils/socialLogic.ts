import type {
  ChatMessage,
  MediaQuality,
  Post,
  PrivacySettings,
  UserProfile,
} from '../types/pappo';

export function validateHandle(raw: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = raw.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_.]{3,20}$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Use 3 a 20 caracteres: letras minúsculas, números, _ ou .',
    };
  }
  return { valid: true, normalized };
}

export function evaluatePasswordStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  if (!password) return { score: 0, label: 'Digite uma senha' };
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Excelente'];
  return { score: clamped, label: labels[clamped] };
}

export function canViewProfileContent(opts: {
  viewerId: string;
  target: UserProfile;
  targetPrivacy?: Partial<PrivacySettings>;
  followStatus?: 'ok' | 'pend';
  blockedIds?: string[];
}): boolean {
  const { viewerId, target, targetPrivacy, followStatus, blockedIds = [] } = opts;
  if (viewerId === target.id) return true;
  if (blockedIds.includes(target.id)) return false;
  const isPrivate = targetPrivacy?.privateProfile ?? Boolean(target.priv);
  if (!isPrivate) return true;
  return followStatus === 'ok';
}

export function canSendDirectMessage(opts: {
  senderId: string;
  target: UserProfile;
  permission?: 'todos' | 'seguindo' | 'ninguem';
  targetFollowsSender?: boolean;
  senderFollowsTarget?: boolean;
  blockedIds?: string[];
}): { allowed: boolean; reason?: string } {
  const {
    senderId,
    target,
    permission = 'todos',
    targetFollowsSender = false,
    senderFollowsTarget = false,
    blockedIds = [],
  } = opts;
  if (senderId === target.id) return { allowed: true };
  if (blockedIds.includes(target.id)) {
    return { allowed: false, reason: 'Usuário bloqueado' };
  }
  if (permission === 'ninguem') {
    return { allowed: false, reason: 'Este usuário não aceita novas mensagens' };
  }
  if (permission === 'seguindo' && !targetFollowsSender && !senderFollowsTarget) {
    return { allowed: false, reason: 'Mensagens restritas a seguidores aprovados' };
  }
  return { allowed: true };
}

export function filterVisiblePosts(opts: {
  posts: Post[];
  viewerId: string;
  usersMap: Record<string, UserProfile>;
  fol: Record<string, 'ok' | 'pend'>;
  blockedIds: string[];
  query?: string;
}): Post[] {
  const { posts, viewerId, usersMap, fol, blockedIds, query = '' } = opts;
  const q = query.trim().toLowerCase().replace(/^[#@]/, '');

  return posts.filter((post) => {
    if (blockedIds.includes(post.u)) return false;
    const owner = usersMap[post.u];
    const allowed =
      post.u === viewerId ||
      !owner ||
      canViewProfileContent({
        viewerId,
        target: owner,
        followStatus: fol[post.u],
        blockedIds,
      });

    if (!allowed) return false;
    if (!q) return true;
    const matchCap = (post.cap || '').toLowerCase().includes(q);
    const matchHandle = (owner?.h || '').toLowerCase().includes(q);
    const matchName = (owner?.n || '').toLowerCase().includes(q);
    return matchCap || matchHandle || matchName;
  });
}

/**
 * Idempotently merges incoming messages with existing thread history,
 * deduplicating by `id` or `clientMsgId` so reconnects never duplicate messages.
 */
export function mergeMessagesIdempotent(
  existing: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  const keyOf = (m: ChatMessage) => m.clientMsgId || m.id;

  for (const msg of existing) {
    byKey.set(keyOf(msg), msg);
  }
  for (const msg of incoming) {
    const key = keyOf(msg);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, msg);
    } else {
      byKey.set(key, {
        ...prev,
        ...msg,
        pending: msg.pending ?? false,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.t - b.t);
}

export interface UploadChunkPlan {
  uploadId: string;
  fileName: string;
  totalBytes: number;
  chunkSize: number;
  totalChunks: number;
  uploadedChunks: number[];
  status: 'idle' | 'uploading' | 'paused' | 'completed' | 'cancelled' | 'error';
  quality: MediaQuality;
}

export function createUploadPlan(opts: {
  uploadId: string;
  fileName: string;
  totalBytes: number;
  chunkSize?: number;
  quality: MediaQuality;
}): UploadChunkPlan {
  const chunkSize = opts.chunkSize ?? 64 * 1024;
  const totalChunks = Math.max(1, Math.ceil(opts.totalBytes / chunkSize));
  return {
    uploadId: opts.uploadId,
    fileName: opts.fileName,
    totalBytes: opts.totalBytes,
    chunkSize,
    totalChunks,
    uploadedChunks: [],
    status: 'idle',
    quality: opts.quality,
  };
}

export function nextMissingChunkIndex(plan: UploadChunkPlan): number | null {
  const done = new Set(plan.uploadedChunks);
  for (let i = 0; i < plan.totalChunks; i++) {
    if (!done.has(i)) return i;
  }
  return null;
}

export function markChunkUploaded(plan: UploadChunkPlan, chunkIndex: number): UploadChunkPlan {
  const set = new Set(plan.uploadedChunks);
  set.add(chunkIndex);
  const uploadedChunks = [...set].sort((a, b) => a - b);
  const completed = uploadedChunks.length >= plan.totalChunks;
  return {
    ...plan,
    uploadedChunks,
    status: completed ? 'completed' : plan.status,
  };
}

export function estimateMediaBytes(
  rawBytes: number,
  quality: MediaQuality,
  keepOriginal: boolean
): { compressedBytes: number; originalBytes: number; totalBytes: number } {
  const ratio = quality === 'baixa' ? 0.28 : quality === 'media' ? 0.55 : 0.85;
  const compressedBytes = Math.max(12_000, Math.round(rawBytes * ratio));
  const originalBytes = keepOriginal ? rawBytes : 0;
  return {
    compressedBytes,
    originalBytes,
    totalBytes: compressedBytes + originalBytes,
  };
}

export type MediaQuality = 'baixa' | 'media' | 'alta';
export type PlaybackResolution = 'auto' | 'baixa' | 'media' | 'alta';
export type MessagePermission = 'todos' | 'seguindo' | 'ninguem';
export type ThemeMode = 'auto' | 'light' | 'dark';
export type FontScale = 'p' | 'm' | 'g';
export type StartScreen = 'feed' | 'reels' | 'chat' | 'me';

export interface ProfileLink {
  t: string;
  u: string;
}

export interface ProfileNote {
  tx: string;
  dur: 24 | 48;
  exp: number;
}

export interface UserProfile {
  id: string;
  n: string;
  h: string;
  c: [string, string];
  on?: boolean;
  lastSeen?: number;
  priv?: boolean;
  bio?: string;
  loc?: string;
  img?: string;
  covImg?: string;
  cv?: number | null;
  links?: ProfileLink[];
  note?: ProfileNote | null;
  since?: number;
  fwr?: number;
  fg?: number;
  hideFollowers?: boolean;
  hideFollowing?: boolean;
  showActivity?: boolean;
}

export interface PollOption {
  t: string;
  v: string[];
}

export interface PostComment {
  id: string;
  u: string;
  tx: string;
  t: number;
}

export interface Post {
  id: string;
  u: string;
  type: 'image' | 'video' | 'text' | 'poll';
  src?: string;
  previewSrc?: string;
  imgs?: string[];
  ar?: number;
  bg?: number;
  reel?: boolean;
  cap: string;
  t: number;
  likes: string[];
  saved: string[];
  cm: PostComment[];
  rp: string[];
  music?: string;
  opts?: PollOption[];
  pin?: boolean;
  cx?: number;
  cy?: number;
  quality?: MediaQuality;
  hdr?: boolean;
  keepOriginal?: boolean;
  estimatedBytes?: number;
  originNodeId?: string;
}

export interface Story {
  id: string;
  u: string;
  type: 'image' | 'text';
  src?: string;
  tx?: string;
  bg?: number;
  t: number;
  exp: number;
  seen: string[];
}

export interface Highlight {
  id: string;
  t: string;
  src: string;
  items: Story[];
}

export interface NotificationItem {
  id: string;
  type: 'like' | 'acc' | 'cm' | 'fw' | 'news';
  u?: string;
  tx?: string;
  t: number;
  r: boolean;
}

export interface ChatMessage {
  id: string;
  clientMsgId?: string;
  m: string; // 'me' | 'o' | 'sys' | userId
  k: 't' | 'img' | 'vid' | 'aud' | 'file' | 'stk' | 'poll' | 'loc';
  tx?: string;
  img?: string;
  mediaId?: string;
  mediaUrl?: string;
  nm?: string;
  sz?: number;
  t: number;
  read?: boolean;
  pending?: boolean;
  ed?: boolean;
  star?: boolean;
  pin?: boolean;
  rx?: string;
  qt?: string;
  st?: string;
  fx?: string;
  sfx?: string;
  once?: boolean;
  opened?: boolean;
  exp?: number;
  opts?: PollOption[];
  place?: string;
}

export interface ChatThreadConfig {
  nick?: string;
  pin?: boolean;
  muted?: boolean;
  ci?: number;
  wp?: number;
  quickEmoji?: string;
  disappear?: number;
  unread?: number;
}

export interface GroupInfo {
  id: string;
  n: string;
  desc: string;
  rules: string;
  themeEmoji: string;
  adminOnly: boolean;
  slowMode: number;
  disappear: number;
  mem: string[];
  admins: string[];
  nicks: Record<string, string>;
  c: [string, string];
  img?: string;
}

export interface StickerItem {
  id: string;
  src: string;
}

export interface SafetyReport {
  id: string;
  targetType: 'user' | 'post' | 'message';
  targetId: string;
  reason: string;
  details?: string;
  t: number;
}

export interface DeviceSharingPolicy {
  allowSharing: boolean;
  wifiOnly: boolean;
  minBatteryPct: number;
  pauseOnThermal: boolean;
  pauseOnSaveData: boolean;
  maxBandwidthMbps: number;
  onlyAuthorizedFiles: boolean;
}

export interface PerformanceSettings {
  cacheLimitMb: number;
  autoplayVideo: boolean;
  wifiQuality: MediaQuality;
  mobileQuality: MediaQuality;
  playbackResolution: PlaybackResolution;
  preloadEnabled: boolean;
  hdrEnabled: boolean;
  batteryDataSaver: boolean;
  reduceMotion: boolean;
  hideSuggestions: boolean;
}

export interface PrivacySettings {
  privateProfile: boolean;
  hideFollowers: boolean;
  hideFollowing: boolean;
  hidePostsFromPublic: boolean;
  showActivityStatus: boolean;
  whoCanMessage: MessagePermission;
  applyToSearchAndPreviews: boolean;
}

export interface AccountVaultRecord {
  h: string;
  n: string;
  salt: string;
  passHash: string;
  recoveryKeyHash: string;
  recoveryCodesHashes: string[];
  verifiedContact?: string;
  createdAt: number;
}

export interface AppState {
  me: UserProfile;
  fol: Record<string, 'ok' | 'pend'>;
  fwr: string[];
  reqs: string[];
  blocked: string[];
  restricted: string[];
  reports: SafetyReport[];
  theme: ThemeMode;
  ac: number;
  fs: FontScale;
  ini: StartScreen;
  gar: '1' | '45';
  gord: string[];
  posts: Post[];
  stories: Story[];
  hl: Highlight[];
  nt: NotificationItem[];
  stk: StickerItem[];
  chat: Record<string, ChatMessage[]>;
  groups: Record<string, GroupInfo>;
  ct: Record<string, ChatThreadConfig>;
  sharing: DeviceSharingPolicy;
  perf: PerformanceSettings;
  privacy: PrivacySettings;
  offlineQueue: Array<{ threadId: string; msg: ChatMessage }>;
}

export interface PeerNodeMetrics {
  nodeId: string;
  kind: 'local-cache' | 'broadcast-tab' | 'webrtc-peer' | 'ws-relay' | 'recovery-storage';
  label: string;
  rttMs: number;
  bandwidthMbps: number;
  batteryPct: number;
  charging: boolean;
  onCellular: boolean;
  saveData: boolean;
  thermalThrottled: boolean;
  availableSpaceMb: number;
  failureCount: number;
  authorized: boolean;
  online: boolean;
  lastSeen: number;
  hasAssetIds?: string[];
}

export interface NodeDecision {
  selected: PeerNodeMetrics | null;
  ranked: Array<{ node: PeerNodeMetrics; score: number; eligible: boolean; reason?: string }>;
  failoverChain: string[];
}

export interface CachedAssetEntry {
  assetId: string;
  quality: MediaQuality;
  bytes: number;
  mime: string;
  lastAccessed: number;
  expiresAt: number;
  protectedAccountData?: false;
}

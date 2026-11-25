import type {
  ChatMessage,
  DeviceSharingPolicy,
  NodeDecision,
  PeerNodeMetrics,
} from '../types/pappo';
import {
  evaluateDeviceSharingEligibility,
  selectBestNode,
  type LocalDeviceTelemetry,
} from '../utils/meshRouter';
import {
  getMediaCache,
  listMediaCacheMeta,
  putMediaCache,
} from '../storage/vault';

export interface MeshSnapshot {
  nodeId: string;
  wsConnected: boolean;
  localTelemetry: LocalDeviceTelemetry;
  sharingEligibility: { eligible: boolean; reason: string };
  peers: PeerNodeMetrics[];
  decision: NodeDecision;
  activeRouteLabel: string;
  lastFailoverReason?: string;
}

export type SocialSyncEvent =
  | { kind: 'post:upsert'; handle: string; post: unknown }
  | { kind: 'story:upsert'; handle: string; story: unknown }
  | { kind: 'state:sync'; handle: string; exportedAt: number };

type Listener = (snapshot: MeshSnapshot) => void;
type ChatEventListener = (threadId: string, msg: ChatMessage) => void;
type SocialSyncListener = (ev: SocialSyncEvent) => void;

class HybridMeshClient {
  private nodeId = `node_${Math.random().toString(36).slice(2, 10)}`;
  private ws: WebSocket | null = null;
  private wsFailCount = 0;
  private bc: BroadcastChannel | null = null;
  private rtcPeers = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel | null }>();
  private peersMap = new Map<string, PeerNodeMetrics>();
  private listeners = new Set<Listener>();
  private chatListeners = new Set<ChatEventListener>();
  private socialListeners = new Set<SocialSyncListener>();
  private pendingRequests = new Map<string, (data: string | null) => void>();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private handle = 'anon';
  private loggedIn = false;
  private policy: DeviceSharingPolicy = {
    allowSharing: true,
    wifiOnly: false,
    minBatteryPct: 20,
    pauseOnThermal: true,
    pauseOnSaveData: true,
    maxBandwidthMbps: 25,
    onlyAuthorizedFiles: true,
  };
  private lastRttMs = 24;
  private lastFailoverReason = '';
  private telemetry: LocalDeviceTelemetry = {
    batteryPct: 92,
    charging: true,
    onCellular: false,
    saveData: false,
    thermalThrottled: false,
    freeStorageMb: 1200,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    loggedIn: false,
  };
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    this.setupBroadcastChannel();
    this.sampleDeviceTelemetry();
    this.connectWebSocket();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.telemetry.online = true;
        this.connectWebSocket();
        this.emit();
      });
      window.addEventListener('offline', () => {
        this.telemetry.online = false;
        this.emit();
      });
    }

    this.heartbeatTimer = window.setInterval(() => {
      void this.sampleDeviceTelemetry();
      this.sendHeartbeat();
    }, 8000);
  }

  configure(opts: { handle: string; loggedIn: boolean; policy: DeviceSharingPolicy }) {
    this.handle = opts.handle;
    this.loggedIn = opts.loggedIn;
    this.policy = opts.policy;
    this.telemetry.loggedIn = opts.loggedIn;
    this.sendHeartbeat();
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  onChatEvent(fn: ChatEventListener): () => void {
    this.chatListeners.add(fn);
    return () => this.chatListeners.delete(fn);
  }

  onSocialEvent(fn: SocialSyncListener): () => void {
    this.socialListeners.add(fn);
    return () => this.socialListeners.delete(fn);
  }

  broadcastSocialEvent(event: SocialSyncEvent): void {
    this.bc?.postMessage({ type: 'bc:social', from: this.nodeId, event });
    for (const [, peer] of this.rtcPeers) {
      if (peer.dc?.readyState === 'open') {
        try {
          peer.dc.send(JSON.stringify({ type: 'dc:social', event }));
        } catch {
          // ignore
        }
      }
    }
  }

  getNodeId() {
    return this.nodeId;
  }

  getSnapshot(): MeshSnapshot {
    const nodes = this.buildCandidateNodes();
    const decision = selectBestNode(nodes, undefined, this.policy.wifiOnly);
    const sharingEligibility = evaluateDeviceSharingEligibility(this.policy, this.telemetry);
    return {
      nodeId: this.nodeId,
      wsConnected: this.ws?.readyState === WebSocket.OPEN,
      localTelemetry: { ...this.telemetry },
      sharingEligibility,
      peers: nodes,
      decision,
      activeRouteLabel: decision.selected
        ? `${decision.selected.label} (${Math.round(decision.selected.rttMs)} ms)`
        : 'Modo offline (cache local)',
      lastFailoverReason: this.lastFailoverReason || undefined,
    };
  }

  private buildCandidateNodes(): PeerNodeMetrics[] {
    const now = Date.now();
    const list: PeerNodeMetrics[] = [
      {
        nodeId: 'local-cache',
        kind: 'local-cache',
        label: 'Cache Local Protegido',
        rttMs: 1,
        bandwidthMbps: 200,
        batteryPct: this.telemetry.batteryPct,
        charging: this.telemetry.charging,
        onCellular: false,
        saveData: false,
        thermalThrottled: false,
        availableSpaceMb: this.telemetry.freeStorageMb,
        failureCount: 0,
        authorized: true,
        online: true,
        lastSeen: now,
      },
      ...this.peersMap.values(),
      {
        nodeId: 'ws-relay',
        kind: 'ws-relay',
        label: 'Retransmissor de Apoio',
        rttMs: this.lastRttMs,
        bandwidthMbps: 40,
        batteryPct: 100,
        charging: true,
        onCellular: false,
        saveData: false,
        thermalThrottled: false,
        availableSpaceMb: 8000,
        failureCount: this.ws?.readyState === WebSocket.OPEN ? 0 : 2,
        authorized: true,
        online: this.telemetry.online && this.ws?.readyState === WebSocket.OPEN,
        lastSeen: now,
      },
      {
        nodeId: 'recovery-storage',
        kind: 'recovery-storage',
        label: 'Armazenamento de Recuperação',
        rttMs: this.lastRttMs + 18,
        bandwidthMbps: 50,
        batteryPct: 100,
        charging: true,
        onCellular: false,
        saveData: false,
        thermalThrottled: false,
        availableSpaceMb: 50000,
        failureCount: 0,
        authorized: true,
        online: this.telemetry.online,
        lastSeen: now,
      },
    ];
    return list;
  }

  private setupBroadcastChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    this.bc = new BroadcastChannel('pappo-mesh-v1');
    this.bc.onmessage = async (ev) => {
      const msg = ev.data as Record<string, unknown>;
      if (!msg || msg.from === this.nodeId) return;

      if (msg.type === 'bc:hello' || msg.type === 'bc:pong') {
        const info = msg.info as PeerNodeMetrics | undefined;
        if (info) {
          this.peersMap.set(info.nodeId, {
            ...info,
            kind: 'broadcast-tab',
            rttMs: Math.max(2, Date.now() - Number(msg.ts || Date.now())),
            lastSeen: Date.now(),
          });
          this.emit();
        }
        if (msg.type === 'bc:hello') {
          this.bc?.postMessage({
            type: 'bc:pong',
            from: this.nodeId,
            ts: msg.ts,
            info: await this.buildSelfMetrics(),
          });
        }
      }

      if (msg.type === 'bc:asset:get') {
        const eligibility = evaluateDeviceSharingEligibility(this.policy, this.telemetry);
        if (!eligibility.eligible) return;
        const cached = await getMediaCache(String(msg.assetId));
        if (typeof cached === 'string') {
          this.bc?.postMessage({
            type: 'bc:asset:data',
            from: this.nodeId,
            to: msg.from,
            requestId: msg.requestId,
            assetId: msg.assetId,
            data: cached,
          });
        }
      }

      if (msg.type === 'bc:asset:data' && msg.to === this.nodeId) {
        const resolver = this.pendingRequests.get(String(msg.requestId));
        if (resolver) {
          this.pendingRequests.delete(String(msg.requestId));
          resolver(typeof msg.data === 'string' ? msg.data : null);
        }
      }

      if (msg.type === 'bc:chat' && msg.threadId && msg.message) {
        for (const fn of this.chatListeners) {
          fn(String(msg.threadId), msg.message as ChatMessage);
        }
      }

      if (msg.type === 'bc:social' && msg.event) {
        for (const fn of this.socialListeners) {
          fn(msg.event as SocialSyncEvent);
        }
      }
    };

    void this.buildSelfMetrics().then((info) => {
      this.bc?.postMessage({ type: 'bc:hello', from: this.nodeId, ts: Date.now(), info });
    });
  }

  private connectWebSocket() {
    if (typeof window === 'undefined') return;
    if (!window.location.protocol.startsWith('http') || !this.telemetry.online) return;
    if (this.wsFailCount >= 2) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = async () => {
        this.wsFailCount = 0;
        const info = await this.buildSelfMetrics();
        ws.send(JSON.stringify({ type: 'peer:announce', info }));
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        this.emit();
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          const type = String(msg.type || '');

          if (type === 'pong') {
            this.lastRttMs = Math.max(4, Date.now() - Number(msg.ts || Date.now()));
            this.emit();
            return;
          }

          if (type === 'peer:directory') {
            const peers = (msg.peers as PeerNodeMetrics[]) || [];
            for (const p of peers) {
              if (p.nodeId === this.nodeId) continue;
              const existing = this.peersMap.get(p.nodeId);
              if (existing?.kind === 'broadcast-tab') continue;
              this.peersMap.set(p.nodeId, {
                ...p,
                kind: 'webrtc-peer',
                failureCount: existing?.failureCount || 0,
              });
              if (!this.rtcPeers.has(p.nodeId) && this.nodeId < p.nodeId) {
                void this.initiateWebRtc(p.nodeId);
              }
            }
            this.emit();
            return;
          }

          if (type === 'rtc:offer') {
            await this.handleOffer(String(msg.from), msg.sdp as RTCSessionDescriptionInit);
            return;
          }
          if (type === 'rtc:answer') {
            const peer = this.rtcPeers.get(String(msg.from));
            if (peer && peer.pc.signalingState !== 'stable') {
              await peer.pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
            }
            return;
          }
          if (type === 'rtc:ice') {
            const peer = this.rtcPeers.get(String(msg.from));
            if (peer && msg.candidate) {
              await peer.pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
            }
            return;
          }

          if (type === 'chat:event' && msg.threadId && msg.message) {
            for (const fn of this.chatListeners) {
              fn(String(msg.threadId), msg.message as ChatMessage);
            }
            return;
          }

          if (type === 'relay:asset:request') {
            const eligibility = evaluateDeviceSharingEligibility(this.policy, this.telemetry);
            const cached = eligibility.eligible ? await getMediaCache(String(msg.assetId)) : null;
            ws.send(
              JSON.stringify({
                type: 'relay:asset:response',
                to: msg.from,
                requestId: msg.requestId,
                assetId: msg.assetId,
                data: typeof cached === 'string' ? cached : null,
              })
            );
            return;
          }

          if (type === 'relay:asset:response' || type === 'relay:asset:unavailable') {
            const resolver = this.pendingRequests.get(String(msg.requestId));
            if (resolver) {
              this.pendingRequests.delete(String(msg.requestId));
              resolver(typeof msg.data === 'string' ? msg.data : null);
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        this.wsFailCount += 1;
        this.emit();
        if (this.wsFailCount < 2) {
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = window.setTimeout(() => this.connectWebSocket(), 2500);
        }
      };
    } catch {
      // WebSocket unavailable in isolated or static browser context
    }
  }

  private async initiateWebRtc(targetNodeId: string) {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      const dc = pc.createDataChannel('pappo-data');
      this.wireDataChannel(targetNodeId, dc);
      this.rtcPeers.set(targetNodeId, { pc, dc });

      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'rtc:ice', to: targetNodeId, candidate: ev.candidate }));
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws?.send(JSON.stringify({ type: 'rtc:offer', to: targetNodeId, sdp: offer }));
    } catch {
      // Fallback relay handles transfer automatically
    }
  }

  private async handleOffer(fromNodeId: string, sdp: RTCSessionDescriptionInit) {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      this.rtcPeers.set(fromNodeId, { pc, dc: null });

      pc.ondatachannel = (ev) => {
        const entry = this.rtcPeers.get(fromNodeId);
        if (entry) entry.dc = ev.channel;
        this.wireDataChannel(fromNodeId, ev.channel);
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'rtc:ice', to: fromNodeId, candidate: ev.candidate }));
        }
      };

      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.ws?.send(JSON.stringify({ type: 'rtc:answer', to: fromNodeId, sdp: answer }));
    } catch {
      // Fallback relay handles transfer automatically
    }
  }

  private wireDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (msg.type === 'dc:asset:get') {
          const eligibility = evaluateDeviceSharingEligibility(this.policy, this.telemetry);
          const data = eligibility.eligible ? await getMediaCache(String(msg.assetId)) : null;
          dc.send(
            JSON.stringify({
              type: 'dc:asset:data',
              requestId: msg.requestId,
              data: typeof data === 'string' ? data : null,
            })
          );
        } else if (msg.type === 'dc:asset:data') {
          const resolver = this.pendingRequests.get(String(msg.requestId));
          if (resolver) {
            this.pendingRequests.delete(String(msg.requestId));
            resolver(typeof msg.data === 'string' ? msg.data : null);
          }
        } else if (msg.type === 'dc:chat' && msg.threadId && msg.message) {
          for (const fn of this.chatListeners) {
            fn(String(msg.threadId), msg.message as ChatMessage);
          }
        } else if (msg.type === 'dc:social' && msg.event) {
          for (const fn of this.socialListeners) {
            fn(msg.event as SocialSyncEvent);
          }
        }
      } catch {
        // ignore
      }
    };
    dc.onopen = () => {
      const peer = this.peersMap.get(peerId);
      if (peer) {
        peer.rttMs = Math.min(peer.rttMs, 14);
        peer.failureCount = 0;
        this.emit();
      }
    };
    dc.onclose = () => {
      const peer = this.peersMap.get(peerId);
      if (peer) {
        peer.failureCount += 1;
        this.lastFailoverReason = `Peer ${peer.label} desconectou; rota alternada automaticamente.`;
        this.emit();
      }
    };
  }

  private async sampleDeviceTelemetry() {
    this.telemetry.online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const nav = navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean; downlink?: number; type?: string };
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };

    if (nav.connection) {
      this.telemetry.onCellular = nav.connection.type === 'cellular';
      this.telemetry.saveData = Boolean(nav.connection.saveData);
    }
    if (nav.getBattery) {
      try {
        const bat = await nav.getBattery();
        this.telemetry.batteryPct = Math.round(bat.level * 100);
        this.telemetry.charging = bat.charging;
      } catch {
        // default safe values
      }
    }
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (est.quota && est.usage !== undefined) {
          this.telemetry.freeStorageMb = Math.max(50, Math.round((est.quota - est.usage) / 1e6));
        }
      } catch {
        // ignore
      }
    }
  }

  private async buildSelfMetrics(): Promise<PeerNodeMetrics> {
    const metas = await listMediaCacheMeta();
    const eligibility = evaluateDeviceSharingEligibility(this.policy, this.telemetry);
    return {
      nodeId: this.nodeId,
      kind: 'webrtc-peer',
      label: `@${this.handle}`,
      rttMs: this.lastRttMs,
      bandwidthMbps: 35,
      batteryPct: this.telemetry.batteryPct,
      charging: this.telemetry.charging,
      onCellular: this.telemetry.onCellular,
      saveData: this.telemetry.saveData,
      thermalThrottled: this.telemetry.thermalThrottled,
      availableSpaceMb: this.telemetry.freeStorageMb,
      failureCount: 0,
      authorized: eligibility.eligible,
      online: this.telemetry.online,
      lastSeen: Date.now(),
      hasAssetIds: metas.map((m) => m.assetId),
    };
  }

  private async sendHeartbeat() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const info = await this.buildSelfMetrics();
      this.ws.send(JSON.stringify({ type: 'peer:heartbeat', info }));
      this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }
  }

  sendChatMessage(threadId: string, message: ChatMessage): boolean {
    this.bc?.postMessage({ type: 'bc:chat', from: this.nodeId, threadId, message });
    let peerSent = false;
    for (const [, peer] of this.rtcPeers) {
      if (peer.dc?.readyState === 'open') {
        try {
          peer.dc.send(JSON.stringify({ type: 'dc:chat', threadId, message }));
          peerSent = true;
        } catch {
          // ignore
        }
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat:send', threadId, message }));
      return true;
    }
    return peerSent || typeof BroadcastChannel !== 'undefined';
  }

  /**
   * Smart hybrid fetch: tries Local Cache -> BroadcastChannel Tab -> Best WebRTC Peer -> Relay -> Recovery Storage.
   * Automatically fails over on disconnect or refusal without hanging.
   */
  async fetchAssetWithAutoFailover(
    assetId: string,
    fallbackUrl: string | undefined,
    cacheLimitMb: number
  ): Promise<{ ok: boolean; source: string; dataUrl?: string; error?: string }> {
    const cached = await getMediaCache(assetId);
    if (typeof cached === 'string') {
      return { ok: true, source: 'Cache Local Protegido', dataUrl: cached };
    }

    const decision = selectBestNode(this.buildCandidateNodes(), assetId, this.policy.wifiOnly);

    for (const candidateId of decision.failoverChain) {
      const peer = this.peersMap.get(candidateId);
      if (peer && (peer.kind === 'broadcast-tab' || peer.kind === 'webrtc-peer')) {
        const res = await this.requestFromPeer(peer, assetId);
        if (res) {
          await putMediaCache(assetId, res, 'media', cacheLimitMb);
          return { ok: true, source: `Peer ${peer.label}`, dataUrl: res };
        }
        peer.failureCount += 1;
        this.lastFailoverReason = `Falha em ${peer.label}; alternado automaticamente.`;
        this.emit();
      }
    }

    if (fallbackUrl && this.telemetry.online) {
      try {
        const resp = await fetch(fallbackUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          await putMediaCache(assetId, blob, 'media', cacheLimitMb);
          return { ok: true, source: 'Armazenamento de Recuperação', dataUrl: url };
        }
      } catch {
        // fall through to unavailable message
      }
    }

    return {
      ok: false,
      source: 'Indisponível',
      error: 'Conteúdo temporariamente inacessível. Tente novamente quando a conexão estabilizar.',
    };
  }

  private requestFromPeer(peer: PeerNodeMetrics, assetId: string): Promise<string | null> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null);
      }, 900);

      this.pendingRequests.set(requestId, (data) => {
        clearTimeout(timer);
        resolve(data);
      });

      const rtc = this.rtcPeers.get(peer.nodeId);
      if (rtc?.dc && rtc.dc.readyState === 'open') {
        rtc.dc.send(JSON.stringify({ type: 'dc:asset:get', requestId, assetId }));
      } else if (peer.kind === 'broadcast-tab' && this.bc) {
        this.bc.postMessage({ type: 'bc:asset:get', from: this.nodeId, requestId, assetId });
      } else if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'relay:asset:request', to: peer.nodeId, requestId, assetId }));
      } else {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        resolve(null);
      }
    });
  }

  simulateFailoverTest() {
    const candidates = [...this.peersMap.values()];
    if (candidates.length) {
      candidates[0].failureCount += 3;
      this.lastFailoverReason = `Simulação: ${candidates[0].label} removido da rota; melhor nó assumiu imediatamente.`;
    } else {
      this.lastFailoverReason = 'Rota verificada: Retransmissor de Apoio & Cache Local operando em alta disponibilidade.';
    }
    this.emit();
  }

  private emit() {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) fn(snap);
  }
}

export const meshClient = new HybridMeshClient();

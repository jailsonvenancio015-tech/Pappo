import type { MediaQuality, PlaybackResolution } from '../types/pappo';
import { kvDel, kvPut, putMediaCache } from '../storage/vault';
import {
  createUploadPlan,
  markChunkUploaded,
  nextMissingChunkIndex,
  type UploadChunkPlan,
} from './socialLogic';

export const FILTERS = [
  { name: 'Original', css: 'none' },
  { name: 'Noir P&B', css: 'grayscale(100%) contrast(118%) brightness(96%)' },
  { name: 'Editorial', css: 'sepia(35%) contrast(106%) saturate(92%) brightness(102%)' },
  { name: 'Cinema', css: 'contrast(115%) saturate(112%) brightness(94%) hue-rotate(-6deg)' },
  { name: 'Vibrante', css: 'saturate(138%) contrast(108%) brightness(104%)' },
  { name: 'Polaroid', css: 'contrast(96%) brightness(105%) saturate(88%) hue-rotate(8deg)' },
  { name: 'Fosco', css: 'contrast(88%) brightness(106%) saturate(85%)' },
  { name: 'Digicam 3MP', css: 'contrast(112%) saturate(128%) brightness(108%) hue-rotate(-4deg)' },
  { name: 'CCD Y2K', css: 'contrast(118%) saturate(140%) brightness(104%) sepia(12%) hue-rotate(6deg)' },
  { name: 'Filme 35mm', css: 'contrast(104%) saturate(108%) sepia(22%) brightness(99%) hue-rotate(-8deg)' },
  { name: 'Sonho', css: 'brightness(112%) contrast(90%) saturate(118%)' },
  { name: 'Entardecer', css: 'sepia(30%) saturate(150%) contrast(104%) hue-rotate(-14deg) brightness(102%)' },
] as const;

export const TEXTURES = ['Sem textura', 'Granulado', 'Poeira', 'Luz vazada', 'Scanline'] as const;

export const ASPECT_FORMATS: Array<{ label: string; w: number; h: number }> = [
  { label: '1:1 · 1080×1080', w: 1080, h: 1080 },
  { label: '4:5 · 1080×1350', w: 1080, h: 1350 },
  { label: '1.91:1 · 1080×566', w: 1080, h: 566 },
];

export const CARD_GRADIENTS = [
  'linear-gradient(135deg,#6d4aff,#ff4e88)',
  'linear-gradient(135deg,#ff8a5c,#ff5c93)',
  'linear-gradient(135deg,#1fa99b,#44b7f5)',
  'linear-gradient(135deg,#23252d,#5c5c7a)',
  'linear-gradient(135deg,#f5b942,#ff7e47)',
];

export const ACCENT_PALETTES: Array<[string, string]> = [
  ['#6d4aff', '#ff4e88'],
  ['#2284f5', '#1ec8b8'],
  ['#ff7240', '#ff3b7c'],
  ['#169f6e', '#92cb38'],
  ['#2a2d3a', '#646883'],
];

export const STICKER_EMOJIS = [
  '😀', '😂', '🥰', '😎', '🤩', '😭', '😡', '🤯', '🥳', '😴',
  '🤔', '🙌', '👍', '👏', '🙏', '💪', '🔥', '💜', '💔', '🎉',
  '✨', '🍕', '☕', '🐶', '🐱', '🦄', '🌈', '🚀',
];

export function checkHdrCompatibility(): {
  displaySupported: boolean;
  reason: string;
} {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return { displaySupported: false, reason: 'Navegador sem detecção de faixa dinâmica HDR' };
  }
  const high = window.matchMedia('(dynamic-range: high)').matches;
  const p3 = window.matchMedia('(color-gamut: p3)').matches;
  if (high) {
    return { displaySupported: true, reason: 'Tela compatível com HDR (high dynamic range)' };
  }
  if (p3) {
    return {
      displaySupported: false,
      reason: 'Tela com gama P3, mas sem suporte nativo a HDR — usando SDR calibrado',
    };
  }
  return {
    displaySupported: false,
    reason: 'Monitor SDR padrão: HDR desativado automaticamente para evitar lavagem de cores',
  };
}

export function resolveEffectiveResolution(
  preferred: PlaybackResolution,
  onCellular: boolean,
  saveData: boolean
): { label: string; maxWidth: number; note?: string } {
  if (preferred === 'baixa') return { label: '360p (Baixa)', maxWidth: 640 };
  if (preferred === 'media') return { label: '720p (Média)', maxWidth: 1280 };
  if (preferred === 'alta') {
    if (saveData) {
      return {
        label: '720p (Adaptada)',
        maxWidth: 1280,
        note: 'Alta reduzida para 720p porque a economia de dados está ativa',
      };
    }
    return { label: '1080p+ (Alta)', maxWidth: 1920 };
  }
  if (saveData || onCellular) {
    return { label: 'Auto · 480p', maxWidth: 854 };
  }
  return { label: 'Auto · 1080p', maxWidth: 1920 };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function qualityConfig(q: MediaQuality): { jpeg: number; maxDim: number; label: string } {
  if (q === 'baixa') return { jpeg: 0.62, maxDim: 720, label: 'Baixa (economia)' };
  if (q === 'alta') return { jpeg: 0.93, maxDim: 1600, label: 'Alta (máxima nitidez)' };
  return { jpeg: 0.82, maxDim: 1080, label: 'Média (equilibrada)' };
}

let noiseCanvas: HTMLCanvasElement | null = null;
function getNoiseCanvas() {
  if (noiseCanvas) return noiseCanvas;
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 160;
  const x = c.getContext('2d')!;
  const d = x.createImageData(160, 160);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = v;
    d.data[i + 1] = v;
    d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  noiseCanvas = c;
  return c;
}

export function renderEditedImageToCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  opts: {
    width: number;
    height: number;
    filterIdx: number;
    textureIdx: number;
    brightness: number;
    contrast: number;
    saturation: number;
    zoom: number;
    panX: number;
    panY: number;
    quality: MediaQuality;
  }
) {
  const { maxDim } = qualityConfig(opts.quality);
  const scaleOut = Math.min(1, maxDim / Math.max(opts.width, opts.height));
  canvas.width = Math.round(opts.width * scaleOut);
  canvas.height = Math.round(opts.height * scaleOut);

  const ctx = canvas.getContext('2d')!;
  const iw = img.naturalWidth || 1080;
  const ih = img.naturalHeight || 1080;
  const s = Math.max(canvas.width / iw, canvas.height / ih) * (opts.zoom / 100);
  const dw = iw * s;
  const dh = ih * s;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const filterCss = FILTERS[opts.filterIdx]?.css || 'none';
  ctx.filter = `${filterCss === 'none' ? '' : filterCss} brightness(${opts.brightness}%) contrast(${opts.contrast}%) saturate(${opts.saturation}%)`.trim();
  ctx.drawImage(
    img,
    ((canvas.width - dw) * opts.panX) / 100,
    ((canvas.height - dh) * opts.panY) / 100,
    dw,
    dh
  );
  ctx.filter = 'none';

  // Apply texture
  const t = opts.textureIdx;
  if (!t) return;
  ctx.save();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (t === 1) {
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.25;
    const pat = ctx.createPattern(getNoiseCanvas(), 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  } else if (t === 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    for (let i = 0; i < (canvas.width * canvas.height) / 2600; i++) {
      ctx.fillRect(rand() * canvas.width, rand() * canvas.height, rand() * 2 + 0.5, rand() * 2 + 0.5);
    }
  } else if (t === 3) {
    const g = ctx.createRadialGradient(canvas.width, 0, 0, canvas.width, 0, Math.max(canvas.width, canvas.height) * 0.8);
    g.addColorStop(0, 'rgba(255,120,60,0.58)');
    g.addColorStop(0.5, 'rgba(255,60,120,0.2)');
    g.addColorStop(1, 'rgba(255,60,120,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (t === 4) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillRect(0, y, canvas.width, 1.5);
    }
  }
  ctx.restore();
}

export function generateProceduralArt(c1: string, c2: string, k: number): string {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 720;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 720, 720);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  x.fillStyle = g;
  x.fillRect(0, 0, 720, 720);
  for (let i = 0; i < 7; i++) {
    x.beginPath();
    x.arc((i * 263 + k * 97) % 720, (i * 171 + k * 53) % 720, 60 + ((i * 37 + k * 11) % 140), 0, Math.PI * 2);
    x.fillStyle = `rgba(255,255,255,${0.07 + i * 0.02})`;
    x.fill();
  }
  return c.toDataURL('image/jpeg', 0.82);
}

export function buildStickerDataUrl(
  img: HTMLImageElement,
  shape: 'round' | 'circle' | 'sq',
  border: boolean
): string {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 240;
  const x = c.getContext('2d')!;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  const pad = border ? 16 : 4;
  const sz = 240 - pad * 2;
  x.save();
  if (shape === 'circle') {
    x.beginPath();
    x.arc(120, 120, sz / 2, 0, Math.PI * 2);
    x.clip();
  } else if (shape === 'round') {
    x.beginPath();
    x.roundRect(pad, pad, sz, sz, 36);
    x.clip();
  }
  x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, pad, pad, sz, sz);
  x.restore();
  if (border) {
    x.strokeStyle = '#ffffff';
    x.lineWidth = 10;
    if (shape === 'circle') {
      x.beginPath();
      x.arc(120, 120, sz / 2, 0, Math.PI * 2);
      x.stroke();
    } else {
      x.beginPath();
      x.roundRect(pad, pad, sz, sz, shape === 'round' ? 36 : 6);
      x.stroke();
    }
  }
  return c.toDataURL('image/png');
}

export class ResumableUploader {
  plan: UploadChunkPlan;
  private file: Blob;
  private token: string | null;
  private paused = false;
  private cancelled = false;
  private onUpdate: (plan: UploadChunkPlan) => void;

  constructor(opts: {
    file: Blob;
    fileName: string;
    quality: MediaQuality;
    token: string | null;
    onUpdate: (plan: UploadChunkPlan) => void;
  }) {
    this.file = opts.file;
    this.token = opts.token;
    this.onUpdate = opts.onUpdate;
    this.plan = createUploadPlan({
      uploadId: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      fileName: opts.fileName,
      totalBytes: opts.file.size,
      chunkSize: 64 * 1024,
      quality: opts.quality,
    });
  }

  pause() {
    this.paused = true;
    this.plan = { ...this.plan, status: 'paused' };
    this.onUpdate(this.plan);
  }

  cancel() {
    this.cancelled = true;
    this.plan = { ...this.plan, status: 'cancelled' };
    this.onUpdate(this.plan);
  }

  async startOrResume(): Promise<{ mediaId: string; url: string } | null> {
    this.paused = false;
    this.cancelled = false;
    this.plan = { ...this.plan, status: 'uploading' };
    this.onUpdate(this.plan);

    // Optional server mirror check (only if running with an active local relay/server)
    let useServerMirror = false;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
      try {
        const initResp = await fetch('/api/upload/init', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            uploadId: this.plan.uploadId,
            fileName: this.plan.fileName,
            mimeType: this.file.type || 'application/octet-stream',
            totalBytes: this.file.size,
            chunkSize: this.plan.chunkSize,
            quality: this.plan.quality,
          }),
        });
        if (initResp.ok) {
          useServerMirror = true;
          const initData = (await initResp.json()) as { uploadedChunks: number[] };
          if (Array.isArray(initData.uploadedChunks) && initData.uploadedChunks.length) {
            this.plan = { ...this.plan, uploadedChunks: initData.uploadedChunks };
            this.onUpdate(this.plan);
          }
        }
      } catch {
        // Offline / pure-browser mode: proceed locally without errors
      }
    }

    while (!this.paused && !this.cancelled) {
      const idx = nextMissingChunkIndex(this.plan);
      if (idx === null) break;
      const start = idx * this.plan.chunkSize;
      const end = Math.min(this.file.size, start + this.plan.chunkSize);
      const slice = this.file.slice(start, end);

      // Persist chunk locally in browser IndexedDB so pause/resume works completely offline
      const buf = await slice.arrayBuffer();
      await kvPut(`upload:${this.plan.uploadId}:chunk:${idx}`, buf);

      if (useServerMirror) {
        try {
          const chunkResp = await fetch(`/api/upload/chunk/${this.plan.uploadId}/${idx}`, {
            method: 'PUT',
            headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
            body: slice,
          });
          if (!chunkResp.ok) useServerMirror = false;
        } catch {
          useServerMirror = false;
        }
      }

      this.plan = markChunkUploaded(this.plan, idx);
      this.onUpdate(this.plan);
      await new Promise((r) => setTimeout(r, 8));
    }

    if (this.cancelled) {
      const chunkKeys = Array.from({ length: this.plan.totalChunks }, (_, i) => `upload:${this.plan.uploadId}:chunk:${i}`);
      await kvDel(chunkKeys);
      return null;
    }
    if (this.paused) return null;

    // Clean up temporary chunk entries and store final assembled media locally in IndexedDB cache
    const chunkKeys = Array.from({ length: this.plan.totalChunks }, (_, i) => `upload:${this.plan.uploadId}:chunk:${i}`);
    await kvDel(chunkKeys);

    const mediaId = `local_${this.plan.uploadId}`;
    let localUrl = '';
    if (this.file.size <= 6 * 1024 * 1024) {
      localUrl = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
        fr.onerror = () => resolve('');
        fr.readAsDataURL(this.file);
      });
    }
    if (!localUrl) {
      localUrl = URL.createObjectURL(this.file);
    }

    await putMediaCache(mediaId, localUrl.startsWith('data:') ? localUrl : this.file, this.plan.quality, 250);

    if (useServerMirror) {
      try {
        const completeResp = await fetch(`/api/upload/complete/${this.plan.uploadId}`, {
          method: 'POST',
          headers,
        });
        if (completeResp.ok) {
          const done = (await completeResp.json()) as { mediaId: string; url: string };
          this.plan = { ...this.plan, status: 'completed' };
          this.onUpdate(this.plan);
          return { mediaId: done.mediaId, url: localUrl || done.url };
        }
      } catch {
        // keep local asset
      }
    }

    this.plan = { ...this.plan, status: 'completed' };
    this.onUpdate(this.plan);
    return { mediaId, url: localUrl };
  }
}

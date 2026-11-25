import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { PlaybackResolution } from '../types/pappo';
import { checkHdrCompatibility, resolveEffectiveResolution } from '../utils/mediaTools';
import { meshClient } from '../network/p2pClient';

interface AdaptiveMediaPlayerProps {
  src?: string;
  assetId: string;
  poster?: string;
  isReel?: boolean;
  autoplay: boolean;
  defaultResolution: PlaybackResolution;
  hdrPreferred: boolean;
  onCellular: boolean;
  saveData: boolean;
  cacheLimitMb: number;
}

export function AdaptiveMediaPlayer({
  src,
  assetId,
  poster,
  isReel = false,
  autoplay,
  defaultResolution,
  hdrPreferred,
  onCellular,
  saveData,
  cacheLimitMb,
}: AdaptiveMediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(src);
  const [sourceLabel, setSourceLabel] = useState('Carregando…');
  const [loadError, setLoadError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [resolution, setResolution] = useState<PlaybackResolution>(defaultResolution);
  const [hdrActive, setHdrActive] = useState(hdrPreferred);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);

  const hdrCompat = checkHdrCompatibility();
  const resInfo = resolveEffectiveResolution(resolution, onCellular, saveData);

  useEffect(() => {
    let active = true;
    if (src && src.startsWith('blob:')) {
      setResolvedUrl(src);
      setSourceLabel('Cache Local Protegido');
      return;
    }
    void meshClient.fetchAssetWithAutoFailover(assetId, src, cacheLimitMb).then((res) => {
      if (!active) return;
      if (res.ok && res.dataUrl) {
        setResolvedUrl(res.dataUrl);
        setSourceLabel(res.source);
        setLoadError('');
      } else if (src) {
        setResolvedUrl(src);
        setSourceLabel('Fluxo direto');
      } else {
        setLoadError(res.error || 'Conteúdo temporariamente inacessível');
      }
    });
    return () => {
      active = false;
    };
  }, [assetId, src, cacheLimitMb]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !autoplay || !resolvedUrl) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            v.play().then(() => setPlaying(true)).catch(() => {});
          } else {
            v.pause();
            setPlaying(false);
          }
        }
      },
      { threshold: 0.6 }
    );
    obs.observe(v);
    return () => obs.disconnect();
  }, [autoplay, resolvedUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const handleFullscreen = () => {
    const v = videoRef.current;
    if (v?.requestFullscreen) {
      void v.requestFullscreen().catch(() => {});
    }
  };

  if (loadError) {
    return (
      <div className="bg-zinc-950 text-zinc-200 p-8 flex flex-col items-center justify-center gap-2 text-center">
        <AlertCircle className="w-7 h-7 text-amber-400" />
        <p className="text-sm font-medium">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="relative bg-black group overflow-hidden">
      <video
        ref={videoRef}
        src={resolvedUrl}
        poster={poster}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration) setProgress((el.currentTime / el.duration) * 100);
        }}
        onClick={togglePlay}
        className={`w-full block cursor-pointer ${
          isReel ? 'aspect-[9/16] max-h-[75dvh] mx-auto object-cover' : 'max-h-[580px] object-contain'
        }`}
        style={{
          filter: hdrActive && hdrCompat.displaySupported ? 'contrast(1.06) saturate(1.08)' : undefined,
        }}
      />

      {/* Scrim & Controls */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 space-y-2 text-white">
        {/* Progress seek bar */}
        <input
          type="range"
          min={0}
          max={100}
          value={progress}
          aria-label="Progresso do vídeo"
          onChange={(e) => {
            const v = videoRef.current;
            if (v && v.duration) {
              v.currentTime = (Number(e.target.value) / 100) * v.duration;
              setProgress(Number(e.target.value));
            }
          }}
          className="w-full h-1 accent-white cursor-pointer"
        />

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? 'Pausar vídeo' : 'Reproduzir vídeo'}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Ativar som' : 'Silenciar vídeo'}
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label="Velocidade de reprodução"
              className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-mono-num"
            >
              {speed}x
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              aria-label="Resolução de reprodução"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as PlaybackResolution)}
              className="bg-white/15 text-white text-xs rounded-lg px-2 py-1 outline-none border border-white/20"
            >
              <option value="auto" className="text-black">Auto</option>
              <option value="baixa" className="text-black">Baixa (360p)</option>
              <option value="media" className="text-black">Média (720p)</option>
              <option value="alta" className="text-black">Alta (1080p)</option>
            </select>

            <button
              type="button"
              onClick={() => setHdrActive((v) => !v)}
              title={hdrCompat.reason}
              aria-label="Alternar HDR"
              className={`px-2 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap ${
                hdrActive && hdrCompat.displaySupported
                  ? 'bg-amber-400 text-black border-amber-300'
                  : 'bg-white/10 text-white/80 border-white/20'
              }`}
            >
              {hdrCompat.displaySupported ? (hdrActive ? 'HDR Ativo' : 'HDR Off') : 'HDR Indisp.'}
            </button>

            <button
              type="button"
              onClick={handleFullscreen}
              aria-label="Tela cheia"
              className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 grid place-items-center"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-white/75">
          <span>{resInfo.label}{resInfo.note ? ` · ${resInfo.note}` : ''}</span>
          <span>Fonte: {sourceLabel}</span>
        </div>
      </div>
    </div>
  );
}

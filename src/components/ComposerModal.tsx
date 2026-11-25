import React, { useEffect, useRef, useState } from 'react';
import { BarChart2, Image as ImageIcon, Pause, Play, Sparkles, X } from 'lucide-react';
import type { MediaQuality, Post, Story } from '../types/pappo';
import {
  ASPECT_FORMATS,
  CARD_GRADIENTS,
  FILTERS,
  ResumableUploader,
  TEXTURES,
  formatBytes,
  qualityConfig,
  renderEditedImageToCanvas,
} from '../utils/mediaTools';
import { estimateMediaBytes, type UploadChunkPlan } from '../utils/socialLogic';

interface ComposerModalProps {
  mode: 'post' | 'story';
  defaultQuality: MediaQuality;
  authToken: string | null;
  onClose: () => void;
  onPublishPost: (post: Post) => void;
  onPublishStory: (story: Story) => void;
  onNotify: (msg: string) => void;
}

export function ComposerModal({
  mode,
  defaultQuality,
  authToken,
  onClose,
  onPublishPost,
  onPublishStory,
  onNotify,
}: ComposerModalProps) {
  const isStory = mode === 'story';
  const [stepType, setStepType] = useState<'pick' | 'image' | 'video' | 'text' | 'poll'>('pick');

  // Image editor state
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [formatIdx, setFormatIdx] = useState(0);
  const [filterIdx, setFilterIdx] = useState(0);
  const [textureIdx, setTextureIdx] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [zoom, setZoom] = useState(100);
  const [panX, setPanX] = useState(50);
  const [panY, setPanY] = useState(50);

  // Video state + Resumable upload
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isReel, setIsReel] = useState(false);
  const [uploadPlan, setUploadPlan] = useState<UploadChunkPlan | null>(null);
  const uploaderRef = useRef<ResumableUploader | null>(null);

  // Quality & Storage options (Spec Section 4)
  const [quality, setQuality] = useState<MediaQuality>(defaultQuality);
  const [keepOriginal, setKeepOriginal] = useState(false);

  // Text / Poll / Metadata
  const [cardBg, setCardBg] = useState(0);
  const [cardText, setCardText] = useState('');
  const [pollOpts, setPollOpts] = useState(['', '']);
  const [caption, setCaption] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [storyDur, setStoryDur] = useState<24 | 48>(24);
  const [publishing, setPublishing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const im = images[activeSlide];
    if (stepType !== 'image' || !cv || !im) return;
    const dim = isStory ? { w: 1080, h: 1920 } : ASPECT_FORMATS[formatIdx];
    renderEditedImageToCanvas(cv, im, {
      width: dim.w,
      height: dim.h,
      filterIdx,
      textureIdx,
      brightness,
      contrast,
      saturation,
      zoom,
      panX,
      panY,
      quality,
    });
  }, [
    stepType,
    images,
    activeSlide,
    isStory,
    formatIdx,
    filterIdx,
    textureIdx,
    brightness,
    contrast,
    saturation,
    zoom,
    panX,
    panY,
    quality,
  ]);

  const loadFiles = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const first = files[0];
    if (first.type.startsWith('video/')) {
      setVideoFile(first);
      setVideoUrl(URL.createObjectURL(first));
      setStepType('video');
      return;
    }

    const loaded = await Promise.all(
      [...files]
        .filter((f) => f.type.startsWith('image/'))
        .slice(0, isStory ? 1 : 10)
        .map(
          (f) =>
            new Promise<HTMLImageElement | null>((res) => {
              const img = new Image();
              img.onload = () => res(img);
              img.onerror = () => res(null);
              img.src = URL.createObjectURL(f);
            })
        )
    );
    const valid = loaded.filter((x): x is HTMLImageElement => Boolean(x));
    if (valid.length) {
      setImages((prev) => [...prev, ...valid].slice(0, 10));
      setActiveSlide(0);
      setStepType('image');
    }
  };

  const estimatedRawBytes =
    stepType === 'video' && videoFile
      ? videoFile.size
      : stepType === 'image'
      ? images.length * 1_100_000
      : 4_000;
  const estimate = estimateMediaBytes(estimatedRawBytes, quality, keepOriginal);

  const handlePublish = async () => {
    const now = Date.now();
    const id = `p_${now}`;
    setPublishing(true);

    try {
      if (stepType === 'image') {
        const dim = isStory ? { w: 1080, h: 1920 } : ASPECT_FORMATS[formatIdx];
        const cfg = qualityConfig(quality);
        const cv = document.createElement('canvas');
        const outUrls: string[] = [];
        for (const im of images) {
          renderEditedImageToCanvas(cv, im, {
            width: dim.w,
            height: dim.h,
            filterIdx,
            textureIdx,
            brightness,
            contrast,
            saturation,
            zoom,
            panX,
            panY,
            quality,
          });
          outUrls.push(cv.toDataURL('image/jpeg', cfg.jpeg));
        }

        if (isStory) {
          onPublishStory({
            id,
            u: 'me',
            type: 'image',
            src: outUrls[0],
            t: now,
            exp: now + storyDur * 3_600_000,
            seen: [],
          });
          onClose();
          return;
        }

        onPublishPost({
          id,
          u: 'me',
          type: 'image',
          src: outUrls[0],
          imgs: outUrls.length > 1 ? outUrls : undefined,
          ar: Number((cv.width / cv.height).toFixed(3)),
          cap: caption.trim(),
          t: now,
          likes: [],
          saved: [],
          cm: [],
          rp: [],
          music: musicUrl.trim() || undefined,
          quality,
          keepOriginal,
          estimatedBytes: estimate.totalBytes,
        });
        onClose();
        return;
      }

      if (stepType === 'video' && videoFile) {
        const uploader = new ResumableUploader({
          file: videoFile,
          fileName: videoFile.name,
          quality,
          token: authToken,
          onUpdate: (plan) => setUploadPlan(plan),
        });
        uploaderRef.current = uploader;
        const result = await uploader.startOrResume();
        if (!result) {
          setPublishing(false);
          return;
        }
        onPublishPost({
          id,
          u: 'me',
          type: 'video',
          src: result.url,
          reel: isReel,
          cap: caption.trim(),
          t: now,
          likes: [],
          saved: [],
          cm: [],
          rp: [],
          music: musicUrl.trim() || undefined,
          quality,
          keepOriginal,
          estimatedBytes: estimate.totalBytes,
        });
        onClose();
        return;
      }

      if (stepType === 'text') {
        const txt = cardText.trim();
        if (!txt) {
          onNotify('Escreva um texto antes de publicar');
          setPublishing(false);
          return;
        }
        if (isStory) {
          onPublishStory({
            id,
            u: 'me',
            type: 'text',
            tx: txt,
            bg: cardBg,
            t: now,
            exp: now + storyDur * 3_600_000,
            seen: [],
          });
        } else {
          onPublishPost({
            id,
            u: 'me',
            type: 'text',
            bg: cardBg,
            cap: txt,
            t: now,
            likes: [],
            saved: [],
            cm: [],
            rp: [],
            music: musicUrl.trim() || undefined,
          });
        }
        onClose();
        return;
      }

      if (stepType === 'poll') {
        const validOpts = pollOpts.map((o) => o.trim()).filter(Boolean);
        if (validOpts.length < 2) {
          onNotify('Adicione pelo menos 2 opções na enquete');
          setPublishing(false);
          return;
        }
        onPublishPost({
          id,
          u: 'me',
          type: 'poll',
          cap: caption.trim() || 'Enquete',
          opts: validOpts.map((t) => ({ t, v: [] })),
          t: now,
          likes: [],
          saved: [],
          cm: [],
          rp: [],
        });
        onClose();
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm grid place-items-center p-3">
      <div className="w-full max-w-4xl max-h-[92dvh] overflow-y-auto bg-[var(--card)] border border-[var(--line)] rounded-3xl shadow-2xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] sticky top-0 bg-[var(--card)] z-10">
          <h2 className="font-display font-bold text-base">
            {isStory ? 'Novo Story (9:16)' : 'Criar publicação'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar criador"
            className="w-9 h-9 rounded-full grid place-items-center hover:bg-[var(--bg)]"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {stepType === 'pick' ? (
          <div className={`grid gap-3 p-5 ${isStory ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
            <label className="flex flex-col items-center justify-center gap-2.5 p-7 rounded-2xl border border-dashed border-[var(--line)] hover:border-[var(--acc)] cursor-pointer text-center transition-colors">
              <ImageIcon className="w-7 h-7 text-[var(--acc)]" />
              <span className="font-bold text-sm">Foto{isStory ? '' : ' / Carrossel / Vídeo'}</span>
              <span className="text-xs text-[var(--mut)]">Com filtros e qualidade adaptativa</span>
              <input
                type="file"
                hidden
                multiple={!isStory}
                accept={isStory ? 'image/*' : 'image/*,video/*'}
                onChange={(e) => void loadFiles(e.target.files)}
              />
            </label>

            <button
              type="button"
              onClick={() => setStepType('text')}
              className="flex flex-col items-center justify-center gap-2.5 p-7 rounded-2xl border border-dashed border-[var(--line)] hover:border-[var(--acc)] text-center transition-colors"
            >
              <Sparkles className="w-7 h-7 text-[var(--acc)]" />
              <span className="font-bold text-sm">Texto colorido</span>
              <span className="text-xs text-[var(--mut)]">Cartão com degradê</span>
            </button>

            {!isStory && (
              <button
                type="button"
                onClick={() => setStepType('poll')}
                className="flex flex-col items-center justify-center gap-2.5 p-7 rounded-2xl border border-dashed border-[var(--line)] hover:border-[var(--acc)] text-center transition-colors"
              >
                <BarChart2 className="w-7 h-7 text-[var(--acc)]" />
                <span className="font-bold text-sm">Enquete</span>
                <span className="text-xs text-[var(--mut)]">Votação instantânea no feed</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5">
            {/* Left preview */}
            <div>
              {stepType === 'image' && (
                <canvas
                  ref={canvasRef}
                  className="max-h-[60dvh] w-auto max-w-full mx-auto rounded-2xl shadow-md"
                />
              )}

              {stepType === 'video' && (
                <div className="space-y-3">
                  <video src={videoUrl} controls playsInline className="w-full max-h-[55dvh] rounded-2xl bg-black" />
                  {uploadPlan && (
                    <div className="p-3 rounded-xl bg-[var(--bg)] border border-[var(--line)] space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>
                          Envio retomável ({uploadPlan.uploadedChunks.length}/{uploadPlan.totalChunks} blocos)
                        </span>
                        <span className="font-mono-num">
                          {Math.round((uploadPlan.uploadedChunks.length / uploadPlan.totalChunks) * 100)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--line)] overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${(uploadPlan.uploadedChunks.length / uploadPlan.totalChunks) * 100}%`,
                            background: 'var(--grad)',
                          }}
                        />
                      </div>
                      <div className="flex gap-2">
                        {uploadPlan.status === 'uploading' ? (
                          <button
                            type="button"
                            onClick={() => uploaderRef.current?.pause()}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold"
                          >
                            <Pause className="w-3.5 h-3.5" /> Pausar
                          </button>
                        ) : uploadPlan.status === 'paused' ? (
                          <button
                            type="button"
                            onClick={() => void uploaderRef.current?.startOrResume()}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold"
                          >
                            <Play className="w-3.5 h-3.5" /> Retomar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            uploaderRef.current?.cancel();
                            setUploadPlan(null);
                            setPublishing(false);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-500 text-xs font-semibold"
                        >
                          Cancelar envio
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {stepType === 'text' && (
                <div
                  className="aspect-square rounded-2xl p-6 grid place-items-center"
                  style={{ background: CARD_GRADIENTS[cardBg] }}
                >
                  <textarea
                    value={cardText}
                    onChange={(e) => setCardText(e.target.value)}
                    maxLength={280}
                    placeholder="Escreva algo…"
                    className="w-full h-full bg-transparent text-white text-2xl font-display font-bold text-center outline-none resize-none placeholder:text-white/65"
                  />
                </div>
              )}

              {stepType === 'poll' && (
                <div className="p-4 rounded-2xl bg-[var(--bg)] border border-[var(--line)] space-y-2.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--mut)]">
                    Opções da enquete
                  </div>
                  {pollOpts.map((opt, idx) => (
                    <input
                      key={idx}
                      value={opt}
                      onChange={(e) => {
                        const next = [...pollOpts];
                        next[idx] = e.target.value;
                        setPollOpts(next);
                      }}
                      maxLength={50}
                      placeholder={`Opção ${idx + 1}`}
                      className="w-full px-3 py-2 rounded-xl bg-[var(--card)] border border-[var(--line)] text-sm"
                    />
                  ))}
                  {pollOpts.length < 4 && (
                    <button
                      type="button"
                      onClick={() => setPollOpts([...pollOpts, ''])}
                      className="px-3 py-1.5 rounded-xl border border-[var(--line)] text-xs font-semibold"
                    >
                      + Adicionar opção
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right controls */}
            <div className="space-y-3">
              {stepType === 'video' && !isStory && (
                <button
                  type="button"
                  onClick={() => setIsReel((v) => !v)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold border ${
                    isReel ? 'bg-[var(--acc)] text-white border-[var(--acc)]' : 'border-[var(--line)]'
                  }`}
                >
                  Publicar como Reel (9:16)
                </button>
              )}

              {stepType === 'image' && (
                <>
                  {!isStory && (
                    <div className="space-y-1">
                      <div className="text-xs text-[var(--mut)]">Formato</div>
                      <div className="flex flex-wrap gap-1.5">
                        {ASPECT_FORMATS.map((f, i) => (
                          <button
                            key={f.label}
                            type="button"
                            onClick={() => setFormatIdx(i)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                              formatIdx === i ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                            }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="text-xs text-[var(--mut)]">Filtros</div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {FILTERS.map((f, i) => (
                        <button
                          key={f.name}
                          type="button"
                          onClick={() => setFilterIdx(i)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            filterIdx === i ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                          }`}
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-[var(--mut)]">Texturas</div>
                    <div className="flex flex-wrap gap-1.5">
                      {TEXTURES.map((t, i) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTextureIdx(i)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                            textureIdx === i ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="space-y-0.5">
                      <span className="text-[var(--mut)]">Zoom</span>
                      <input type="range" min={100} max={250} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full" />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[var(--mut)]">Brilho</span>
                      <input type="range" min={70} max={130} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full" />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[var(--mut)]">Contraste</span>
                      <input type="range" min={70} max={130} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full" />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[var(--mut)]">Saturação</span>
                      <input type="range" min={0} max={200} value={saturation} onChange={(e) => setSaturation(Number(e.target.value))} className="w-full" />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[var(--mut)]">Posição X</span>
                      <input type="range" min={0} max={100} value={panX} onChange={(e) => setPanX(Number(e.target.value))} className="w-full" />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[var(--mut)]">Posição Y</span>
                      <input type="range" min={0} max={100} value={panY} onChange={(e) => setPanY(Number(e.target.value))} className="w-full" />
                    </label>
                  </div>

                  {!isStory && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {images.map((im, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setActiveSlide(i)}
                          className={`w-12 h-12 rounded-xl overflow-hidden border-2 shrink-0 ${
                            activeSlide === i ? 'border-[var(--acc)]' : 'border-transparent'
                          }`}
                        >
                          <img src={im.src} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                      {images.length < 10 && (
                        <label className="w-12 h-12 rounded-xl border border-dashed border-[var(--line)] grid place-items-center text-[var(--acc)] cursor-pointer shrink-0 font-bold">
                          +
                          <input type="file" hidden multiple accept="image/*" onChange={(e) => void loadFiles(e.target.files)} />
                        </label>
                      )}
                    </div>
                  )}
                </>
              )}

              {stepType === 'text' && (
                <div className="flex items-center gap-2">
                  {CARD_GRADIENTS.map((bg, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCardBg(i)}
                      aria-label={`Fundo ${i + 1}`}
                      className={`w-8 h-8 rounded-full border-2 ${cardBg === i ? 'border-[var(--ink)] scale-110' : 'border-transparent'}`}
                      style={{ background: bg }}
                    />
                  ))}
                </div>
              )}

              {(stepType === 'image' || stepType === 'video') && (
                <div className="p-3 rounded-2xl bg-[var(--bg)] border border-[var(--line)] space-y-2">
                  <div className="text-xs font-semibold">Qualidade de publicação</div>
                  <div className="flex gap-1.5">
                    {(['baixa', 'media', 'alta'] as const).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQuality(q)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize ${
                          quality === q ? 'bg-[var(--acc)] text-white' : 'bg-[var(--card)] border border-[var(--line)]'
                        }`}
                      >
                        {q === 'media' ? 'Média' : q}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[var(--mut)] cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={keepOriginal}
                      onChange={(e) => setKeepOriginal(e.target.checked)}
                    />
                    <span>Preservar cópia original (se houver espaço)</span>
                  </label>
                  <div className="text-[11px] text-[var(--mut)] font-mono-num">
                    Uso estimado: {formatBytes(estimate.compressedBytes)} envio
                    {keepOriginal ? ` + ${formatBytes(estimate.originalBytes)} original` : ''}
                  </div>
                </div>
              )}

              {isStory ? (
                <div className="flex gap-2">
                  {([24, 48] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setStoryDur(d)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                        storyDur === d ? 'bg-[var(--acc)] text-white' : 'border border-[var(--line)]'
                      }`}
                    >
                      {d} horas
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {stepType !== 'text' && (
                    <textarea
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      rows={2}
                      placeholder={stepType === 'poll' ? 'Pergunta da enquete…' : 'Legenda… (use #hashtags e @menções)'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
                    />
                  )}
                  {(stepType === 'image' || stepType === 'text') && (
                    <input
                      value={musicUrl}
                      onChange={(e) => setMusicUrl(e.target.value)}
                      placeholder="Link direto de música (.mp3) – opcional"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--line)] text-sm"
                    />
                  )}
                </>
              )}

              <button
                type="button"
                disabled={publishing}
                onClick={() => void handlePublish()}
                className="w-full py-3 rounded-xl text-white font-semibold disabled:opacity-60"
                style={{ background: 'var(--grad)' }}
              >
                {publishing ? 'Publicando…' : 'Publicar agora'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

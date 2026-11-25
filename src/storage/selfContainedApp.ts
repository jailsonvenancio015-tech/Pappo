import type { AccountVaultRecord, AppState } from '../types/pappo';

export interface PappoPortableSnapshot {
  v: 2;
  exportedAt: number;
  activeHandle: string | null;
  accounts: Record<string, AccountVaultRecord>;
  states: Record<string, AppState>;
}

const EMBEDDED_SCRIPT_ID = 'pappo-embedded-state';
const OPFS_STATE_FILE = 'pappo-live-state.json';

/**
 * Escapes closing script tags so arbitrary user text inside posts or messages
 * can never break out of an embedded <script type="application/json"> block.
 */
export function safeJsonForHtmlScript(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script/gi, '<\\/script');
}

export function isValidPortableSnapshot(raw: unknown): raw is PappoPortableSnapshot {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.v === 2 &&
    typeof obj.exportedAt === 'number' &&
    typeof obj.accounts === 'object' &&
    obj.accounts !== null &&
    typeof obj.states === 'object' &&
    obj.states !== null
  );
}

/**
 * Extracts embedded live snapshot from a self-contained Pappo HTML file.
 */
export function extractEmbeddedSnapshotFromHtml(html: string): PappoPortableSnapshot | null {
  const re = new RegExp(
    `<script[^>]*id=["']${EMBEDDED_SCRIPT_ID}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    'i'
  );
  const match = html.match(re);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return isValidPortableSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Injects or replaces the embedded state <script> inside a runnable Pappo HTML document
 * so the app code itself carries the latest user data when saved locally.
 */
export function injectSnapshotIntoHtml(html: string, snapshot: PappoPortableSnapshot): string {
  const payload = safeJsonForHtmlScript(snapshot);
  const tag = `<script id="${EMBEDDED_SCRIPT_ID}" type="application/json">${payload}</script>`;
  const existingRe = new RegExp(
    `<script[^>]*id=["']${EMBEDDED_SCRIPT_ID}["'][^>]*>[\\s\\S]*?<\\/script>`,
    'i'
  );

  if (existingRe.test(html)) {
    return html.replace(existingRe, () => tag);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, () => `  ${tag}\n</head>`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (m) => `${m}\n  ${tag}`);
  }
  return `${tag}\n${html}`;
}

export function shouldHydrateEmbeddedSnapshot(
  embedded: PappoPortableSnapshot | null,
  localAccounts: Record<string, AccountVaultRecord>,
  localLastSavedAt: number
): boolean {
  if (!embedded) return false;
  const hasLocalAccounts = Object.keys(localAccounts).length > 0;
  if (!hasLocalAccounts && Object.keys(embedded.accounts).length > 0) {
    return true;
  }
  return embedded.exportedAt > localLastSavedAt && Object.keys(embedded.accounts).length > 0;
}

/* ---------- Browser OPFS Mirror (survives standard cache clears) ---------- */

export async function writeOpfsLiveSnapshot(snapshot: PappoPortableSnapshot): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return false;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_STATE_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(snapshot));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function readOpfsLiveSnapshot(): Promise<PappoPortableSnapshot | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_STATE_FILE, { create: false });
    const file = await handle.getFile();
    const parsed = JSON.parse(await file.text());
    return isValidPortableSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------- Embedded DOM Snapshot Reader ---------- */

export function readEmbeddedSnapshotFromDom(): PappoPortableSnapshot | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(EMBEDDED_SCRIPT_ID);
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent);
    return isValidPortableSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------- Self-Contained Single-File HTML Builder ---------- */

let linkedFileHandle: FileSystemFileHandle | null = null;
let cachedStandaloneShell: { css: string; js: string } | null = null;

export function getLinkedLocalFileName(): string | null {
  return linkedFileHandle?.name ?? null;
}

export function clearLinkedLocalFile(): void {
  linkedFileHandle = null;
}

export function supportsFileSystemAutoSave(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).showSaveFilePicker === 'function';
}

async function resolveStandaloneAssets(): Promise<{ css: string; js: string }> {
  if (cachedStandaloneShell) return cachedStandaloneShell;

  // 1. If already running inside a self-contained Pappo HTML file (even on file:// offline!)
  const inlineCssEl = document.getElementById('pappo-app-styles');
  const inlineJsEl = document.getElementById('pappo-app-bundle');
  if (inlineCssEl?.textContent && inlineJsEl?.textContent) {
    cachedStandaloneShell = {
      css: inlineCssEl.textContent,
      js: inlineJsEl.textContent,
    };
    return cachedStandaloneShell;
  }

  // 2. If running from a static production build (dist/), inline same-origin <link> & <script>
  const styleTexts: string[] = [];
  for (const el of Array.from(document.querySelectorAll('style'))) {
    if (el.textContent) styleTexts.push(el.textContent);
  }
  const linkEls = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  for (const link of linkEls) {
    if (link.href && link.href.startsWith(window.location.origin)) {
      try {
        const res = await fetch(link.href);
        if (res.ok) styleTexts.push(await res.text());
      } catch {
        // ignore external/unreachable css
      }
    }
  }

  const scriptEls = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  const isViteDev = scriptEls.some((s) => s.getAttribute('src')?.includes('/src/main.tsx'));

  if (!isViteDev && scriptEls.length > 0) {
    const jsParts: string[] = [];
    for (const s of scriptEls) {
      if (s.src && s.src.startsWith(window.location.origin)) {
        try {
          const res = await fetch(s.src);
          if (res.ok) jsParts.push(await res.text());
        } catch {
          // fallback below
        }
      }
    }
    if (jsParts.length > 0) {
      cachedStandaloneShell = {
        css: styleTexts.join('\n'),
        js: jsParts.join('\n'),
      };
      return cachedStandaloneShell;
    }
  }

  // 3. If running in local Vite dev mode, ask optional local dev bundler endpoint once
  if (window.location.protocol.startsWith('http')) {
    try {
      const resp = await fetch('/api/standalone-shell');
      if (resp.ok) {
        const bundle = (await resp.json()) as { css?: string; js?: string };
        if (bundle.js) {
          cachedStandaloneShell = {
            css: bundle.css || styleTexts.join('\n'),
            js: bundle.js,
          };
          return cachedStandaloneShell;
        }
      }
    } catch {
      // pure browser fallback below
    }
  }

  cachedStandaloneShell = {
    css: styleTexts.join('\n'),
    js: '',
  };
  return cachedStandaloneShell;
}

export async function buildStandaloneAppHtml(snapshot: PappoPortableSnapshot): Promise<string> {
  const { css, js } = await resolveStandaloneAssets();
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const title = document.title || 'Pappo — Rede Social & Mensagens';

  const baseDoc = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title.replace(/</g, '&lt;')}</title>
    <style id="pappo-app-styles">${safeCss}</style>
  </head>
  <body>
    <div id="root"></div>
    <script id="${EMBEDDED_SCRIPT_ID}" type="application/json">${safeJsonForHtmlScript(snapshot)}</script>
    <script type="module" id="pappo-app-bundle">${safeJs}</script>
  </body>
</html>`;

  return baseDoc;
}

export async function linkAndSaveLocalAppFile(snapshot: PappoPortableSnapshot): Promise<string | null> {
  if (!supportsFileSystemAutoSave()) return null;
  const picker = (window as unknown as {
    showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;

  const handle = await picker({
    suggestedName: 'pappo-app-local.html',
    types: [
      {
        description: 'Aplicativo Pappo Auto-Contido (.html)',
        accept: { 'text/html': ['.html'] },
      },
    ],
  });
  linkedFileHandle = handle;
  await writeLinkedLocalAppFile(snapshot);
  return handle.name;
}

export async function writeLinkedLocalAppFile(snapshot: PappoPortableSnapshot): Promise<boolean> {
  if (!linkedFileHandle) return false;
  try {
    const html = await buildStandaloneAppHtml(snapshot);
    const writable = await linkedFileHandle.createWritable();
    await writable.write(html);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

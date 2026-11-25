import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmbeddedSnapshotFromHtml,
  injectSnapshotIntoHtml,
  safeJsonForHtmlScript,
  shouldHydrateEmbeddedSnapshot,
  type PappoPortableSnapshot,
} from './selfContainedApp';
import { createInitialAppState } from '../data/seed';

function makeSnapshot(exportedAt: number, caption = 'Post local'): PappoPortableSnapshot {
  const state = createInitialAppState(
    { id: 'me', n: 'Ana', h: 'ana', c: ['#8b5cf6', '#ec4899'], since: 1000 },
    false
  );
  state.posts = [
    {
      id: 'p_local_1',
      u: 'me',
      type: 'text',
      cap: caption,
      t: exportedAt,
      likes: [],
      saved: [],
      cm: [],
      rp: [],
    },
  ];
  return {
    v: 2,
    exportedAt,
    activeHandle: 'ana',
    accounts: {
      ana: {
        h: 'ana',
        n: 'Ana',
        salt: 'abc',
        passHash: 'hashed',
        recoveryKeyHash: 'rhash',
        recoveryCodesHashes: [],
        createdAt: 1000,
      },
    },
    states: { ana: state },
  };
}

test('injectSnapshotIntoHtml embeds and replaces state safely even with </script> in post text', () => {
  const snap1 = makeSnapshot(1000, 'Teste </script><script>alert(1)</script>');
  const baseHtml = '<!doctype html><html><head><title>Pappo</title></head><body><div id="root"></div></body></html>';

  const withState1 = injectSnapshotIntoHtml(baseHtml, snap1);
  assert.equal(withState1.includes('</script><script>alert(1)'), false);
  assert.equal(safeJsonForHtmlScript({ txt: '</script>' }).includes('<\\/script>'), true);

  const extracted1 = extractEmbeddedSnapshotFromHtml(withState1);
  assert.ok(extracted1);
  assert.equal(extracted1.activeHandle, 'ana');
  assert.equal(extracted1.states.ana.posts[0].cap, 'Teste </script><script>alert(1)</script>');

  const snap2 = makeSnapshot(2000, 'Atualizado em tempo real');
  const withState2 = injectSnapshotIntoHtml(withState1, snap2);
  const scriptMatches = withState2.match(/id="pappo-embedded-state"/g) || [];
  assert.equal(scriptMatches.length, 1);

  const extracted2 = extractEmbeddedSnapshotFromHtml(withState2);
  assert.equal(extracted2?.exportedAt, 2000);
  assert.equal(extracted2?.states.ana.posts[0].cap, 'Atualizado em tempo real');
});

test('shouldHydrateEmbeddedSnapshot respects empty local vault vs newer local edits', () => {
  const embedded = makeSnapshot(5000);
  assert.equal(shouldHydrateEmbeddedSnapshot(embedded, {}, 0), true);
  assert.equal(shouldHydrateEmbeddedSnapshot(embedded, embedded.accounts, 6000), false);
  assert.equal(shouldHydrateEmbeddedSnapshot(embedded, embedded.accounts, 4000), true);
});

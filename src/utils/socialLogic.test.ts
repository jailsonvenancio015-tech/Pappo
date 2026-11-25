import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSendDirectMessage,
  canViewProfileContent,
  createUploadPlan,
  estimateMediaBytes,
  filterVisiblePosts,
  markChunkUploaded,
  mergeMessagesIdempotent,
  nextMissingChunkIndex,
  validateHandle,
} from './socialLogic';
import type { ChatMessage, Post, UserProfile } from '../types/pappo';

test('validateHandle enforces unique @ rules', () => {
  assert.equal(validateHandle('@Clara_01').valid, true);
  assert.equal(validateHandle('@Clara_01').normalized, 'clara_01');
  assert.equal(validateHandle('ab').valid, false);
  assert.equal(validateHandle('invalid space!').valid, false);
});

test('privacy gates block private accounts for non-approved viewers and search', () => {
  const lucas: UserProfile = { id: 'u2', n: 'Lucas', h: 'lucas', c: ['#000', '#111'], priv: true };
  const clara: UserProfile = { id: 'u1', n: 'Clara', h: 'clara', c: ['#000', '#111'], priv: false };

  assert.equal(canViewProfileContent({ viewerId: 'me', target: lucas, followStatus: undefined }), false);
  assert.equal(canViewProfileContent({ viewerId: 'me', target: lucas, followStatus: 'pend' }), false);
  assert.equal(canViewProfileContent({ viewerId: 'me', target: lucas, followStatus: 'ok' }), true);
  assert.equal(canViewProfileContent({ viewerId: 'me', target: clara, blockedIds: ['u1'] }), false);

  const posts: Post[] = [
    { id: 'p1', u: 'u2', type: 'text', cap: 'Segredo #arte', t: 10, likes: [], saved: [], cm: [], rp: [] },
    { id: 'p2', u: 'u1', type: 'text', cap: 'Público #arte', t: 11, likes: [], saved: [], cm: [], rp: [] },
  ];
  const visible = filterVisiblePosts({
    posts,
    viewerId: 'me',
    usersMap: { u1: clara, u2: lucas },
    fol: {},
    blockedIds: [],
    query: '#arte',
  });
  assert.deepEqual(visible.map((p) => p.id), ['p2']);
});

test('direct message permissions respect blocked and followers-only rules', () => {
  const target: UserProfile = { id: 'u2', n: 'Lucas', h: 'lucas', c: ['#000', '#111'] };
  assert.equal(canSendDirectMessage({ senderId: 'me', target, permission: 'ninguem' }).allowed, false);
  assert.equal(
    canSendDirectMessage({ senderId: 'me', target, permission: 'seguindo', senderFollowsTarget: false }).allowed,
    false
  );
  assert.equal(
    canSendDirectMessage({ senderId: 'me', target, permission: 'seguindo', senderFollowsTarget: true }).allowed,
    true
  );
});

test('mergeMessagesIdempotent deduplicates pending offline messages when server confirms', () => {
  const local: ChatMessage[] = [
    { id: 'tmp-1', clientMsgId: 'c-100', m: 'me', k: 't', tx: 'Oi!', t: 1000, pending: true },
  ];
  const incoming: ChatMessage[] = [
    { id: 'srv-55', clientMsgId: 'c-100', m: 'me', k: 't', tx: 'Oi!', t: 1000, pending: false, read: true },
    { id: 'srv-56', clientMsgId: 'c-101', m: 'u1', k: 't', tx: 'Tudo bem?', t: 1050 },
  ];
  const merged = mergeMessagesIdempotent(local, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'srv-55');
  assert.equal(merged[0].pending, false);
  assert.equal(merged[1].tx, 'Tudo bem?');
});

test('resumable chunked upload resumes from interrupted chunks and estimates data accurately', () => {
  let plan = createUploadPlan({
    uploadId: 'up-1',
    fileName: 'video.mp4',
    totalBytes: 200_000,
    chunkSize: 64_000,
    quality: 'media',
  });
  assert.equal(plan.totalChunks, 4);
  assert.equal(nextMissingChunkIndex(plan), 0);

  plan = markChunkUploaded(plan, 0);
  plan = markChunkUploaded(plan, 2); // out-of-order / resumed
  assert.equal(nextMissingChunkIndex(plan), 1);

  plan = markChunkUploaded(plan, 1);
  plan = markChunkUploaded(plan, 3);
  assert.equal(nextMissingChunkIndex(plan), null);
  assert.equal(plan.status, 'completed');

  const estWithoutOrig = estimateMediaBytes(1_000_000, 'baixa', false);
  const estWithOrig = estimateMediaBytes(1_000_000, 'baixa', true);
  assert.equal(estWithoutOrig.originalBytes, 0);
  assert.equal(estWithOrig.originalBytes, 1_000_000);
  assert.ok(estWithOrig.totalBytes > estWithoutOrig.totalBytes);
});

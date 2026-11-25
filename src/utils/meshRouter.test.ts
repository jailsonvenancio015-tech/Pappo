import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDeviceSharingEligibility,
  planCacheEviction,
  scoreNode,
  selectBestNode,
} from './meshRouter';
import type { CachedAssetEntry, DeviceSharingPolicy, PeerNodeMetrics } from '../types/pappo';

const basePolicy: DeviceSharingPolicy = {
  allowSharing: true,
  wifiOnly: true,
  minBatteryPct: 20,
  pauseOnThermal: true,
  pauseOnSaveData: true,
  maxBandwidthMbps: 25,
  onlyAuthorizedFiles: true,
};

test('device sharing refuses when on cellular with wifiOnly, low battery, or logged out', () => {
  assert.equal(
    evaluateDeviceSharingEligibility(basePolicy, {
      batteryPct: 80,
      charging: false,
      onCellular: true,
      saveData: false,
      thermalThrottled: false,
      freeStorageMb: 500,
      online: true,
      loggedIn: true,
    }).eligible,
    false
  );

  assert.equal(
    evaluateDeviceSharingEligibility(basePolicy, {
      batteryPct: 12,
      charging: false,
      onCellular: false,
      saveData: false,
      thermalThrottled: false,
      freeStorageMb: 500,
      online: true,
      loggedIn: true,
    }).eligible,
    false
  );

  // Charging bypasses low battery restriction
  assert.equal(
    evaluateDeviceSharingEligibility(basePolicy, {
      batteryPct: 12,
      charging: true,
      onCellular: false,
      saveData: false,
      thermalThrottled: false,
      freeStorageMb: 500,
      online: true,
      loggedIn: true,
    }).eligible,
    true
  );

  // Logged out stops sharing immediately
  assert.equal(
    evaluateDeviceSharingEligibility(basePolicy, {
      batteryPct: 90,
      charging: true,
      onCellular: false,
      saveData: false,
      thermalThrottled: false,
      freeStorageMb: 500,
      online: true,
      loggedIn: false,
    }).eligible,
    false
  );
});

test('selectBestNode automatically chooses fastest healthy node and ranks failover chain', () => {
  const nodes: PeerNodeMetrics[] = [
    {
      nodeId: 'relay-1',
      kind: 'ws-relay',
      label: 'Retransmissor de Apoio',
      rttMs: 85,
      bandwidthMbps: 30,
      batteryPct: 100,
      charging: true,
      onCellular: false,
      saveData: false,
      thermalThrottled: false,
      availableSpaceMb: 4000,
      failureCount: 0,
      authorized: true,
      online: true,
      lastSeen: Date.now(),
    },
    {
      nodeId: 'peer-slow',
      kind: 'webrtc-peer',
      label: 'Dispositivo Lucas',
      rttMs: 240,
      bandwidthMbps: 5,
      batteryPct: 40,
      charging: false,
      onCellular: true,
      saveData: false,
      thermalThrottled: false,
      availableSpaceMb: 300,
      failureCount: 0,
      authorized: true,
      online: true,
      lastSeen: Date.now(),
      hasAssetIds: ['asset-1'],
    },
    {
      nodeId: 'peer-fast',
      kind: 'webrtc-peer',
      label: 'Dispositivo Clara',
      rttMs: 18,
      bandwidthMbps: 45,
      batteryPct: 88,
      charging: true,
      onCellular: false,
      saveData: false,
      thermalThrottled: false,
      availableSpaceMb: 800,
      failureCount: 0,
      authorized: true,
      online: true,
      lastSeen: Date.now(),
      hasAssetIds: ['asset-1'],
    },
    {
      nodeId: 'peer-broken',
      kind: 'webrtc-peer',
      label: 'Dispositivo Instável',
      rttMs: 12,
      bandwidthMbps: 50,
      batteryPct: 90,
      charging: true,
      onCellular: false,
      saveData: false,
      thermalThrottled: false,
      availableSpaceMb: 800,
      failureCount: 3,
      authorized: true,
      online: true,
      lastSeen: Date.now(),
      hasAssetIds: ['asset-1'],
    },
  ];

  const decision = selectBestNode(nodes, 'asset-1');
  assert.equal(decision.selected?.nodeId, 'peer-fast');
  assert.deepEqual(decision.failoverChain, ['peer-fast', 'peer-slow', 'relay-1']);
  assert.equal(scoreNode(nodes[3], 'asset-1').eligible, false);
});

test('planCacheEviction removes expired and least-recently-used items while preserving hot cache', () => {
  const now = 1_000_000;
  const mb = 1024 * 1024;
  const entries: CachedAssetEntry[] = [
    { assetId: 'expired', quality: 'media', bytes: 2 * mb, mime: 'image/jpeg', lastAccessed: now - 100, expiresAt: now - 1 },
    { assetId: 'cold', quality: 'alta', bytes: 6 * mb, mime: 'video/mp4', lastAccessed: now - 5000, expiresAt: now + 90_000 },
    { assetId: 'warm', quality: 'media', bytes: 5 * mb, mime: 'image/jpeg', lastAccessed: now - 2000, expiresAt: now + 90_000 },
    { assetId: 'hot', quality: 'alta', bytes: 5 * mb, mime: 'image/jpeg', lastAccessed: now - 100, expiresAt: now + 90_000 },
  ];

  const plan = planCacheEviction(entries, 10, now);
  assert.deepEqual(plan.keep.map((k) => k.assetId), ['hot', 'warm']);
  assert.ok(plan.evictIds.includes('expired'));
  assert.ok(plan.evictIds.includes('cold'));
  assert.equal(plan.totalBytesAfter, 10 * mb);
});

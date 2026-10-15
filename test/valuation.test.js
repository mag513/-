'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/valuation.js');
const T = require('../js/tables.js');

test('奥行価格補正率表は全地区とも区分数と一致する', () => {
  for (const d of T.DISTRICTS) {
    assert.equal(T.DEPTH_RATES[d.id].length, T.DEPTH_BOUNDS.length + 1, d.name);
    assert.equal(T.FRONTAGE_RATES[d.id].length, T.FRONTAGE_BOUNDS.length + 1, d.name);
    assert.equal(T.LONG_DEPTH_RATES[d.id].length, T.LONG_DEPTH_BOUNDS.length + 1, d.name);
  }
});

test('奥行価格補正率の境界（○以上△未満）', () => {
  assert.equal(V.depthRate('residential', 9.99), 0.97);
  assert.equal(V.depthRate('residential', 10), 1.00);
  assert.equal(V.depthRate('residential', 24), 0.97);
  assert.equal(V.depthRate('residential', 120), 0.80);
  assert.equal(V.depthRate('building', 3), 0.80);
});

test('一路線・奥行長大', () => {
  const r = V.evaluate({
    method: 'rosenka', district: 'residential', area: 450,
    front: { price: 300000, frontage: 15, depth: 30 }
  });
  // 300,000 × 0.95 = 285,000 → × 奥行長大0.98（30/15=2.0）= 279,300
  assert.equal(r.perSqm, 279300);
  assert.equal(r.selfUse, 279300 * 450);
});

test('角地（側方路線影響加算）', () => {
  const r = V.evaluate({
    method: 'rosenka', district: 'residential', area: 400,
    front: { price: 300000, frontage: 20, depth: 20 },
    sides: [{ price: 200000, depth: 20, type: 'corner' }]
  });
  assert.equal(r.perSqm, 306000);
  assert.equal(r.selfUse, 122400000);
});

test('二方路線影響加算（普通商業）', () => {
  const r = V.evaluate({
    method: 'rosenka', district: 'commercial', area: 500,
    front: { price: 500000, frontage: 20, depth: 25 },
    rear: { price: 400000 }
  });
  // 500,000 + 400,000 × 1.00 × 0.05 = 520,000
  assert.equal(r.perSqm, 520000);
});

test('不整形地補正', () => {
  const r = V.evaluate({
    method: 'rosenka', district: 'residential', area: 300,
    front: { price: 200000, frontage: 10, depth: 0 },
    irregular: { enabled: true, assumedFrontage: 15, assumedDepth: 25 }
  });
  // かげ地 20% / 地積区分A → 0.94、計算上の奥行 25m → 0.97
  // 200,000 × 0.97 = 194,000 → min(0.94×1.00, 0.98×1.00) = 0.94 → 182,360
  assert.equal(r.perSqm, 182360);
  assert.equal(r.selfUse, 182360 * 300);
});

test('不整形地補正率の下限0.60', () => {
  const r = V.evaluate({
    method: 'rosenka', district: 'smallFactory', area: 100,
    front: { price: 100000, frontage: 3, depth: 0 },
    irregular: { enabled: true, assumedFrontage: 20, assumedDepth: 20 }
  });
  // かげ地75% → 0.70、間口狭小0.80 → 0.56 → 下限0.60
  const step = r.steps.find((s) => s.no === '5-2');
  assert.match(step.formula, /= 0\.60 →/);
});

test('規模格差補正率', () => {
  assert.equal(V.scaleRate(1000, true).rate, 0.78);
  assert.equal(V.scaleRate(750, true).rate, 0.78); // (750×0.95+25)/750×0.8 = 0.7866 → 0.78
  assert.equal(V.scaleRate(1500, false).rate, 0.77); // (1500×0.9+100)/1500×0.8 = 0.7733
  assert.equal(V.scaleRate(400, true), null);
});

test('地積規模の大きな宅地は対象地区外では適用しない', () => {
  const r = V.evaluate({
    method: 'rosenka', district: 'highCommercial', area: 1200,
    front: { price: 100000, frontage: 30, depth: 40 },
    largeScale: { enabled: true, metro: true }
  });
  assert.equal(r.perSqm, 100000);
  assert.equal(r.warnings.length, 1);
});

test('倍率方式・貸家建付地・小規模宅地等の特例', () => {
  const r = V.evaluate({
    method: 'bairitsu', area: 400,
    bairitsu: { fixedAssetValue: 50000000, multiplier: 2.0 },
    rights: { type: 'rentalBuildingLand', leaseholdRatio: 0.6, occupancy: 1 },
    smallSite: { type: 'rental' }
  });
  assert.equal(r.selfUse, 100000000);
  assert.equal(r.rightsValue, 82000000);
  // 82,000,000 × 200/400 × 50% = 20,500,000
  assert.equal(r.taxable, 61500000);
});

test('セットバック', () => {
  const r = V.evaluate({
    method: 'bairitsu', area: 100,
    bairitsu: { fixedAssetValue: 10000000, multiplier: 1 },
    setback: { area: 10 }
  });
  assert.equal(r.selfUse, 10000000 - 700000);
});

test('入力エラー', () => {
  assert.throws(() => V.evaluate({ method: 'rosenka', district: 'residential', area: 0 }), /地積/);
});

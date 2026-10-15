/*
 * 土地評価計算エンジン（財産評価基本通達・路線価方式／倍率方式）
 * 計算手順は「土地及び土地の上に存する権利の評価明細書」に準拠する。
 */
(function (root) {
  'use strict';

  var T = (typeof module !== 'undefined' && module.exports) ? require('./tables.js') : root.LandTables;

  var EPS = 1e-9;

  // 区分境界の配列から該当する行番号を返す（「○以上△未満」）
  function bracket(bounds, value) {
    var i = 0;
    while (i < bounds.length && value + EPS >= bounds[i]) i++;
    return i;
  }

  // 円未満切捨て
  function floorYen(x) {
    return Math.floor(x + 1e-6);
  }

  // 小数点以下2位未満切捨て
  function floor2(x) {
    return Math.floor(x * 100 + 1e-6) / 100;
  }

  function districtName(id) {
    for (var i = 0; i < T.DISTRICTS.length; i++) {
      if (T.DISTRICTS[i].id === id) return T.DISTRICTS[i].name;
    }
    throw new Error('不明な地区区分: ' + id);
  }

  function depthRate(district, depth) {
    return T.DEPTH_RATES[district][bracket(T.DEPTH_BOUNDS, depth)];
  }

  function frontageRate(district, frontage) {
    return T.FRONTAGE_RATES[district][bracket(T.FRONTAGE_BOUNDS, frontage)];
  }

  function longDepthRate(district, depth, frontage) {
    return T.LONG_DEPTH_RATES[district][bracket(T.LONG_DEPTH_BOUNDS, depth / frontage)];
  }

  // 不整形地補正率表の値（地積区分・かげ地割合から）
  function irregularTableRate(district, area, shadowPct) {
    var cls = T.IRREGULAR_AREA_CLASS[district];
    if (!cls) return null;
    var areaClass = area < cls[0] ? 'A' : (area < cls[1] ? 'B' : 'C');
    var idx = bracket(T.SHADOW_BOUNDS, shadowPct);
    var table = district === 'residential' ? T.IRREGULAR_RATES.residential : T.IRREGULAR_RATES.general;
    return { areaClass: areaClass, rate: idx === 0 ? 1.0 : table[areaClass][idx - 1] };
  }

  // 規模格差補正率 = (A×B + C) / A × 0.8（小数点以下2位未満切捨て）
  function scaleRate(area, metro) {
    var rows = metro ? T.LARGE_SCALE.metro : T.LARGE_SCALE.other;
    for (var i = 0; i < rows.length; i++) {
      if (area + EPS >= rows[i].min && area < rows[i].max) {
        return { rate: floor2((area * rows[i].b + rows[i].c) / area * 0.8), b: rows[i].b, c: rows[i].c };
      }
    }
    return null;
  }

  function cliffRate(direction, cliffPct) {
    var idx = bracket(T.CLIFF_BOUNDS, cliffPct);
    return idx === 0 ? 1.0 : T.CLIFF_RATES[direction][idx - 1];
  }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function fmtRate(r) {
    return r.toFixed(2);
  }

  function fmtYen(n) {
    return Math.round(n).toLocaleString('ja-JP');
  }

  function requirePositive(value, label) {
    if (!(value > 0)) throw new Error(label + 'を正の数で入力してください。');
  }

  // 路線価方式による1㎡当たりの価額
  function evaluateRosenka(input, steps, warnings) {
    var district = input.district;
    var area = num(input.area);
    var front = input.front || {};
    var price = num(front.price);
    var frontage = num(front.frontage);
    var depth = num(front.depth);
    var irregular = input.irregular && input.irregular.enabled ? input.irregular : null;

    requirePositive(price, '正面路線価');
    requirePositive(frontage, '間口距離');

    var shadowPct = 0;
    if (irregular) {
      var af = num(irregular.assumedFrontage);
      var ad = num(irregular.assumedDepth);
      requirePositive(af, '想定整形地の間口距離');
      requirePositive(ad, '想定整形地の奥行距離');
      var assumedArea = af * ad;
      if (assumedArea + EPS < area) {
        warnings.push('想定整形地の地積（' + assumedArea.toFixed(2) + '㎡）が対象地の地積より小さくなっています。');
      }
      shadowPct = Math.max(0, (assumedArea - area) / assumedArea * 100);
      // 計算上の奥行距離 = min(想定整形地の奥行, 地積 ÷ 間口)
      var calcDepth = Math.min(ad, area / frontage);
      depth = Math.floor(calcDepth * 100 + 1e-6) / 100;
      steps.push({
        no: '—',
        label: '不整形地の前提',
        formula: '想定整形地 ' + af + 'm × ' + ad + 'm = ' + assumedArea.toFixed(2) + '㎡、かげ地割合 ' +
          shadowPct.toFixed(2) + '%、計算上の奥行 min(' + ad + ', ' + area + '÷' + frontage + ') = ' + depth + 'm',
        value: null
      });
    }
    requirePositive(depth, '奥行距離');

    // 1. 一路線に面する宅地
    var dRate = depthRate(district, depth);
    var value = floorYen(price * dRate);
    var frontCorrected = price * dRate;
    steps.push({
      no: '1',
      label: '一路線に面する宅地',
      formula: '正面路線価 ' + fmtYen(price) + '円 × 奥行価格補正率 ' + fmtRate(dRate) + '（奥行 ' + depth + 'm）',
      value: value
    });

    // 2〜3. 側方路線影響加算（三方・四方路線を含む）
    var roadNo = 1;
    var sides = input.sides || [];
    for (var i = 0; i < sides.length; i++) {
      var s = sides[i];
      var sPrice = num(s.price);
      if (!(sPrice > 0)) continue;
      var sDepth = num(s.depth) || frontage;
      var sRate = depthRate(district, sDepth);
      var kind = s.type === 'semiCorner' ? 'semiCorner' : 'corner';
      var add = T.SIDE_RATES[district][kind];
      var ratio = s.ratio === undefined || s.ratio === '' ? 1 : num(s.ratio);
      if (sPrice * sRate > frontCorrected + EPS) {
        warnings.push('側方路線' + (i + 1) + 'の路線価×奥行価格補正率が正面路線を上回っています。正面路線の判定を確認してください。');
      }
      value = floorYen(value + sPrice * sRate * add * ratio);
      steps.push({
        no: String(++roadNo),
        label: '側方路線影響加算（' + (kind === 'corner' ? '角地' : '準角地') + '）',
        formula: '前行 + 側方路線価 ' + fmtYen(sPrice) + '円 × 奥行価格補正率 ' + fmtRate(sRate) +
          '（' + sDepth + 'm）× 加算率 ' + add + (ratio !== 1 ? ' × 按分 ' + ratio : ''),
        value: value
      });
    }

    // 4. 二方路線影響加算
    var rear = input.rear;
    if (rear && num(rear.price) > 0) {
      var rPrice = num(rear.price);
      var rDepth = num(rear.depth) || depth;
      var rRate = depthRate(district, rDepth);
      var rAdd = T.REAR_RATES[district];
      var rRatio = rear.ratio === undefined || rear.ratio === '' ? 1 : num(rear.ratio);
      if (rPrice * rRate > frontCorrected + EPS) {
        warnings.push('裏面路線の路線価×奥行価格補正率が正面路線を上回っています。正面路線の判定を確認してください。');
      }
      value = floorYen(value + rPrice * rRate * rAdd * rRatio);
      steps.push({
        no: String(++roadNo),
        label: '二方路線影響加算',
        formula: '前行 + 裏面路線価 ' + fmtYen(rPrice) + '円 × 奥行価格補正率 ' + fmtRate(rRate) +
          '（' + rDepth + 'm）× 加算率 ' + rAdd + (rRatio !== 1 ? ' × 按分 ' + rRatio : ''),
        value: value
      });
    }

    // 5. 間口狭小・奥行長大／不整形地
    var fRate = frontageRate(district, frontage);
    if (fRate === null) {
      var col = T.FRONTAGE_RATES[district];
      for (var k = 0; k < col.length && col[k] === null; k++);
      fRate = col[k];
      warnings.push(districtName(district) + 'の間口狭小補正率表は間口' + frontage + 'mに対応する数値がないため、最小の ' + fmtRate(fRate) + ' を用いました。');
    }
    var lRate = longDepthRate(district, depth, frontage);
    var irr = irregular ? irregularTableRate(district, area, shadowPct) : null;

    if (irregular && !irr) {
      warnings.push(districtName(district) + 'には不整形地補正率表の適用がないため、間口狭小・奥行長大補正のみ行いました。');
    }

    if (irr) {
      var r1 = floor2(irr.rate * fRate);
      var r2 = floor2(lRate * fRate);
      var rate = Math.max(0.6, Math.min(r1, r2));
      value = floorYen(value * rate);
      steps.push({
        no: '5-2',
        label: '不整形地',
        formula: '地積区分 ' + irr.areaClass + '、不整形地補正率表 ' + fmtRate(irr.rate) + '\n' +
          '① 不整形地補正率 ' + fmtRate(irr.rate) + ' × 間口狭小 ' + fmtRate(fRate) + ' = ' + fmtRate(r1) + '\n' +
          '② 奥行長大 ' + fmtRate(lRate) + ' × 間口狭小 ' + fmtRate(fRate) + ' = ' + fmtRate(r2) + '\n' +
          '①②の低い方（下限0.60）= ' + fmtRate(rate) + ' → 前行 × ' + fmtRate(rate),
        value: value
      });
    } else if (fRate < 1 || lRate < 1) {
      value = floorYen(value * fRate * lRate);
      steps.push({
        no: '5-1',
        label: '間口が狭小・奥行が長大な宅地',
        formula: '前行 × 間口狭小補正率 ' + fmtRate(fRate) + ' × 奥行長大補正率 ' + fmtRate(lRate) +
          '（奥行/間口 = ' + (depth / frontage).toFixed(2) + '）',
        value: value
      });
    }

    // 6. 地積規模の大きな宅地
    if (input.largeScale && input.largeScale.enabled) {
      var metro = !!input.largeScale.metro;
      var okDistrict = district === 'commercial' || district === 'residential';
      var sr = scaleRate(area, metro);
      if (!okDistrict) {
        warnings.push('地積規模の大きな宅地の評価は普通商業・併用住宅地区及び普通住宅地区のみ適用できます（適用しませんでした）。');
      } else if (!sr) {
        warnings.push('地積が' + (metro ? '500' : '1,000') + '㎡未満のため、地積規模の大きな宅地の評価は適用しませんでした。');
      } else {
        value = floorYen(value * sr.rate);
        steps.push({
          no: '6',
          label: '地積規模の大きな宅地',
          formula: '規模格差補正率 = (' + area + '㎡ × ' + sr.b + ' + ' + sr.c + ') ÷ ' + area + '㎡ × 0.8 = ' +
            fmtRate(sr.rate) + '（' + (metro ? '三大都市圏' : '三大都市圏以外') + '）→ 前行 × ' + fmtRate(sr.rate),
          value: value
        });
      }
    }

    // 8. がけ地等を有する宅地
    if (input.cliff && input.cliff.enabled) {
      var cArea = num(input.cliff.area);
      var cPct = cArea / area * 100;
      var cRate = cliffRate(input.cliff.direction || 'south', cPct);
      if (cRate < 1) {
        value = floorYen(value * cRate);
        steps.push({
          no: '8',
          label: 'がけ地等を有する宅地',
          formula: 'がけ地割合 ' + cPct.toFixed(2) + '%（' + dirName(input.cliff.direction) + '向き）→ 前行 × がけ地補正率 ' + fmtRate(cRate),
          value: value
        });
      } else {
        warnings.push('がけ地割合が10%未満のため、がけ地補正は適用しませんでした。');
      }
    }

    return value;
  }

  function dirName(id) {
    for (var i = 0; i < T.CLIFF_DIRECTIONS.length; i++) {
      if (T.CLIFF_DIRECTIONS[i].id === id) return T.CLIFF_DIRECTIONS[i].name;
    }
    return '南';
  }

  // 土地の上に存する権利等の評価
  function evaluateRights(selfUse, rights, steps) {
    var type = (rights && rights.type) || 'self';
    var lr = num(rights && rights.leaseholdRatio);
    var tr = rights && rights.tenancyRatio !== undefined && rights.tenancyRatio !== '' ? num(rights.tenancyRatio) : 0.3;
    var occ = rights && rights.occupancy !== undefined && rights.occupancy !== '' ? num(rights.occupancy) : 1;
    var value;
    var label;
    var formula;
    switch (type) {
      case 'self':
        return selfUse;
      case 'leasedLand':
        label = '貸宅地';
        value = floorYen(selfUse * (1 - lr));
        formula = '自用地評価額 × (1 − 借地権割合 ' + lr + ')';
        break;
      case 'rentalBuildingLand':
        label = '貸家建付地';
        value = floorYen(selfUse * (1 - lr * tr * occ));
        formula = '自用地評価額 × (1 − 借地権割合 ' + lr + ' × 借家権割合 ' + tr + ' × 賃貸割合 ' + occ + ')';
        break;
      case 'leasehold':
        label = '借地権';
        value = floorYen(selfUse * lr);
        formula = '自用地評価額 × 借地権割合 ' + lr;
        break;
      case 'rentalLeasehold':
        label = '貸家建付借地権';
        value = floorYen(selfUse * lr * (1 - tr * occ));
        formula = '自用地評価額 × 借地権割合 ' + lr + ' × (1 − 借家権割合 ' + tr + ' × 賃貸割合 ' + occ + ')';
        break;
      default:
        throw new Error('不明な権利の種類: ' + type);
    }
    if (type !== 'self' && !(lr > 0 && lr < 1)) {
      throw new Error('借地権割合を選択してください。');
    }
    steps.push({ no: '権利', label: label, formula: formula, value: value, total: true });
    return value;
  }

  /**
   * 土地評価を行う。
   * @returns {{perSqm:number|null, selfUse:number, rightsValue:number, taxable:number, steps:Array, warnings:Array}}
   */
  function evaluate(input) {
    var steps = [];
    var warnings = [];
    var area = num(input.area);
    requirePositive(area, '地積');

    var perSqm = null;
    var selfUse;

    if (input.method === 'bairitsu') {
      var fav = num(input.bairitsu && input.bairitsu.fixedAssetValue);
      var mul = num(input.bairitsu && input.bairitsu.multiplier);
      requirePositive(fav, '固定資産税評価額');
      requirePositive(mul, '評価倍率');
      selfUse = floorYen(fav * mul);
      steps.push({
        no: '倍率',
        label: '倍率方式',
        formula: '固定資産税評価額 ' + fmtYen(fav) + '円 × 倍率 ' + mul,
        value: selfUse,
        total: true
      });
    } else {
      if (!T.DEPTH_RATES[input.district]) throw new Error('地区区分を選択してください。');
      perSqm = evaluateRosenka(input, steps, warnings);
      selfUse = floorYen(perSqm * area);
      steps.push({
        no: '自用地',
        label: '自用地の評価額',
        formula: '1㎡当たりの価額 ' + fmtYen(perSqm) + '円 × 地積 ' + area + '㎡',
        value: selfUse,
        total: true
      });
    }

    // セットバックを必要とする宅地
    var sb = num(input.setback && input.setback.area);
    if (sb > 0) {
      if (sb > area) throw new Error('セットバック面積が地積を超えています。');
      var deduction = floorYen(selfUse * sb / area * 0.7);
      selfUse -= deduction;
      steps.push({
        no: '控除',
        label: 'セットバックを必要とする宅地',
        formula: '自用地評価額 − 自用地評価額 × (' + sb + '㎡ ÷ ' + area + '㎡) × 0.7（控除額 ' + fmtYen(deduction) + '円）',
        value: selfUse,
        total: true
      });
    }

    var rightsValue = evaluateRights(selfUse, input.rights, steps);

    // 小規模宅地等の特例
    var taxable = rightsValue;
    var ss = input.smallSite;
    if (ss && ss.type && T.SMALL_SITE[ss.type]) {
      var def = T.SMALL_SITE[ss.type];
      var applyArea = Math.min(num(ss.area) || area, area, def.limit);
      var reduction = floorYen(rightsValue * applyArea / area * def.rate);
      taxable = rightsValue - reduction;
      steps.push({
        no: '特例',
        label: '小規模宅地等の特例（' + def.name + '）',
        formula: '評価額 − 評価額 × (' + applyArea + '㎡ ÷ ' + area + '㎡) × ' + (def.rate * 100) + '%（減額 ' + fmtYen(reduction) + '円）',
        value: taxable,
        total: true
      });
    }

    return {
      perSqm: perSqm,
      selfUse: selfUse,
      rightsValue: rightsValue,
      taxable: taxable,
      steps: steps,
      warnings: warnings
    };
  }

  var Valuation = {
    evaluate: evaluate,
    depthRate: depthRate,
    frontageRate: frontageRate,
    longDepthRate: longDepthRate,
    irregularTableRate: irregularTableRate,
    scaleRate: scaleRate,
    cliffRate: cliffRate,
    floor2: floor2
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Valuation;
  } else {
    root.LandValuation = Valuation;
  }
})(this);

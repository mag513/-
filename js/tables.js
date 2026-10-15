/*
 * 土地及び土地の上に存する権利の評価についての調整率表（平成30年1月分以降用）
 * 財産評価基本通達 付表1〜8 に基づく。
 *
 * ※ 数値は申告前に必ず国税庁の最新の調整率表と照合してください。
 */
(function (root) {
  'use strict';

  var DISTRICTS = [
    { id: 'building', name: 'ビル街地区' },
    { id: 'highCommercial', name: '高度商業地区' },
    { id: 'downtown', name: '繁華街地区' },
    { id: 'commercial', name: '普通商業・併用住宅地区' },
    { id: 'residential', name: '普通住宅地区' },
    { id: 'smallFactory', name: '中小工場地区' },
    { id: 'largeFactory', name: '大工場地区' }
  ];

  function repeat(v, n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(v);
    return a;
  }

  // ① 奥行価格補正率表（付表1）
  // 区分: 4未満, 4以上6未満, 6〜8, 8〜10, 10〜12, 12〜14, 14〜16, 16〜20, 20〜24, 24〜28,
  //       28〜32, 32〜36, 36〜40, 40〜44, 44〜48, 48〜52, 52〜56, 56〜60, 60〜64, 64〜68,
  //       68〜72, 72〜76, 76〜80, 80〜84, 84〜88, 88〜92, 92〜96, 96〜100, 100以上
  var DEPTH_BOUNDS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100];
  var DEPTH_RATES = {
    building: [0.80, 0.80, 0.84, 0.88, 0.90, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99].concat(repeat(1.00, 15)),
    highCommercial: [0.90, 0.92, 0.94, 0.96, 0.98, 0.99].concat(repeat(1.00, 23)),
    downtown: [0.90, 0.92, 0.95, 0.97, 0.99, 1.00, 1.00, 1.00, 1.00, 1.00,
      0.98, 0.96, 0.94, 0.92, 0.90, 0.88, 0.87, 0.86, 0.85, 0.84,
      0.83, 0.82, 0.81, 0.80].concat(repeat(0.80, 5)),
    commercial: [0.90, 0.92, 0.95, 0.97, 0.99, 1.00, 1.00, 1.00, 1.00, 1.00,
      1.00, 0.98, 0.96, 0.94, 0.92, 0.90, 0.88, 0.87, 0.86, 0.85,
      0.84, 0.83, 0.82, 0.81].concat(repeat(0.80, 5)),
    residential: [0.90, 0.92, 0.95, 0.97, 1.00, 1.00, 1.00, 1.00, 1.00, 0.97,
      0.95, 0.93, 0.92, 0.91, 0.90, 0.89, 0.88, 0.87, 0.86, 0.85,
      0.84, 0.83, 0.82, 0.81].concat(repeat(0.80, 5)),
    smallFactory: [0.85, 0.90, 0.93, 0.95, 0.96, 0.97, 0.98, 0.99].concat(repeat(1.00, 10),
      [0.99, 0.98, 0.97, 0.96, 0.95, 0.93], repeat(0.90, 5)),
    largeFactory: [0.85, 0.90, 0.93, 0.95, 0.96, 0.97, 0.98, 0.99].concat(repeat(1.00, 21))
  };

  // ② 側方路線影響加算率表（付表2）
  var SIDE_RATES = {
    building: { corner: 0.07, semiCorner: 0.03 },
    highCommercial: { corner: 0.10, semiCorner: 0.05 },
    downtown: { corner: 0.10, semiCorner: 0.05 },
    commercial: { corner: 0.08, semiCorner: 0.04 },
    residential: { corner: 0.03, semiCorner: 0.02 },
    smallFactory: { corner: 0.03, semiCorner: 0.02 },
    largeFactory: { corner: 0.02, semiCorner: 0.01 }
  };

  // ③ 二方路線影響加算率表（付表3）
  var REAR_RATES = {
    building: 0.03,
    highCommercial: 0.07,
    downtown: 0.07,
    commercial: 0.05,
    residential: 0.02,
    smallFactory: 0.02,
    largeFactory: 0.02
  };

  // ④ 不整形地補正率を算定する際の地積区分表（付表4）: [A/B境界, B/C境界]
  var IRREGULAR_AREA_CLASS = {
    highCommercial: [1000, 1500],
    downtown: [450, 700],
    commercial: [650, 1000],
    residential: [500, 750],
    smallFactory: [3500, 5000]
  };

  // ⑤ 不整形地補正率表（付表5）
  // かげ地割合区分: 10%以上, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65%以上
  var SHADOW_BOUNDS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65];
  var IRREGULAR_RATES = {
    // 高度商業・繁華街・普通商業・併用住宅・中小工場地区
    general: {
      A: [0.99, 0.98, 0.97, 0.96, 0.94, 0.92, 0.90, 0.87, 0.84, 0.80, 0.76, 0.70],
      B: [0.99, 0.99, 0.98, 0.98, 0.97, 0.95, 0.93, 0.91, 0.89, 0.87, 0.84, 0.75],
      C: [1.00, 0.99, 0.99, 0.99, 0.98, 0.98, 0.97, 0.95, 0.93, 0.90, 0.86, 0.80]
    },
    // 普通住宅地区
    residential: {
      A: [0.98, 0.96, 0.94, 0.92, 0.90, 0.88, 0.85, 0.82, 0.79, 0.75, 0.70, 0.60],
      B: [0.99, 0.98, 0.97, 0.95, 0.93, 0.91, 0.88, 0.85, 0.82, 0.78, 0.73, 0.65],
      C: [0.99, 0.99, 0.98, 0.97, 0.96, 0.94, 0.92, 0.90, 0.87, 0.83, 0.78, 0.70]
    }
  };

  // ⑥ 間口狭小補正率表（付表6）
  // 区分: 4未満, 4〜6, 6〜8, 8〜10, 10〜16, 16〜22, 22〜28, 28以上（null は表に定めなし）
  var FRONTAGE_BOUNDS = [4, 6, 8, 10, 16, 22, 28];
  var FRONTAGE_RATES = {
    building: [null, null, null, 0.95, 0.97, 0.98, 0.99, 1.00],
    highCommercial: [0.85, 0.94, 0.97, 1.00, 1.00, 1.00, 1.00, 1.00],
    downtown: [0.90, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
    commercial: [0.90, 0.97, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
    residential: [0.90, 0.94, 0.97, 1.00, 1.00, 1.00, 1.00, 1.00],
    smallFactory: [0.80, 0.85, 0.90, 0.95, 1.00, 1.00, 1.00, 1.00],
    largeFactory: [0.80, 0.85, 0.90, 0.90, 0.95, 0.97, 0.98, 1.00]
  };

  // ⑦ 奥行長大補正率表（付表7）
  // 奥行距離/間口距離: 2未満, 2〜3, 3〜4, 4〜5, 5〜6, 6〜7, 7〜8, 8以上
  var LONG_DEPTH_BOUNDS = [2, 3, 4, 5, 6, 7, 8];
  var LONG_DEPTH_RATES = {
    building: repeat(1.00, 8),
    highCommercial: [1.00, 1.00, 0.99, 0.98, 0.96, 0.94, 0.92, 0.90],
    downtown: [1.00, 1.00, 0.99, 0.98, 0.96, 0.94, 0.92, 0.90],
    commercial: [1.00, 1.00, 0.99, 0.98, 0.96, 0.94, 0.92, 0.90],
    residential: [1.00, 0.98, 0.96, 0.94, 0.92, 0.90, 0.90, 0.90],
    smallFactory: [1.00, 1.00, 0.99, 0.98, 0.96, 0.94, 0.92, 0.90],
    largeFactory: repeat(1.00, 8)
  };

  // ⑧ がけ地補正率表（付表8）
  // がけ地地積/総地積: 0.10以上, 0.20, 0.30, ... 0.90以上
  var CLIFF_BOUNDS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
  var CLIFF_RATES = {
    south: [0.96, 0.92, 0.88, 0.85, 0.82, 0.79, 0.76, 0.73, 0.70],
    east: [0.95, 0.91, 0.87, 0.84, 0.81, 0.78, 0.75, 0.72, 0.69],
    west: [0.94, 0.90, 0.86, 0.82, 0.78, 0.75, 0.72, 0.69, 0.66],
    north: [0.93, 0.88, 0.83, 0.78, 0.73, 0.69, 0.65, 0.62, 0.59]
  };
  var CLIFF_DIRECTIONS = [
    { id: 'south', name: '南' },
    { id: 'east', name: '東' },
    { id: 'west', name: '西' },
    { id: 'north', name: '北' }
  ];

  // 規模格差補正率（地積規模の大きな宅地）の B・C
  var LARGE_SCALE = {
    metro: [
      { min: 500, max: 1000, b: 0.95, c: 25 },
      { min: 1000, max: 3000, b: 0.90, c: 75 },
      { min: 3000, max: 5000, b: 0.85, c: 225 },
      { min: 5000, max: Infinity, b: 0.80, c: 475 }
    ],
    other: [
      { min: 1000, max: 3000, b: 0.90, c: 100 },
      { min: 3000, max: 5000, b: 0.85, c: 250 },
      { min: 5000, max: Infinity, b: 0.80, c: 500 }
    ]
  };

  // 借地権割合（路線価図の記号）
  var LEASEHOLD_RATIOS = [
    { id: 'A', ratio: 0.9 },
    { id: 'B', ratio: 0.8 },
    { id: 'C', ratio: 0.7 },
    { id: 'D', ratio: 0.6 },
    { id: 'E', ratio: 0.5 },
    { id: 'F', ratio: 0.4 },
    { id: 'G', ratio: 0.3 }
  ];

  // 小規模宅地等の特例（租税特別措置法69条の4）
  var SMALL_SITE = {
    residence: { name: '特定居住用宅地等', limit: 330, rate: 0.8 },
    business: { name: '特定事業用宅地等', limit: 400, rate: 0.8 },
    rental: { name: '貸付事業用宅地等', limit: 200, rate: 0.5 }
  };

  var Tables = {
    DISTRICTS: DISTRICTS,
    DEPTH_BOUNDS: DEPTH_BOUNDS,
    DEPTH_RATES: DEPTH_RATES,
    SIDE_RATES: SIDE_RATES,
    REAR_RATES: REAR_RATES,
    IRREGULAR_AREA_CLASS: IRREGULAR_AREA_CLASS,
    SHADOW_BOUNDS: SHADOW_BOUNDS,
    IRREGULAR_RATES: IRREGULAR_RATES,
    FRONTAGE_BOUNDS: FRONTAGE_BOUNDS,
    FRONTAGE_RATES: FRONTAGE_RATES,
    LONG_DEPTH_BOUNDS: LONG_DEPTH_BOUNDS,
    LONG_DEPTH_RATES: LONG_DEPTH_RATES,
    CLIFF_BOUNDS: CLIFF_BOUNDS,
    CLIFF_RATES: CLIFF_RATES,
    CLIFF_DIRECTIONS: CLIFF_DIRECTIONS,
    LARGE_SCALE: LARGE_SCALE,
    LEASEHOLD_RATIOS: LEASEHOLD_RATIOS,
    SMALL_SITE: SMALL_SITE
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Tables;
  } else {
    root.LandTables = Tables;
  }
})(this);

(function () {
  'use strict';

  var T = window.LandTables;
  var V = window.LandValuation;
  var STORAGE_KEY = 'land-valuation:v1';

  var form = document.getElementById('form');
  var sidesEl = document.getElementById('sides');
  var sideTpl = document.getElementById('sideTpl');

  var RIGHTS_LABELS = {
    self: '自用地の評価額',
    leasedLand: '貸宅地の評価額',
    rentalBuildingLand: '貸家建付地の評価額',
    leasehold: '借地権の評価額',
    rentalLeasehold: '貸家建付借地権の評価額'
  };

  function el(name) {
    return form.elements[name];
  }

  function fillSelect(select, items, label) {
    items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.value;
      o.textContent = label(it);
      select.appendChild(o);
    });
  }

  fillSelect(el('district'), T.DISTRICTS.map(function (d) { return { value: d.id, name: d.name }; }),
    function (d) { return d.name; });
  el('district').value = 'residential';
  fillSelect(el('cliffDirection'), T.CLIFF_DIRECTIONS.map(function (d) { return { value: d.id, name: d.name }; }),
    function (d) { return d.name; });
  fillSelect(el('leaseholdRatio'), T.LEASEHOLD_RATIOS.map(function (r) { return { value: r.ratio, id: r.id }; }),
    function (r) { return r.id + '（' + Math.round(r.value * 100) + '%）'; });
  el('leaseholdRatio').value = '0.6';

  function yen(n) {
    return n === null || n === undefined ? '—' : n.toLocaleString('ja-JP') + ' 円';
  }

  // ---- 側方路線 ----
  function addSide(data) {
    var node = sideTpl.content.firstElementChild.cloneNode(true);
    data = data || {};
    node.querySelectorAll('[data-k]').forEach(function (inp) {
      var v = data[inp.dataset.k];
      if (v !== undefined && v !== null) inp.value = v;
    });
    node.querySelector('.remove').addEventListener('click', function () {
      node.remove();
      renumberSides();
      update();
    });
    sidesEl.appendChild(node);
    renumberSides();
  }

  function renumberSides() {
    sidesEl.querySelectorAll('.side').forEach(function (n, i) {
      n.querySelector('.idx').textContent = i + 1;
    });
  }

  function readSides() {
    return Array.prototype.map.call(sidesEl.querySelectorAll('.side'), function (n) {
      var o = {};
      n.querySelectorAll('[data-k]').forEach(function (inp) { o[inp.dataset.k] = inp.value; });
      return o;
    });
  }

  // ---- フォーム ⇔ 状態 ----
  function readState() {
    var s = {};
    Array.prototype.forEach.call(form.elements, function (inp) {
      if (!inp.name) return;
      s[inp.name] = inp.type === 'checkbox' ? inp.checked : inp.value;
    });
    s.sides = readSides();
    return s;
  }

  function writeState(s) {
    form.reset();
    sidesEl.innerHTML = '';
    Object.keys(s || {}).forEach(function (k) {
      var inp = el(k);
      if (!inp || !inp.name) return;
      if (inp.type === 'checkbox') inp.checked = !!s[k];
      else inp.value = s[k];
    });
    (s && s.sides || []).forEach(addSide);
    update();
  }

  function toInput(s) {
    return {
      method: s.method,
      area: s.area,
      district: s.district,
      front: { price: s.frontPrice, frontage: s.frontage, depth: s.depth },
      sides: s.sides,
      rear: s.rearEnabled ? { price: s.rearPrice, depth: s.rearDepth, ratio: s.rearRatio } : null,
      irregular: { enabled: s.irregularEnabled, assumedFrontage: s.assumedFrontage, assumedDepth: s.assumedDepth },
      largeScale: { enabled: s.largeScaleEnabled, metro: s.metro === '1' },
      cliff: { enabled: s.cliffEnabled, area: s.cliffArea, direction: s.cliffDirection },
      setback: { area: s.setbackArea },
      bairitsu: { fixedAssetValue: s.fixedAssetValue, multiplier: s.multiplier },
      rights: { type: s.rightsType, leaseholdRatio: s.leaseholdRatio, tenancyRatio: s.tenancyRatio, occupancy: s.occupancy },
      smallSite: { type: s.smallSiteType, area: s.smallSiteArea }
    };
  }

  // ---- 表示切替 ----
  function syncVisibility(s) {
    document.querySelectorAll('[data-show]').forEach(function (n) {
      n.hidden = n.dataset.show !== s.method;
    });
    form.querySelectorAll('[data-when]').forEach(function (n) {
      n.hidden = !s[n.dataset.when];
    });
    var t = s.rightsType;
    form.querySelectorAll('[data-rights="leaseholdRatio"]').forEach(function (n) { n.hidden = t === 'self'; });
    form.querySelectorAll('[data-rights="tenancy"]').forEach(function (n) {
      n.hidden = t !== 'rentalBuildingLand' && t !== 'rentalLeasehold';
    });
  }

  // ---- 計算・描画 ----
  function render(result, s) {
    var err = document.getElementById('error');
    var stepsEl = document.getElementById('steps');
    var warnEl = document.getElementById('warnings');
    stepsEl.innerHTML = '';
    warnEl.innerHTML = '';
    document.getElementById('memoOut').textContent = s.memo || '';

    if (result.error) {
      err.textContent = result.error;
      err.hidden = false;
      ['perSqm', 'selfUse', 'rightsValue', 'taxable'].forEach(function (id) {
        document.getElementById(id).textContent = '—';
      });
      document.getElementById('taxableRow').hidden = true;
      document.getElementById('mobileValue').textContent = '—';
      return;
    }
    err.hidden = true;

    var r = result.value;
    document.getElementById('perSqm').textContent = r.perSqm === null ? '—（倍率方式）' : yen(r.perSqm);
    document.getElementById('selfUse').textContent = yen(r.selfUse);
    document.getElementById('rightsLabel').textContent = RIGHTS_LABELS[s.rightsType] || '評価額';
    document.getElementById('rightsValue').textContent = yen(r.rightsValue);
    var hasSmall = !!s.smallSiteType;
    document.getElementById('taxableRow').hidden = !hasSmall;
    document.getElementById('taxable').textContent = yen(r.taxable);
    document.getElementById('mobileLabel').textContent = hasSmall ? '特例適用後' : (RIGHTS_LABELS[s.rightsType] || '評価額');
    document.getElementById('mobileValue').textContent = yen(hasSmall ? r.taxable : r.rightsValue);

    r.steps.forEach(function (st) {
      var tr = document.createElement('tr');
      if (st.total) tr.className = 'total';
      var no = document.createElement('td');
      no.textContent = st.no;
      var desc = document.createElement('td');
      var b = document.createElement('strong');
      b.textContent = st.label;
      var f = document.createElement('div');
      f.className = 'formula';
      f.textContent = st.formula;
      desc.appendChild(b);
      desc.appendChild(f);
      var val = document.createElement('td');
      val.className = 'num';
      val.textContent = st.value === null ? '' : st.value.toLocaleString('ja-JP') + (st.total ? ' 円' : ' 円/㎡');
      tr.appendChild(no);
      tr.appendChild(desc);
      tr.appendChild(val);
      stepsEl.appendChild(tr);
    });

    r.warnings.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      warnEl.appendChild(li);
    });
  }

  function update() {
    var s = readState();
    syncVisibility(s);
    var result;
    try {
      result = { value: V.evaluate(toInput(s)) };
    } catch (e) {
      result = { error: e.message };
    }
    render(result, s);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) { /* 保存できない環境では無視 */ }
  }

  // ---- イベント ----
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  document.getElementById('addSide').addEventListener('click', function () {
    addSide({});
    update();
  });

  var SAMPLE = {
    memo: 'サンプル：角地・普通住宅地区',
    method: 'rosenka',
    area: '330',
    district: 'residential',
    frontPrice: '250000',
    frontage: '15',
    depth: '22',
    sides: [{ price: '200000', depth: '', type: 'corner', ratio: '' }],
    rightsType: 'self',
    smallSiteType: 'residence'
  };

  document.getElementById('sample').addEventListener('click', function () {
    writeState(SAMPLE);
  });
  document.getElementById('clearForm').addEventListener('click', function () {
    writeState({ method: 'rosenka', district: 'residential', leaseholdRatio: '0.6', tenancyRatio: '0.3', occupancy: '1', multiplier: '1.1' });
  });
  document.getElementById('print').addEventListener('click', function () {
    window.print();
  });
  document.getElementById('export').addEventListener('click', function () {
    var s = readState();
    var blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.memo || '土地評価') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById('import').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.text().then(function (txt) {
      writeState(JSON.parse(txt));
    }).catch(function () {
      alert('JSONファイルを読み込めませんでした。');
    });
    e.target.value = '';
  });

  // ---- 初期化 ----
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) { saved = null; }
  if (saved) writeState(saved);
  else update();
})();

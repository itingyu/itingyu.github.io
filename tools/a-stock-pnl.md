---
layout: page
title: A 股净盈亏速算
permalink: /tools/a-stock-pnl/
nav_active: tools
description: A 股交易净盈亏速算表(纯前端,无后端)。支持涨/跌/做T/反T 四种模式,按本金 × 涨幅矩阵计算扣费后净盈亏。
---

<script>
// A 股净盈亏速算 — 纯前端(无行情接口、无后端)
// 公式来源: 120.78.127.75:9000/stock/ "A 股净盈亏速算"
(function() {
  'use strict';

  // --- 固定费率 ---
  const c = 0.854 / 10000;   // 佣金 万0.854
  const s = 5 / 10000;       // 印花税 万5(只卖出收一次)
  const t = 0.1 / 10000;     // 过户费 万0.1

  // --- 工具函数 ---
  function trunc2(v) { return Math.floor(v * 100 + 0.0001) / 100; }

  function profit(principal, ret, c, s, t, minComm, mode) {
    const _c = v => trunc2(Math.max(v, minComm));
    const _t = v => trunc2(v * t);
    const _s = v => trunc2(v * s);
    if (mode === 't0' || mode === 'rt0') {
      const sellAmount = principal;
      const buyAmount  = principal * (1 - ret);
      const gain = principal * ret;
      const sellSide = _c(sellAmount * c) + _s(sellAmount) + _t(sellAmount);
      const buySide  = _c(buyAmount  * c) + _t(buyAmount);
      return gain - sellSide - buySide;
    }
    const sign = mode === 'down' ? -1 : 1;
    const buyAmount  = principal;
    const sellAmount = principal * (1 + sign * ret);
    const gain       = sign * principal * ret;
    const buySide  = _c(buyAmount  * c) + _t(buyAmount);
    const sellSide = _c(sellAmount * c) + _s(sellAmount) + _t(sellAmount);
    return gain - buySide - sellSide;
  }

  function breakeven(principal, c, s, t, minComm, mode) {
    const calcMode = (mode === 't0' || mode === 'rt0') ? 't0' : 'long';
    let lo = 0, hi = 0.5;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (profit(principal, mid, c, s, t, minComm, calcMode) < 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function fmtMoney(v) {
    const sign = v >= 0 ? '+' : '';
    return sign + v.toFixed(2);
  }
  function fmtPrincipal(p) {
    if (p >= 10000) return (p / 10000).toFixed(p % 10000 === 0 ? 0 : 1) + ' 万';
    return p.toLocaleString();
  }
  function fmtPct(p) {
    return (p * 100).toFixed(3) + '%';
  }

  // --- 本金(行) + 涨幅(列) ---
  function buildPrincipals() {
    return [
      ...Array.from({length: 9},  (_, i) => (i + 1) * 100),
      ...Array.from({length: 18}, (_, i) => 1000 + i * 500),
      ...Array.from({length: 39}, (_, i) => 10000 + i * 5000)
    ];
  }
  function buildReturns(maxPct) {
    const arr = [];
    for (let r = 0.1; r <= 1.0 + 1e-9; r += 0.1) arr.push(r / 100);
    for (let r = 1.25; r <= maxPct + 1e-9; r += 0.25) arr.push(r / 100);
    return arr;
  }

  // --- 模式说明 ---
  const MODE_DESC = {
    long: '涨模式 · 多头持仓',
    down: '跌模式 · 多头止损',
    t0:   '做T · 先卖后买',
    rt0:  '反T · 先买后卖'
  };
  const ARROW = { long: '▲', down: '▼', t0: '↕', rt0: '↕' };

  // --- 状态 ---
  function readState() {
    const minComm = parseInt(document.querySelector('input[name="minComm"]:checked').value, 10);
    const mode    = document.querySelector('input[name="mode"]:checked').value;
    const maxRet  = parseInt(document.querySelector('input[name="maxRet"]:checked').value, 10);
    return { minComm, mode, maxRet };
  }

  // --- 渲染 ---
  function render() {
    const { minComm, mode, maxRet } = readState();
    const arrow = ARROW[mode];
    const arrowCls = mode === 'down' ? 'pnl-down' : (mode === 't0' || mode === 'rt0' ? 'pnl-wave' : 'pnl-up');
    const principals = buildPrincipals();
    const returns = buildReturns(maxRet);
    const isInverse = (mode === 'down');

    // 头部描述
    const colDesc = `列 = ${MODE_DESC[mode].split(' · ')[1] || '幅度'}`;
    const modeDesc = `模式 = ${MODE_DESC[mode]}`;
    document.getElementById('pnlCaption').innerHTML =
      `每行 = 不同本金 ｜ ${colDesc} ｜ ${modeDesc} ｜ 单元格 = 净盈亏(元) ｜ 红=盈利 / 绿=亏损 / 黄=保本`;

    // 表头
    const returnsRender = isInverse ? [...returns].reverse() : returns;
    let thead = '<thead><tr><th class="pnl-th-p">本金</th><th class="pnl-th-be">保本幅度</th>';
    for (const r of returnsRender) {
      const sign = isInverse ? '−' : '+';
      const pctVal = r * 100;
      const txt = sign + (pctVal >= 1 ? pctVal.toFixed(1) : pctVal.toFixed(2)) + '%';
      thead += `<th><span class="${arrowCls}">${arrow}</span>${txt}</th>`;
    }
    thead += '</tr></thead>';

    // 表格体
    let tbody = '<tbody>';
    for (const p of principals) {
      const be = breakeven(p, c, s, t, minComm, mode);
      tbody += `<tr><td class="pnl-td-p">${fmtPrincipal(p)}</td><td class="pnl-td-be">${fmtPct(be)}</td>`;
      for (const r of returnsRender) {
        const ret = isInverse ? r : r; // 列已反转
        const pr = profit(p, ret, c, s, t, minComm, mode);
        let cls = '';
        if (pr > 0) cls = 'pnl-pos';
        else if (pr < 0) cls = 'pnl-neg';
        else cls = 'pnl-warn';
        // hover 工具提示
        const buySide  = trunc2(Math.max(p * c, minComm)) + trunc2(p * t);
        const sellAmt  = mode === 't0' || mode === 'rt0' ? p * (1 - ret) : p * (1 + (isInverse ? -1 : 1) * ret);
        const sellSide = trunc2(Math.max(sellAmt * c, minComm)) + trunc2(sellAmt * s) + trunc2(sellAmt * t);
        const buyAmt2  = mode === 't0' || mode === 'rt0' ? p : p;
        const buySideT = trunc2(Math.max(buyAmt2 * c, minComm)) + trunc2(buyAmt2 * t);
        const tip = `${MODE_DESC[mode]} ｜ 本金 ${fmtPrincipal(p)} ｜ 幅度 ${(ret*100).toFixed(2)}%\n毛利: ${(isInverse ? -1 : 1) * p * ret} 元\n买入侧: ${buySideT.toFixed(2)} 元\n卖出侧: ${sellSide.toFixed(2)} 元\n净盈亏: ${pr.toFixed(2)} 元`;
        tbody += `<td class="${cls}" data-tip="${tip.replace(/"/g, '&quot;')}">${fmtMoney(pr)}</td>`;
      }
      tbody += '</tr>';
    }
    tbody += '</tbody>';

    document.getElementById('pnlGrid').innerHTML = thead + tbody;

    // 临界交易额
    const minComm2 = minComm;
    document.getElementById('pnlMinComm').textContent = minComm2 + ' 元';
    const critical = Math.ceil(minComm2 * 2 / (c * 2 + t * 2 + s)); // 简化估算
    document.getElementById('pnlCritical').textContent = critical.toLocaleString();

    // 实时费率展示
    const sampleP = 100000;
    const sampleBE = breakeven(sampleP, c, s, t, minComm, mode);
    document.getElementById('pnlSample').textContent = `本金 ${fmtPrincipal(sampleP)} 时的保本幅度 = ${fmtPct(sampleBE)}`;
  }

  // --- 工具提示 ---
  function attachTooltip() {
    const tip = document.getElementById('pnlTip');
    if (!tip) return;
    document.getElementById('pnlGrid').addEventListener('mouseover', (e) => {
      const td = e.target.closest('td[data-tip]');
      if (!td) return;
      tip.textContent = td.dataset.tip;
      tip.style.display = 'block';
      const onMove = (ev) => {
        tip.style.left = (ev.clientX + 12) + 'px';
        tip.style.top  = (ev.clientY + 12) + 'px';
      };
      document.addEventListener('mousemove', onMove);
      td.addEventListener('mouseleave', () => {
        tip.style.display = 'none';
        document.removeEventListener('mousemove', onMove);
      }, { once: true });
    });
  }

  // --- 启动 ---
  function init() {
    document.querySelectorAll('input[name="minComm"], input[name="mode"], input[name="maxRet"]')
      .forEach(el => el.addEventListener('change', render));
    render();
    attachTooltip();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
</script>

<div class="pnl-tool">
  <div class="pnl-controls card">
    <div class="pnl-ctrl-group">
      <span class="pnl-ctrl-label">最低佣金</span>
      <div class="pnl-radio-group">
        <label><input type="radio" name="minComm" value="2" checked> 2 元</label>
        <label><input type="radio" name="minComm" value="5"> 5 元</label>
      </div>
    </div>
    <div class="pnl-ctrl-group">
      <span class="pnl-ctrl-label">模式</span>
      <div class="pnl-radio-group">
        <label><input type="radio" name="mode" value="long" checked> 涨</label>
        <label><input type="radio" name="mode" value="down"> 跌</label>
        <label><input type="radio" name="mode" value="t0"> 做T</label>
        <label><input type="radio" name="mode" value="rt0"> 反T</label>
      </div>
    </div>
    <div class="pnl-ctrl-group">
      <span class="pnl-ctrl-label">幅度上限</span>
      <div class="pnl-radio-group">
        <label><input type="radio" name="maxRet" value="10" checked> 10%</label>
        <label><input type="radio" name="maxRet" value="20"> 20%</label>
      </div>
    </div>
    <div class="pnl-ctrl-group">
      <span class="pnl-ctrl-label">固定费率</span>
      <span class="pnl-rates">佣金 万0.854 + 印花税 万5 + 过户费 万0.1</span>
    </div>
  </div>

  <div class="pnl-meta card">
    <div class="pnl-meta-row"><b>实时费率：</b>佣金 万0.854、印花税 万5（卖出单边）、过户费 万0.1（双边）</div>
    <div class="pnl-meta-row"><b>精度：</b>每项费用单独舍去至分（券商实算方式），非四舍五入</div>
    <div class="pnl-meta-row"><b>颜色：</b><span class="pnl-pos">红 = 盈利</span> ｜ <span class="pnl-neg">绿 = 亏损</span> ｜ <span class="pnl-warn">黄 = 保本</span></div>
    <div class="pnl-meta-row"><b>临界交易额：</b>最低佣金 <span id="pnlMinComm">2 元</span> 时，<span id="pnlCritical">23,419</span> 元以下按最低、以上按比例</div>
    <div class="pnl-meta-row"><b id="pnlSample">—</b></div>
  </div>

  <p class="pnl-caption" id="pnlCaption">加载中…</p>

  <div class="pnl-table-wrap">
    <table class="pnl-table" id="pnlGrid"></table>
  </div>
  <div class="pnl-tip" id="pnlTip" style="display:none;"></div>

  <details class="pnl-formula">
    <summary>📖 公式</summary>
    <div class="pnl-formula-body">
      <p><b>涨模式（多头持仓盈利）</b></p>
      <p class="pnl-code">净盈亏 = 涨幅 × 本金 − 买入侧 − 卖出侧</p>
      <p class="pnl-code">买入侧 = max(本金 × c, 最低佣金) + 本金 × t</p>
      <p class="pnl-code">卖出侧 = max(本金 × (1+涨幅) × c, 最低佣金) + 本金 × (1+涨幅) × (s + t)</p>
      <p><b>跌模式（多头止损）</b></p>
      <p class="pnl-code">净盈亏 = −跌幅 × 本金 − 买入侧 − 卖出侧</p>
      <p><b>做T / 反T（T+0）</b></p>
      <p class="pnl-code">净盈亏 = 振幅 × 本金 − 卖出侧 − 买入侧</p>
      <p class="pnl-code">卖出侧 = max(本金 × c, 最低佣金) + 本金 × (s + t)</p>
      <p class="pnl-code">买入侧 = max(本金 × (1−振幅) × c, 最低佣金) + 本金 × (1−振幅) × t</p>
      <p>本金 = 卖出金额（高价侧）。做T = 先卖后买；反T = 先买后卖；两者手续费结构相同。</p>
    </div>
  </details>

  <div class="callout callout-warn">
    <strong>声明</strong> · 本工具仅作扣费后净盈亏速算，<b>不构成任何投资建议</b>。所有计算均按公式执行，不保证与券商实算完全一致（不同券商对小数舍入规则可能略有差异）。
  </div>
</div>

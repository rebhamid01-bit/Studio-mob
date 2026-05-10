'use strict';
/**
 * dashboard/charts.js  (renderer-side)
 *
 * All Chart.js instances. Each builder destroys the previous chart
 * on the same canvas before re-creating — safe for filter refreshes.
 *
 * Exposed as window.DashCharts — no module bundler needed.
 */

/* ── Registry ─────────────────────────────────────────── */
const _reg = {};
function _destroy(id) { if (_reg[id]) { _reg[id].destroy(); delete _reg[id]; } }

/* ── Theme palette ───────────────────────────────────── */
const C = {
  gold:       'rgba(201,168, 76,1)',  goldFill:  'rgba(201,168, 76,0.14)',
  goldFill2:  'rgba(201,168, 76,0.06)',
  green:      'rgba( 92,186,125,1)',  greenFill: 'rgba( 92,186,125,0.14)',
  blue:       'rgba( 91,141,238,1)',  blueFill:  'rgba( 91,141,238,0.12)',
  orange:     'rgba(232,155, 74,1)',  orangeFill:'rgba(232,155, 74,0.14)',
  purple:     'rgba(155,125,232,1)',  purpleFill:'rgba(155,125,232,0.12)',
  danger:     'rgba(224, 92, 92,1)',  dangerFill:'rgba(224, 92, 92,0.12)',
  muted:      'rgba(102,102,102,1)',
  grid:       'rgba(255,255,255,0.04)',
  tick:       'rgba(255,255,255,0.32)',
};
const PALETTE = [C.gold,C.green,C.blue,C.orange,C.purple,C.danger,
  'rgba(80,200,180,1)','rgba(200,120,80,1)','rgba(120,180,80,1)','rgba(180,80,160,1)'];

/* ── Shared scale / plugin factories ─────────────────── */
function _xScale(rot) {
  return { ticks:{ color:C.tick, font:{size:9}, maxRotation:rot||0 },
           grid:{ color:C.grid }, border:{ color:'transparent' } };
}
function _yScale(pct) {
  return {
    ticks:{ color:C.tick, font:{size:9},
      callback: pct
        ? v => v.toFixed(0)+'%'
        : v => Math.abs(v)>=1e6 ? (v/1e6).toFixed(1)+'M'
              : Math.abs(v)>=1e3 ? (v/1e3).toFixed(0)+'k' : v.toFixed(0) },
    grid:{ color:C.grid }, border:{ color:'transparent' },
  };
}
function _yScaleRight() {   // secondary axis
  return { position:'right', ticks:{ color:C.tick, font:{size:9}, callback:v=>v.toFixed(0)+'%' },
           grid:{ drawOnChartArea:false }, border:{ color:'transparent' } };
}
function _tooltip(extra) {
  return { backgroundColor:'rgba(18,15,8,0.97)', borderColor:C.gold, borderWidth:1,
           titleColor:C.gold, bodyColor:'rgba(220,210,180,0.9)',
           padding:10, cornerRadius:6, ...(extra||{}) };
}
function _legend(display) {
  return { display:!!display, labels:{ color:C.tick, font:{size:10}, boxWidth:10, padding:12 } };
}

/* ── Tiny formatters (no DOM dependency) ─────────────── */
function _da(n) {
  if (n==null||isNaN(+n)) return '—';
  const v=+n;
  if (Math.abs(v)>=1e6) return (v/1e6).toFixed(2)+' M DA';
  if (Math.abs(v)>=1e3) return (v/1e3).toFixed(1)+' k DA';
  return v.toFixed(0)+' DA';
}
function _pct(f) { return (+f*100).toFixed(1)+' %'; }
function _monthLbl(ym) {
  if(!ym) return '';
  const [y,m]=ym.split('-');
  return ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][+m-1]+' '+y.slice(2);
}
function _weekLbl(w) {
  if(!w) return '';
  const p=w.split('-W'); return 'S'+p[1]+" '"+p[0].slice(2);
}

/* ══════════════════════════════════════════════════════
   1. Monthly Revenue — dual-axis line
══════════════════════════════════════════════════════ */
function buildRevenueChart(id, rows) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  _reg[id]=new Chart(ctx,{
    type:'line',
    data:{
      labels:rows.map(r=>_monthLbl(r.month)),
      datasets:[
        { label:'CA',     data:rows.map(r=>r.revenue||0), borderColor:C.gold,   backgroundColor:C.goldFill,  borderWidth:2, pointRadius:3, tension:0.4, fill:true  },
        { label:'Profit', data:rows.map(r=>r.profit||0),  borderColor:C.green,  backgroundColor:C.greenFill, borderWidth:2, pointRadius:3, tension:0.4, fill:false },
        { label:'Devis',  data:rows.map(r=>r.count||0),   borderColor:C.blue,   backgroundColor:'transparent',borderWidth:1.5,pointRadius:2,tension:0.4,fill:false,
          yAxisID:'y2', borderDash:[4,3] },
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{ x:_xScale(40), y:_yScale(false), y2:{..._yScaleRight(), title:{display:true,text:'Devis',color:C.tick,font:{size:8}}} },
      plugins:{ legend:_legend(true), tooltip:{ ..._tooltip(), callbacks:{ label:c=> c.dataset.yAxisID==='y2' ? ` Devis: ${c.raw}` : ` ${c.dataset.label}: ${_da(c.raw)}` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   2. Revenue Detail — stacked bar + line overlay
══════════════════════════════════════════════════════ */
function buildRevenueDetailChart(id, rows) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  _reg[id]=new Chart(ctx,{
    type:'bar',
    data:{
      labels:rows.map(r=>_monthLbl(r.month)),
      datasets:[
        { label:'Profit',          data:rows.map(r=>r.profit||0), backgroundColor:C.greenFill, borderColor:C.green, borderWidth:1, stack:'s' },
        { label:'Coût de revient', data:rows.map(r=>r.cost||0),   backgroundColor:C.goldFill,  borderColor:C.gold,  borderWidth:1, stack:'s' },
        { label:'CA (courbe)',     data:rows.map(r=>r.revenue||0), type:'line', borderColor:C.blue, backgroundColor:'transparent',
          borderWidth:2, pointRadius:3, tension:0.4 },
      ],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{ x:_xScale(40), y:_yScale(false) },
      plugins:{ legend:_legend(true), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` ${c.dataset.label}: ${_da(c.raw)}` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   3. Status Doughnut
══════════════════════════════════════════════════════ */
function buildStatusChart(id, rows) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  const LMAP={ OK:'OK', LOW_MARGIN_RISK:'Marge faible', OVERPRICE_RISK:'Prix élevé', LOSS:'Perte' };
  const CMAP={ OK:C.green, LOW_MARGIN_RISK:C.orange, OVERPRICE_RISK:C.blue, LOSS:C.danger };
  const cols=rows.map(r=>CMAP[r.status]||C.muted);
  _reg[id]=new Chart(ctx,{
    type:'doughnut',
    data:{
      labels:rows.map(r=>LMAP[r.status]||r.status),
      datasets:[{ data:rows.map(r=>r.count), backgroundColor:cols.map(c=>c.replace('1)','0.78)')),
        borderColor:cols, borderWidth:1.5, hoverOffset:6 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'64%',
      plugins:{ legend:_legend(true), tooltip:{ ..._tooltip(), callbacks:{
        label:c=>{ const t=c.dataset.data.reduce((a,b)=>a+b,0); return ` ${c.label}: ${c.raw} (${t>0?(c.raw/t*100).toFixed(1):0}%)`; }
      }}},
    },
  });
}

/* ══════════════════════════════════════════════════════
   4. Cost Breakdown Doughnut
══════════════════════════════════════════════════════ */
function buildCostBreakdownChart(id, bd) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  const keys  =['materiaux','chant','accessoires','main_oeuvre','frais_generaux'];
  const labels=['Matériaux','Chant','Accessoires','Main d\'œuvre','Frais généraux'];
  const cols  =[C.gold,C.blue,C.purple,C.green,C.orange];
  const vals  =keys.map(k=>bd[k]||0);
  _reg[id]=new Chart(ctx,{
    type:'doughnut',
    data:{
      labels,
      datasets:[{ data:vals, backgroundColor:cols.map(c=>c.replace('1)','0.75)')),
        borderColor:cols, borderWidth:1.5, hoverOffset:6 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'56%',
      plugins:{ legend:_legend(true), tooltip:{ ..._tooltip(), callbacks:{
        label:c=>{ const t=c.dataset.data.reduce((a,b)=>a+b,0); return ` ${c.label}: ${_da(c.raw)} (${t>0?(c.raw/t*100).toFixed(1):0}%)`; }
      }}},
    },
  });
}

/* ══════════════════════════════════════════════════════
   5. Profit Distribution Bar
══════════════════════════════════════════════════════ */
function buildProfitDistChart(id, rows) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  _reg[id]=new Chart(ctx,{
    type:'bar',
    data:{
      labels:rows.map(r=>_da(r.bucket_floor)),
      datasets:[{ label:'Devis', data:rows.map(r=>r.count),
        backgroundColor:C.goldFill, borderColor:C.gold, borderWidth:1, borderRadius:3 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{ x:{ticks:{color:C.tick,font:{size:8},maxRotation:45},grid:{color:C.grid},border:{color:'transparent'}}, y:_yScale(false) },
      plugins:{ legend:_legend(false), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` ${c.raw} devis` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   6. Margin Evolution Line
══════════════════════════════════════════════════════ */
function buildMarginEvolutionChart(id, rows) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  _reg[id]=new Chart(ctx,{
    type:'line',
    data:{
      labels:rows.map(r=>_weekLbl(r.week)),
      datasets:[{
        label:'Marge / vente (%)',
        data:rows.map(r=>+(r.avg_margin*100).toFixed(2)),
        borderColor:C.gold, backgroundColor:C.goldFill2,
        borderWidth:2, pointRadius:2, pointHoverRadius:5, tension:0.4, fill:true,
      }],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:C.tick,font:{size:8},maxTicksLimit:16,maxRotation:40},grid:{color:C.grid},border:{color:'transparent'}},
        y:{..._yScale(true), suggestedMin:0, suggestedMax:60},
      },
      plugins:{ legend:_legend(false), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` Marge: ${c.raw.toFixed(1)} %` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   7. Product Revenue (horizontal bar)
══════════════════════════════════════════════════════ */
function buildProductRevenueChart(id, products) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  const top=products.slice(0,10);
  _reg[id]=new Chart(ctx,{
    type:'bar',
    data:{
      labels:top.map(p=>p.product_name||'—'),
      datasets:[
        { label:'CA',    data:top.map(p=>p.total_revenue||0), backgroundColor:C.goldFill,  borderColor:C.gold,  borderWidth:1, borderRadius:3 },
        { label:'Profit',data:top.map(p=>p.total_profit||0),  backgroundColor:C.greenFill, borderColor:C.green, borderWidth:1, borderRadius:3 },
      ],
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:C.tick,font:{size:8},callback:v=>_da(v)},grid:{color:C.grid},border:{color:'transparent'}},
        y:{ticks:{color:C.tick,font:{size:8}},grid:{color:C.grid},border:{color:'transparent'}},
      },
      plugins:{ legend:_legend(true), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` ${c.dataset.label}: ${_da(c.raw)}` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   8. Client Revenue (horizontal bar)
══════════════════════════════════════════════════════ */
function buildClientRevenueChart(id, clients) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  const top=clients.slice(0,10);
  const cols=top.map((_,i)=>PALETTE[i%PALETTE.length].replace('1)','0.72)'));
  _reg[id]=new Chart(ctx,{
    type:'bar',
    data:{
      labels:top.map(c=>c.client_name||'Anonyme'),
      datasets:[{ label:'Total dépensé', data:top.map(c=>c.total_spent||0),
        backgroundColor:cols, borderColor:PALETTE.slice(0,top.length), borderWidth:1, borderRadius:3 }],
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:C.tick,font:{size:8},callback:v=>_da(v)},grid:{color:C.grid},border:{color:'transparent'}},
        y:{ticks:{color:C.tick,font:{size:8}},grid:{color:C.grid},border:{color:'transparent'}},
      },
      plugins:{ legend:_legend(false), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` ${_da(c.raw)}` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   9. Status Revenue Bar
══════════════════════════════════════════════════════ */
function buildStatusRevenueChart(id, rows) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  const LMAP={ OK:'OK', LOW_MARGIN_RISK:'Marge faible', OVERPRICE_RISK:'Prix élevé', LOSS:'Perte' };
  const CMAP={ OK:C.green, LOW_MARGIN_RISK:C.orange, OVERPRICE_RISK:C.blue, LOSS:C.danger };
  _reg[id]=new Chart(ctx,{
    type:'bar',
    data:{
      labels:rows.map(r=>LMAP[r.status]||r.status),
      datasets:[{ label:'Revenu', data:rows.map(r=>r.revenue||0),
        backgroundColor:rows.map(r=>(CMAP[r.status]||C.muted).replace('1)','0.72)')),
        borderColor:rows.map(r=>CMAP[r.status]||C.muted), borderWidth:1, borderRadius:4 }],
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      scales:{ x:_xScale(0), y:_yScale(false) },
      plugins:{ legend:_legend(false), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` ${_da(c.raw)}` } } },
    },
  });
}

/* ══════════════════════════════════════════════════════
   10. Product Margin Bar (horizontal)
══════════════════════════════════════════════════════ */
function buildProductMarginChart(id, products) {
  _destroy(id);
  const ctx=document.getElementById(id); if(!ctx) return;
  const top=products.slice(0,8);
  const data=top.map(p=>+(p.avg_margin*100).toFixed(1));
  const cols=data.map(v=> v>=35?C.green.replace('1)','0.78)'): v>=20?C.gold.replace('1)','0.78)'): v>=0?C.orange.replace('1)','0.78)'):C.danger.replace('1)','0.78)'));
  _reg[id]=new Chart(ctx,{
    type:'bar',
    data:{
      labels:top.map(p=>p.product_name||'—'),
      datasets:[{ label:'Marge / vente (%)', data,
        backgroundColor:cols, borderColor:cols.map(c=>c.replace('0.78)','1)')), borderWidth:1, borderRadius:3 }],
    },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ticks:{color:C.tick,font:{size:8},callback:v=>v+'%'},grid:{color:C.grid},border:{color:'transparent'},suggestedMin:0},
        y:{ticks:{color:C.tick,font:{size:8}},grid:{color:C.grid},border:{color:'transparent'}},
      },
      plugins:{ legend:_legend(false), tooltip:{ ..._tooltip(), callbacks:{ label:c=>` Marge: ${c.raw.toFixed(1)} %` } } },
    },
  });
}

/* ── Exports ─────────────────────────────────────────── */
window.DashCharts = {
  buildRevenueChart, buildRevenueDetailChart, buildStatusChart,
  buildCostBreakdownChart, buildProfitDistChart, buildMarginEvolutionChart,
  buildProductRevenueChart, buildClientRevenueChart,
  buildStatusRevenueChart, buildProductMarginChart,
  destroyAll: () => Object.keys(_reg).forEach(_destroy),
  _da, _pct,
};

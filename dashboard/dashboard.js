'use strict';
/**
 * dashboard/dashboard.js  (renderer-side)
 *
 * Orchestrates the dashboard:
 *   - section navigation
 *   - filter state management
 *   - single IPC call → stats:getDashboardData
 *   - KPI rendering, tables, chart delegation
 *   - CSV export
 */

/* ── State ────────────────────────────────────────────── */
let _data    = null;
let _filters = {};
let _section = 'overview';
let _toastTm = null;

/* ── Formatters ───────────────────────────────────────── */
function fmtDA(n) {
  if (n==null||isNaN(+n)) return '—';
  const v=+n;
  if (Math.abs(v)>=1e6) return (v/1e6).toFixed(2)+' M DA';
  if (Math.abs(v)>=1e3) return (v/1e3).toFixed(1)+' k DA';
  return v.toLocaleString('fr-DZ',{minimumFractionDigits:0,maximumFractionDigits:0})+' DA';
}
function fmtPct(f)  { return (+f*100).toFixed(1)+' %'; }
function fmtNum(n)  { return (+n||0).toLocaleString('fr-DZ'); }
function fmtDate(iso) {
  if(!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});
}
function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _q(sel) { return document.querySelector(sel); }

/* ── Toast ────────────────────────────────────────────── */
function toast(type, msg, dur) {
  const el=document.getElementById('toast'); if(!el) return;
  el.textContent=msg; el.className=`toast ${type} visible`;
  if(_toastTm) clearTimeout(_toastTm);
  _toastTm=setTimeout(()=>{ el.className='toast'; }, dur||(type==='error'?7000:4000));
}

/* ── Loading overlay ──────────────────────────────────── */
function setLoading(on) {
  document.getElementById('loadingOverlay').classList.toggle('visible',on);
}

/* ── Navigation ───────────────────────────────────────── */
function switchSection(name) {
  _section=name;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.section===name));
  document.querySelectorAll('.section').forEach(el=>el.classList.toggle('active',el.id==='sec-'+name));
  if(_data) _renderSection(name,_data);
}

/* ── Filter helpers ───────────────────────────────────── */
function _readFilters() {
  return {
    year:        _q('#fYear')?.value     ||'',
    month:       _q('#fMonth')?.value    ||'',
    date_from:   _q('#fDateFrom')?.value ||'',
    date_to:     _q('#fDateTo')?.value   ||'',
    client_name: _q('#fClient')?.value   ||'',
    status:      _q('#fStatus')?.value   ||'',
  };
}
function _resetFilters() {
  ['#fYear','#fMonth','#fDateFrom','#fDateTo','#fClient','#fStatus']
    .forEach(s=>{ const e=_q(s); if(e) e.value=''; });
}
function _populateFilterOptions(opts) {
  const ys=_q('#fYear');
  if(ys&&opts.years){
    const cur=ys.value;
    ys.innerHTML='<option value="">Toutes</option>'+
      opts.years.map(y=>`<option value="${y}"${y===cur?' selected':''}>${y}</option>`).join('');
  }
  const cs=_q('#fClient');
  if(cs&&opts.clients){
    const cur=cs.value;
    cs.innerHTML='<option value="">Tous</option>'+
      opts.clients.map(c=>`<option value="${_esc(c)}"${c===cur?' selected':''}>${_esc(c)}</option>`).join('');
  }
}

/* ── Data fetch ───────────────────────────────────────── */
async function loadData(filters) {
  setLoading(true);
  try {
    _data=await window.electronAPI.stats.getDashboardData(filters||{});
    _renderAll(_data);
  } catch(err) {
    console.error('[dashboard] loadData:',err);
    toast('error','Erreur chargement: '+err.message);
  } finally {
    setLoading(false);
  }
}

/* ── Master render ────────────────────────────────────── */
function _renderAll(d) {
  if(!d) return;
  _populateFilterOptions(d.filterOptions||{});
  _renderOverviewSub(d);
  _renderKpiGrid(d.kpi,'kpiGrid');
  _renderKpiStrip(d.kpi,'revenueKpi',[
    {label:'CA Total',      value:fmtDA(d.kpi.totalRevenue),   cls:'gold'},
    {label:'Coût Total',    value:fmtDA(d.kpi.totalCost),      cls:'orange'},
    {label:'Profit Total',  value:fmtDA(d.kpi.totalProfit),    cls:'green'},
    {label:'Ticket Moyen',  value:fmtDA(d.kpi.avgTicket),      cls:'purple'},
    {label:'CA Mensuel',    value:fmtDA(d.kpi.monthlyRevenue), cls:'blue'},
  ]);
  _renderKpiStrip(d.kpi,'marginsKpi',[
    {label:'Marge / Vente (moy.)', value:fmtPct(d.kpi.avgMarginOnPrice),          cls:'gold'},
    {label:'Marge / Coût (moy.)',  value:fmtPct(d.kpi.avgMarginOnCost),           cls:'green'},
    {label:'Devis OK',             value:fmtNum(d.kpi.statusBreakdown.ok||0),     cls:'green'},
    {label:'Marge Faible',         value:fmtNum(d.kpi.statusBreakdown.lowMargin||0),cls:'orange'},
    {label:'Pertes',               value:fmtNum(d.kpi.statusBreakdown.loss||0),   cls:'danger'},
  ]);
  _renderTopProductsTable(d.topProducts,'topProductsBody',5);
  _renderTopClientsTable(d.topClients,'topClientsBody',5);
  _renderAllProductsTable(d.topProducts);
  _renderAllClientsTable(d.topClients);
  _renderSection(_section,d);
}

function _renderSection(name,d) {
  const DC=window.DashCharts;
  if(!DC) return;
  switch(name) {
    case 'overview':
      DC.buildRevenueChart('chartRevenue',d.monthlyRevenue);
      DC.buildStatusChart('chartStatus',d.revenueByStatus);
      DC.buildCostBreakdownChart('chartCosts',d.avgCostBreakdown);
      break;
    case 'revenue':
      DC.buildRevenueDetailChart('chartRevenueDetail',d.monthlyRevenue);
      DC.buildProfitDistChart('chartProfitDist',d.profitDistribution);
      break;
    case 'products':
      DC.buildProductRevenueChart('chartProductRevenue',d.topProducts);
      break;
    case 'clients':
      DC.buildClientRevenueChart('chartClientRevenue',d.topClients);
      break;
    case 'margins':
      DC.buildMarginEvolutionChart('chartMarginEvolution',d.marginEvolution);
      DC.buildStatusRevenueChart('chartStatusRevenue',d.revenueByStatus);
      DC.buildProductMarginChart('chartProductMargin',d.topProducts);
      break;
  }
}

/* ── Overview subtitle ────────────────────────────────── */
function _renderOverviewSub(d) {
  const el=document.getElementById('overviewSub'); if(!el) return;
  const k=d.kpi;
  const period=(_filters.year?_filters.year+' ':'')+(_filters.month?'· M'+_filters.month+' ':'')||'Toutes périodes';
  el.textContent=`${period} · ${fmtNum(k.totalQuotes)} devis · ${fmtDA(k.totalRevenue)} CA total`;
}

/* ── KPI grid (overview) ──────────────────────────────── */
function _renderKpiGrid(k,id) {
  const el=document.getElementById(id); if(!el||!k) return;
  const cards=[
    {label:"Chiffre d'Affaires Total", value:fmtDA(k.totalRevenue),           sub:`${fmtNum(k.totalQuotes)} devis`,                cls:'gold',   icon:'💰'},
    {label:'Profit Total',             value:fmtDA(k.totalProfit),            sub:`Marge moy. ${fmtPct(k.avgMarginOnPrice)}`,     cls:'green',  icon:'📈'},
    {label:'CA du Mois',               value:fmtDA(k.monthlyRevenue),         sub:`${fmtNum(k.monthlyCount)} devis ce mois`,      cls:'blue',   icon:'📅'},
    {label:'Ticket Moyen',             value:fmtDA(k.avgTicket),              sub:`Min ${fmtDA(k.minPrice)} · Max ${fmtDA(k.maxPrice)}`, cls:'purple', icon:'🎫'},
    {label:'Marge Moy. / Vente',       value:fmtPct(k.avgMarginOnPrice),      sub:`Sur COGS: ${fmtPct(k.avgMarginOnCost)}`,       cls:'orange', icon:'📊'},
    {label:'Devis OK',                 value:fmtNum(k.statusBreakdown.ok||0), sub:`Marge faible: ${k.statusBreakdown.lowMargin||0}`,cls:'green',icon:'✓'},
    {label:'Pertes Détectées',         value:fmtNum(k.statusBreakdown.loss||0),sub:`Prix élevés: ${k.statusBreakdown.overprice||0}`,cls:'danger',icon:'⚠'},
  ];
  el.innerHTML=cards.map(c=>`
    <div class="kpi-card ${c.cls}">
      <div class="kpi-icon">${c.icon}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');
}

/* ── KPI strip (revenue / margins sections) ───────────── */
function _renderKpiStrip(_k,id,cards) {
  const el=document.getElementById(id); if(!el) return;
  el.innerHTML=cards.map(c=>`
    <div class="kpi-card ${c.cls}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
    </div>`).join('');
}

/* ── Empty state ──────────────────────────────────────── */
function _emptyState(title,sub) {
  return `<div class="empty-state">
    <div class="empty-state-icon">📭</div>
    <div class="empty-state-title">${title}</div>
    <div class="empty-state-sub">${sub}</div>
  </div>`;
}

/* ── Top 5 products mini-table ────────────────────────── */
function _renderTopProductsTable(products,containerId,limit) {
  const el=document.getElementById(containerId); if(!el) return;
  const ce=document.getElementById('topProductsCount'); if(ce) ce.textContent=(products||[]).length+' produits';
  const rows=(products||[]).slice(0,limit||5);
  if(!rows.length){el.innerHTML=_emptyState('Aucun produit','Calculez des devis pour voir les données');return;}
  el.innerHTML=`<table><thead><tr>
    <th></th><th>Produit</th><th class="right">CA</th><th class="right">Marge</th>
  </tr></thead><tbody>${rows.map((p,i)=>`<tr>
    <td class="td-rank ${i<3?['top1','top2','top3'][i]:''}">${i+1}</td>
    <td class="td-primary"><span title="${_esc(p.product_name||'')}">${_esc(p.product_name||'—')}</span>
      <small class="td-muted"> ${fmtNum(p.quote_count)} devis</small></td>
    <td class="td-gold right">${fmtDA(p.total_revenue)}</td>
    <td class="right ${+p.avg_margin>=0.25?'td-green':'td-muted'}">${fmtPct(p.avg_margin)}</td>
  </tr>`).join('')}</tbody></table>`;
}

/* ── Top 5 clients mini-table ─────────────────────────── */
function _renderTopClientsTable(clients,containerId,limit) {
  const el=document.getElementById(containerId); if(!el) return;
  const ce=document.getElementById('topClientsCount'); if(ce) ce.textContent=(clients||[]).length+' clients';
  const rows=(clients||[]).slice(0,limit||5);
  if(!rows.length){el.innerHTML=_emptyState('Aucun client','Les clients nommés apparaissent ici');return;}
  el.innerHTML=`<table><thead><tr>
    <th></th><th>Client</th><th class="right">Dépensé</th><th class="right">Projets</th>
  </tr></thead><tbody>${rows.map((c,i)=>`<tr>
    <td class="td-rank ${i<3?['top1','top2','top3'][i]:''}">${i+1}</td>
    <td class="td-primary"><span title="${_esc(c.client_name||'')}">${_esc(c.client_name||'—')}</span>
      <small class="td-muted"> ${fmtDate(c.last_project_at)}</small></td>
    <td class="td-gold right">${fmtDA(c.total_spent)}</td>
    <td class="right td-muted">${fmtNum(c.project_count)}</td>
  </tr>`).join('')}</tbody></table>`;
}

/* ── Full products table ──────────────────────────────── */
function _renderAllProductsTable(products) {
  const el=document.getElementById('allProductsBody'); if(!el) return;
  const ce=document.getElementById('allProductsCount'); if(ce) ce.textContent=(products||[]).length+' produits';
  if(!(products||[]).length){el.innerHTML=_emptyState('Aucun produit','Calculez des devis pour voir les données');return;}
  el.innerHTML=`<table><thead><tr>
    <th></th><th>Produit</th>
    <th class="right">Devis</th><th class="right">CA Total</th>
    <th class="right">Profit</th><th class="right">Prix Moy.</th>
    <th class="right">Marge/Vente</th>
  </tr></thead><tbody>${products.map((p,i)=>`<tr>
    <td class="td-rank ${i<3?['top1','top2','top3'][i]:''}">${i+1}</td>
    <td class="td-primary"><span title="${_esc(p.product_name||'')}">${_esc(p.product_name||'—')}</span></td>
    <td class="right td-muted">${fmtNum(p.quote_count)}</td>
    <td class="td-gold right">${fmtDA(p.total_revenue)}</td>
    <td class="td-green right">${fmtDA(p.total_profit)}</td>
    <td class="right td-muted">${fmtDA(p.avg_price)}</td>
    <td class="right ${+p.avg_margin>=0.25?'td-green':''}">${fmtPct(p.avg_margin)}</td>
  </tr>`).join('')}</tbody></table>`;
}

/* ── Full clients table ───────────────────────────────── */
function _renderAllClientsTable(clients) {
  const el=document.getElementById('allClientsBody'); if(!el) return;
  const ce=document.getElementById('allClientsCount'); if(ce) ce.textContent=(clients||[]).length+' clients';
  if(!(clients||[]).length){el.innerHTML=_emptyState('Aucun client nommé','Les clients avec un nom apparaissent ici');return;}
  el.innerHTML=`<table><thead><tr>
    <th></th><th>Client</th>
    <th class="right">Projets</th><th class="right">Total Dépensé</th>
    <th class="right">Profit</th><th class="right">Marge Moy.</th>
    <th class="right">Dernier Projet</th>
  </tr></thead><tbody>${clients.map((c,i)=>`<tr>
    <td class="td-rank ${i<3?['top1','top2','top3'][i]:''}">${i+1}</td>
    <td class="td-primary"><span title="${_esc(c.client_name||'')}">${_esc(c.client_name||'—')}</span></td>
    <td class="right td-muted">${fmtNum(c.project_count)}</td>
    <td class="td-gold right">${fmtDA(c.total_spent)}</td>
    <td class="td-green right">${fmtDA(c.total_profit)}</td>
    <td class="right ${+c.avg_margin>=0.25?'td-green':''}">${fmtPct(c.avg_margin)}</td>
    <td class="right td-muted">${fmtDate(c.last_project_at)}</td>
  </tr>`).join('')}</tbody></table>`;
}

/* ══════════════════════════════════════════════════════
   CSV EXPORT
══════════════════════════════════════════════════════ */
function exportCsv() {
  if(!_data){toast('error','Chargez les données avant d\'exporter.');return;}
  const esc=v=>{
    if(v==null) return '';
    const s=String(v);
    return s.includes(',')||s.includes('"')||s.includes('\n') ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  const k=_data.kpi;
  const lines=[
    'INDICATEURS CLES','Metrique,Valeur',
    ['CA Total',k.totalRevenue].map(esc).join(','),
    ['Profit Total',k.totalProfit].map(esc).join(','),
    ['Cout Total',k.totalCost].map(esc).join(','),
    ['Nombre de devis',k.totalQuotes].map(esc).join(','),
    ['Ticket Moyen',(+k.avgTicket).toFixed(2)].map(esc).join(','),
    ['Marge Moy Vente (%)',(k.avgMarginOnPrice*100).toFixed(2)].map(esc).join(','),
    ['CA Mensuel',k.monthlyRevenue].map(esc).join(','),
    '',
    'CA MENSUEL','Mois,CA,Profit,Cout,Devis,Marge moy (%)',
    ...(_data.monthlyRevenue||[]).map(r=>[r.month,r.revenue,r.profit,r.cost,r.count,(r.avg_margin*100).toFixed(2)].map(esc).join(',')),
    '',
    'PRODUITS','Produit,Devis,CA Total,Profit,Prix moyen,Marge (%)',
    ...(_data.topProducts||[]).map(p=>[p.product_name,p.quote_count,p.total_revenue,p.total_profit,(+p.avg_price).toFixed(2),(p.avg_margin*100).toFixed(2)].map(esc).join(',')),
    '',
    'CLIENTS','Client,Projets,Total depense,Profit,Marge (%),Dernier projet',
    ...(_data.topClients||[]).map(c=>[c.client_name,c.project_count,c.total_spent,c.total_profit,(c.avg_margin*100).toFixed(2),c.last_project_at?c.last_project_at.slice(0,10):''].map(esc).join(',')),
  ];
  const csv='\uFEFF'+lines.join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const now=new Date();
  const stamp=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  a.href=url; a.download=`studio-mobilier-stats-${stamp}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('success','Export CSV téléchargé');
}

/* ══════════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Version
  if(window.electronAPI?.getVersion) {
    window.electronAPI.getVersion()
      .then(v=>{ const el=document.getElementById('sidebarVersion'); if(el) el.textContent='v'+v; })
      .catch(()=>{});
  }

  // Nav
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',()=>switchSection(item.dataset.section));
  });

  // Topbar
  document.getElementById('btnBackToApp').addEventListener('click',()=>{ window.location.href='../index.html'; });
  document.getElementById('btnRefresh').addEventListener('click',()=>{ _filters=_readFilters(); loadData(_filters); });
  document.getElementById('btnExportCsv').addEventListener('click',exportCsv);

  // Filters
  document.getElementById('btnApplyFilter').addEventListener('click',()=>{ _filters=_readFilters(); loadData(_filters); });
  document.getElementById('btnResetFilter').addEventListener('click',()=>{ _resetFilters(); _filters={}; loadData(_filters); });

  // Initial load
  await loadData({});
});

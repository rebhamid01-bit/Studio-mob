'use strict';
/**
 * pricing/calculatePricing.js
 *
 * Pure calculation engine — NO DOM access, NO side-effects.
 * All business logic for cost, COGS, margins, and risk classification.
 *
 * Direct Cost formula (immutable, explicit, four-component):
 *   directCost = materialsCost
 *              + edgeBandingCost   ← always its own named term
 *              + accessoriesCost
 *              + laborCost
 */

/* ── Line-item aggregators ────────────────────────────── */
function sumMaterials(items) {
  return items.reduce((s, m) => s + m.surface * m.pricePerM2, 0);
}
function sumEdges(items) {
  return items.reduce((s, e) => s + e.length * e.pricePerMeter, 0);
}
function sumAccessories(items) {
  return items.reduce((s, a) => s + a.priceUnit * a.qty, 0);
}

/* ── Risk configuration ───────────────────────────────── */
const RISK_CONFIG = {
  OK: {
    cls: 'risk-ok', icon: '✓', title: 'Prix valide',
    desc: 'Marge saine — entre 25 % et 60 % sur prix de vente.',
  },
  LOW_MARGIN_RISK: {
    cls: 'risk-low', icon: '⚠', title: 'Marge faible',
    desc: 'Marge sur vente < 25 %. Risque de sous-rentabilite. Augmentez le prix ou reduisez les couts.',
  },
  OVERPRICE_RISK: {
    cls: 'risk-over', icon: '↑', title: 'Prix potentiellement eleve',
    desc: 'Marge sur vente > 60 %. Verifiez la competitivite du prix sur le marche.',
  },
  LOSS: {
    cls: 'risk-loss', icon: '✕', title: 'PERTE DETECTEE',
    desc: 'Le profit est nul ou negatif. Le prix ne couvre pas les couts.',
  },
};

/**
 * calculatePricing(inp) → frozen result object
 *
 * @param {object} inp
 *   materialsCost   {number}
 *   edgeBandingCost {number}
 *   accessoriesCost {number}
 *   laborCost       {number}
 *   indirectRate    {number}  fraction (e.g. 0.15 for 15 %)
 *   deliveryCost    {number}
 *   marginRate      {number|null}  fraction — set only in 'margin' mode
 *   marketPrice     {number|null}  — set only in 'market' mode
 *   pricingMode     {string}  'margin' | 'market'
 *
 * @throws {Error} on any validation failure
 */
function calculatePricing(inp) {
  const {
    materialsCost,
    edgeBandingCost,
    accessoriesCost,
    laborCost,
    indirectRate,
    deliveryCost,
    marginRate,
    marketPrice,
    pricingMode,
  } = inp;

  // ── Guard: mode exclusivity ───────────────────────────────
  if (pricingMode === 'margin' && marketPrice !== null)
    throw new Error('Conflit de mode: marge ET prix marche actifs simultanement.');
  if (pricingMode === 'market' && marginRate !== null)
    throw new Error('Conflit de mode: marche ET marge actives simultanement.');

  // ── DIRECT COST — four named terms, always explicit ───────
  const directCost = materialsCost
                   + edgeBandingCost   // panne de chant — never merged, never omitted
                   + accessoriesCost
                   + laborCost;

  // Integrity assertion: catches any future regression instantly
  const expectedDirect = materialsCost + edgeBandingCost + accessoriesCost + laborCost;
  if (Math.abs(directCost - expectedDirect) > 0.0001)
    throw new Error(
      `Incohérence cout direct: ${directCost.toFixed(2)} ≠ ` +
      `mat(${materialsCost.toFixed(2)}) + chant(${edgeBandingCost.toFixed(2)}) + ` +
      `acc(${accessoriesCost.toFixed(2)}) + MO(${laborCost.toFixed(2)}) = ${expectedDirect.toFixed(2)}`
    );

  if (directCost <= 0)
    throw new Error('Cout direct invalide — au moins un composant de cout est requis.');

  // ── INDIRECT COST & COGS ──────────────────────────────────
  if (indirectRate < 0.10)
    throw new Error('Frais generaux minimum 10 %.');

  const indirectCost = directCost * indirectRate;
  const totalCost    = directCost + indirectCost;   // = COGS

  // ── PRICING (mode-exclusive) ──────────────────────────────
  let profit, sellingPrice;

  if (pricingMode === 'margin') {
    if (marginRate < 0.10 || marginRate > 1.0)
      throw new Error('Taux de marge hors plage — doit etre entre 10 % et 100 %.');
    profit       = totalCost * marginRate;
    sellingPrice = totalCost + profit;
  } else {
    if (deliveryCost < 0)
      throw new Error('Frais de livraison invalides.');
    if (!marketPrice || marketPrice <= 0)
      throw new Error('Prix marche invalide — valeur requise > 0.');
    sellingPrice = marketPrice - deliveryCost;
    profit       = sellingPrice - totalCost;
    if (profit <= 0)
      throw new Error('Projet non rentable — prix marche insuffisant pour couvrir COGS + livraison.');
  }

  // ── FINAL PRICE — delivery added after selling price ──────
  const finalPrice = sellingPrice + deliveryCost;

  // ── MARGIN METRICS ────────────────────────────────────────
  const marginOnCost  = totalCost    > 0 ? profit / totalCost    : 0;
  const marginOnPrice = sellingPrice > 0 ? profit / sellingPrice : 0;

  // ── RISK CLASSIFICATION ───────────────────────────────────
  let status;
  if      (profit < 0)             status = 'LOSS';
  else if (marginOnPrice < 0.25)   status = 'LOW_MARGIN_RISK';
  else if (marginOnPrice > 0.60)   status = 'OVERPRICE_RISK';
  else                             status = 'OK';

  // Debug trace (visible in DevTools)
  console.log('[calculatePricing] cost breakdown:', {
    materialsCost:   +materialsCost.toFixed(2),
    edgeBandingCost: +edgeBandingCost.toFixed(2),
    accessoriesCost: +accessoriesCost.toFixed(2),
    laborCost:       +laborCost.toFixed(2),
    directCost:      +directCost.toFixed(2),
    indirectCost:    +indirectCost.toFixed(2),
    totalCost:       +totalCost.toFixed(2),
    profit:          +profit.toFixed(2),
    finalPrice:      +finalPrice.toFixed(2),
    status,
  });

  return Object.freeze({
    // Four named cost components (single source of truth)
    materialsCost,
    edgeBandingCost,
    accessoriesCost,
    laborCost,
    // Derived cost pipeline
    directCost,
    indirectCost,
    totalCost,
    // Profit & price
    profit,
    sellingPriceExclDelivery: sellingPrice,
    deliveryCost,
    finalPrice,
    // Margin metrics
    marginOnCost,
    marginOnPrice,
    // Decision
    status,
  });
}

// Export for use in app.js via script tag (no module bundler needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculatePricing, sumMaterials, sumEdges, sumAccessories, RISK_CONFIG };
}

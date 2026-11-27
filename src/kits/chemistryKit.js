/**
 * Captnz Board — Quick Chemistry Classroom Toolkit (100% Offline)
 * - Quick Formula & Equation formatter (subscripts, superscripts, reaction arrows)
 * - 1-tap Reaction Condition Stamps (Δ, hν, cat., H+ / H2O, conc. H2SO4, NaOH)
 * - VSEPR Molecular Geometry & Orbital Vector Stencils
 */

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Tokenizes plain ASCII chemistry input like:
 *   "H2SO4", "Fe3+", "SO4^2-", "CH3COOH <-> CH3COO- + H+", "2H2 + O2 -> 2H2O"
 * into typed segments: normal | sub | sup | arrow.
 */
export function parseChemistryFormula(raw) {
  const input = (raw || '').trim();
  if (!input) return [];

  // Normalize arrows first with space padding
  const normalized = input
    .replace(/<-->/g, ' ↔ ')
    .replace(/<=>|<->/g, ' ⇌ ')
    .replace(/->/g, ' → ');

  const tokens = normalized.split(/(\s+)/);
  const runs = [];

  for (const tok of tokens) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      runs.push({ kind: 'normal', text: ' ' });
      continue;
    }
    if (tok === '→' || tok === '⇌' || tok === '↔') {
      runs.push({ kind: 'arrow', text: tok });
      continue;
    }

    // Parse single chemical formula / ion token
    let i = 0;
    // Leading stoichiometric coefficient (e.g. 2H2O -> leading "2" is normal)
    const leadMatch = tok.match(/^(\d+)(?=[A-Za-z(\[])/);
    if (leadMatch) {
      runs.push({ kind: 'normal', text: leadMatch[1] });
      i = leadMatch[1].length;
    }

    while (i < tok.length) {
      const ch = tok[i];

      // Explicit caret superscript: e.g. ^2- or ^3+ or ^2
      if (ch === '^') {
        const rest = tok.slice(i + 1);
        const supM = rest.match(/^([0-9]*[+-]|[+-]|[0-9]+)/);
        if (supM) {
          runs.push({ kind: 'sup', text: supM[1] });
          i += 1 + supM[1].length;
          continue;
        }
      }

      // Digits followed immediately by + or - at end of token -> charge superscript (e.g. Fe3+, Ca2+)
      const rest = tok.slice(i);
      const chargeDigitsM = rest.match(/^(\d+[+-])$/);
      if (chargeDigitsM && i > 0) {
        runs.push({ kind: 'sup', text: chargeDigitsM[1] });
        i += chargeDigitsM[1].length;
        continue;
      }

      // Trailing single + or - on an ion (e.g. H+, OH-, CH3COO-) when preceded by letter/digit/paren
      if ((ch === '+' || ch === '-') && i === tok.length - 1 && i > 0 && /[A-Za-z0-9)\]]/.test(tok[i - 1])) {
        runs.push({ kind: 'sup', text: ch });
        i += 1;
        continue;
      }

      // Subscript digits after element symbol or closing bracket (e.g. H2O, (NH4)2SO4)
      if (/\d/.test(ch) && i > 0 && /[A-Za-z)\]]/.test(tok[i - 1])) {
        const subM = rest.match(/^(\d+)/);
        if (subM) {
          runs.push({ kind: 'sub', text: subM[1] });
          i += subM[1].length;
          continue;
        }
      }

      runs.push({ kind: 'normal', text: ch });
      i += 1;
    }
  }

  // Merge adjacent runs of the same kind for clean rendering
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.kind === r.kind) {
      last.text += r.text;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

export function formatChemistryHtml(raw) {
  const runs = parseChemistryFormula(raw);
  return runs
    .map((r) => {
      const safe = escapeXml(r.text);
      if (r.kind === 'sub') return `<sub>${safe}</sub>`;
      if (r.kind === 'sup') return `<sup>${safe}</sup>`;
      return safe;
    })
    .join('');
}

export function buildChemistryFormulaSvg(raw, color = '#111827', isDarkBg = false) {
  const runs = parseChemistryFormula(raw);
  if (!runs.length) return null;

  // Estimate width from character lengths
  let charUnits = 0;
  for (const r of runs) {
    const scale = r.kind === 'normal' || r.kind === 'arrow' ? 1 : 0.72;
    charUnits += r.text.length * scale;
  }
  const w = Math.max(120, Math.round(charUnits * 17 + 36));
  const h = 64;

  // Build explicit baseline-reset tspans so SVG-to-Image exports render identically everywhere
  let currentOffset = 0;
  const tspans = [];
  for (const r of runs) {
    const safe = escapeXml(r.text);
    const targetOffset = r.kind === 'sub' ? 7 : r.kind === 'sup' ? -9 : 0;
    const dy = targetOffset - currentOffset;
    currentOffset = targetOffset;
    const size = r.kind === 'sub' || r.kind === 'sup' ? 18 : 26;
    const dyAttr = dy !== 0 ? ` dy="${dy}"` : '';
    tspans.push(`<tspan${dyAttr} font-size="${size}">${safe}</tspan>`);
  }

  const pillFill = isDarkBg ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.86)';
  const pillStroke = isDarkBg ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 23, 42, 0.14)';

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="10" fill="${pillFill}" stroke="${pillStroke}" stroke-width="1.5"/>
  <text x="${w / 2}" y="40" text-anchor="middle" font-family="Segoe UI, Noto Sans, sans-serif" font-weight="700" fill="${color}">${tspans.join('')}</text>
</svg>`;

  return { svgMarkup, w, h };
}

export const REACTION_CONDITIONS = [
  { id: 'cond-delta', label: 'Δ', ascii: 'Δ' },
  { id: 'cond-hv', label: 'hν', ascii: 'hν' },
  { id: 'cond-cat', label: 'cat.', ascii: 'cat.' },
  { id: 'cond-acid-water', label: 'H⁺ / H₂O', ascii: 'H+ / H2O' },
  { id: 'cond-h2so4', label: 'conc. H₂SO₄', ascii: 'conc. H2SO4' },
  { id: 'cond-naoh', label: 'NaOH', ascii: 'NaOH' },
];

function wrapSvg(viewBox, w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" fill="none">${body}</svg>`;
}

export const VSEPR_ORBITAL_STENCILS = [
  {
    id: 'vsepr-linear',
    label: 'Linear 180°',
    w: 180,
    h: 76,
    build: (c) =>
      wrapSvg(
        '0 0 180 76',
        180,
        76,
        `<line x1="34" y1="38" x2="146" y2="38" stroke="${c}" stroke-width="3"/>
         <circle cx="90" cy="38" r="10" fill="${c}"/>
         <circle cx="30" cy="38" r="7" stroke="${c}" stroke-width="2.6" fill="none"/>
         <circle cx="150" cy="38" r="7" stroke="${c}" stroke-width="2.6" fill="none"/>
         <text x="90" y="68" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" fill="${c}">180°</text>`
      ),
  },
  {
    id: 'vsepr-trigonal',
    label: 'Trigonal 120°',
    w: 160,
    h: 150,
    build: (c) =>
      wrapSvg(
        '0 0 160 150',
        160,
        150,
        `<line x1="80" y1="78" x2="80" y2="24" stroke="${c}" stroke-width="2.8"/>
         <line x1="80" y1="78" x2="32" y2="112" stroke="${c}" stroke-width="2.8"/>
         <line x1="80" y1="78" x2="128" y2="112" stroke="${c}" stroke-width="2.8"/>
         <circle cx="80" cy="78" r="10" fill="${c}"/>
         <circle cx="80" cy="20" r="7" stroke="${c}" stroke-width="2.4"/>
         <circle cx="28" cy="116" r="7" stroke="${c}" stroke-width="2.4"/>
         <circle cx="132" cy="116" r="7" stroke="${c}" stroke-width="2.4"/>
         <text x="80" y="142" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" fill="${c}">120°</text>`
      ),
  },
  {
    id: 'vsepr-tetrahedral',
    label: 'Tetrahedral',
    w: 170,
    h: 160,
    build: (c) =>
      wrapSvg(
        '0 0 170 160',
        170,
        160,
        `<line x1="85" y1="76" x2="85" y2="22" stroke="${c}" stroke-width="2.8"/>
         <line x1="85" y1="76" x2="32" y2="108" stroke="${c}" stroke-width="2.8"/>
         <polygon points="85,76 138,104 128,118" fill="${c}"/>
         <line x1="85" y1="76" x2="112" y2="132" stroke="${c}" stroke-width="2.4" stroke-dasharray="4 4"/>
         <circle cx="85" cy="76" r="10" fill="${c}"/>
         <circle cx="85" cy="18" r="6.5" stroke="${c}" stroke-width="2.4"/>
         <circle cx="28" cy="112" r="6.5" stroke="${c}" stroke-width="2.4"/>
         <text x="85" y="152" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" fill="${c}">109.5°</text>`
      ),
  },
  {
    id: 'vsepr-octahedral',
    label: 'Octahedral',
    w: 170,
    h: 170,
    build: (c) =>
      wrapSvg(
        '0 0 170 170',
        170,
        170,
        `<line x1="85" y1="22" x2="85" y2="144" stroke="${c}" stroke-width="2.6"/>
         <line x1="34" y1="62" x2="136" y2="104" stroke="${c}" stroke-width="2.6"/>
         <line x1="136" y1="62" x2="34" y2="104" stroke="${c}" stroke-width="2.6"/>
         <polygon points="85,22 34,62 136,62" stroke="${c}" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.45"/>
         <circle cx="85" cy="83" r="10" fill="${c}"/>
         <text x="85" y="164" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" fill="${c}">90°</text>`
      ),
  },
  {
    id: 'orbital-s',
    label: 's Orbital',
    w: 120,
    h: 120,
    build: (c) =>
      wrapSvg(
        '0 0 120 120',
        120,
        120,
        `<line x1="14" y1="60" x2="106" y2="60" stroke="${c}" stroke-width="1.3" opacity="0.45"/>
         <line x1="60" y1="14" x2="60" y2="106" stroke="${c}" stroke-width="1.3" opacity="0.45"/>
         <circle cx="60" cy="60" r="32" stroke="${c}" stroke-width="2.8" fill="${c}" fill-opacity="0.14"/>`
      ),
  },
  {
    id: 'orbital-p',
    label: 'p Orbital',
    w: 140,
    h: 110,
    build: (c) =>
      wrapSvg(
        '0 0 140 110',
        140,
        110,
        `<line x1="12" y1="55" x2="128" y2="55" stroke="${c}" stroke-width="1.3" opacity="0.45"/>
         <line x1="70" y1="12" x2="70" y2="98" stroke="${c}" stroke-width="1.3" opacity="0.45"/>
         <path d="M 70 55 C 46 25, 18 28, 18 55 C 18 82, 46 85, 70 55 Z" stroke="${c}" stroke-width="2.6" fill="${c}" fill-opacity="0.24"/>
         <path d="M 70 55 C 94 25, 122 28, 122 55 C 122 82, 94 85, 70 55 Z" stroke="${c}" stroke-width="2.6" fill="none"/>`
      ),
  },
  {
    id: 'orbital-d',
    label: 'd Orbital',
    w: 130,
    h: 130,
    build: (c) =>
      wrapSvg(
        '0 0 130 130',
        130,
        130,
        `<line x1="12" y1="65" x2="118" y2="65" stroke="${c}" stroke-width="1.2" opacity="0.4"/>
         <line x1="65" y1="12" x2="65" y2="118" stroke="${c}" stroke-width="1.2" opacity="0.4"/>
         <path d="M 65 65 C 40 20, 18 32, 32 52 C 42 64, 56 64, 65 65 Z" stroke="${c}" stroke-width="2.3" fill="${c}" fill-opacity="0.22"/>
         <path d="M 65 65 C 90 110, 112 98, 98 78 C 88 66, 74 66, 65 65 Z" stroke="${c}" stroke-width="2.3" fill="${c}" fill-opacity="0.22"/>
         <path d="M 65 65 C 90 20, 112 32, 98 52 C 88 64, 74 64, 65 65 Z" stroke="${c}" stroke-width="2.3" fill="none"/>
         <path d="M 65 65 C 40 110, 18 98, 32 78 C 42 66, 56 66, 65 65 Z" stroke="${c}" stroke-width="2.3" fill="none"/>`
      ),
  },
];

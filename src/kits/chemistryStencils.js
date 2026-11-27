/**
 * Captnz Board — Offline Vector Stencils (Chemistry Rings, Bonds, Arrows, Lab Apparatus & Coordinate Axes)
 * Pure vector SVG builders that render razor-sharp at any 4K zoom level and export cleanly to PDF.
 */

function wrapSvg(viewBox, w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" fill="none">${body}</svg>`;
}

export const CHEMISTRY_ORGANIC_STENCILS = [
  {
    id: 'benzene-kekule',
    label: 'Benzene (Kekulé)',
    w: 150,
    h: 150,
    build: (c) =>
      wrapSvg(
        '0 0 120 120',
        150,
        150,
        `<polygon points="60,12 102,36 102,84 60,108 18,84 18,36" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>
         <line x1="60" y1="22" x2="93" y2="41" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>
         <line x1="93" y1="79" x2="60" y2="98" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>
         <line x1="27" y1="41" x2="27" y2="79" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`
      ),
  },
  {
    id: 'benzene-ring',
    label: 'Benzene (Ring)',
    w: 150,
    h: 150,
    build: (c) =>
      wrapSvg(
        '0 0 120 120',
        150,
        150,
        `<polygon points="60,12 102,36 102,84 60,108 18,84 18,36" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>
         <circle cx="60" cy="60" r="24" stroke="${c}" stroke-width="2.8"/>`
      ),
  },
  {
    id: 'cyclohexane',
    label: 'Cyclohexane',
    w: 150,
    h: 150,
    build: (c) =>
      wrapSvg(
        '0 0 120 120',
        150,
        150,
        `<polygon points="60,12 102,36 102,84 60,108 18,84 18,36" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'chair',
    label: 'Chair Conf.',
    w: 170,
    h: 120,
    build: (c) =>
      wrapSvg(
        '0 0 140 100',
        170,
        120,
        `<polyline points="14,64 48,38 92,46 126,28 96,62 52,54 14,64" stroke="${c}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`
      ),
  },
  {
    id: 'boat',
    label: 'Boat Conf.',
    w: 170,
    h: 120,
    build: (c) =>
      wrapSvg(
        '0 0 140 100',
        170,
        120,
        `<polyline points="14,34 42,68 98,68 126,34 90,50 50,50 14,34" stroke="${c}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`
      ),
  },
  {
    id: 'cyclopentane',
    label: 'Cyclopentane',
    w: 140,
    h: 140,
    build: (c) =>
      wrapSvg(
        '0 0 120 120',
        140,
        140,
        `<polygon points="60,14 104,46 87,98 33,98 16,46" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'cyclobutane',
    label: 'Cyclobutane',
    w: 130,
    h: 130,
    build: (c) =>
      wrapSvg(
        '0 0 120 120',
        130,
        130,
        `<rect x="22" y="22" width="76" height="76" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'cyclopropane',
    label: 'Cyclopropane',
    w: 130,
    h: 120,
    build: (c) =>
      wrapSvg(
        '0 0 120 110',
        130,
        120,
        `<polygon points="60,16 102,90 18,90" stroke="${c}" stroke-width="3.2" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'wedge-bond',
    label: 'Wedge Bond',
    w: 140,
    h: 70,
    build: (c) =>
      wrapSvg(
        '0 0 140 70',
        140,
        70,
        `<polygon points="16,35 120,18 120,52" fill="${c}"/>`
      ),
  },
  {
    id: 'dash-bond',
    label: 'Dash Bond',
    w: 140,
    h: 70,
    build: (c) =>
      wrapSvg(
        '0 0 140 70',
        140,
        70,
        `<line x1="18" y1="33" x2="18" y2="37" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
         <line x1="36" y1="30" x2="36" y2="40" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
         <line x1="54" y1="27" x2="54" y2="43" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
         <line x1="72" y1="24" x2="72" y2="46" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
         <line x1="90" y1="21" x2="90" y2="49" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
         <line x1="108" y1="18" x2="108" y2="52" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`
      ),
  },
  {
    id: 'zigzag-chain',
    label: 'Carbon Chain',
    w: 220,
    h: 90,
    build: (c) =>
      wrapSvg(
        '0 0 220 90',
        220,
        90,
        `<polyline points="14,62 54,26 94,62 134,26 174,62 208,28" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
  },
];

export const CHEMISTRY_ARROW_STENCILS = [
  {
    id: 'arrow-forward',
    label: 'Forward (→)',
    w: 180,
    h: 64,
    build: (c) =>
      wrapSvg(
        '0 0 180 64',
        180,
        64,
        `<line x1="14" y1="32" x2="160" y2="32" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>
         <polyline points="144,18 162,32 144,46" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'arrow-equilibrium',
    label: 'Equilibrium (⇌)',
    w: 180,
    h: 68,
    build: (c) =>
      wrapSvg(
        '0 0 180 68',
        180,
        68,
        `<polyline points="16,26 162,26 144,14" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
         <polyline points="162,42 16,42 34,54" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'arrow-resonance',
    label: 'Resonance (↔)',
    w: 180,
    h: 64,
    build: (c) =>
      wrapSvg(
        '0 0 180 64',
        180,
        64,
        `<line x1="20" y1="32" x2="160" y2="32" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
         <polyline points="34,18 16,32 34,46" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
         <polyline points="146,18 164,32 146,46" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'arrow-curly',
    label: 'e⁻ Push (↷)',
    w: 150,
    h: 110,
    build: (c) =>
      wrapSvg(
        '0 0 150 110',
        150,
        110,
        `<path d="M 22 86 C 32 22, 110 20, 126 72" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
         <polyline points="110,64 127,76 135,57" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
  },
];

export const LAB_APPARATUS_STENCILS = [
  {
    id: 'beaker',
    label: 'Beaker',
    w: 150,
    h: 180,
    build: (c) =>
      wrapSvg(
        '0 0 150 180',
        150,
        180,
        `<path d="M 24 24 L 34 32 L 34 148 Q 34 160 46 160 L 108 160 Q 120 160 120 148 L 120 24" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
         <line x1="34" y1="24" x2="124" y2="24" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>
         <line x1="48" y1="62" x2="68" y2="62" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
         <line x1="48" y1="88" x2="62" y2="88" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
         <line x1="48" y1="114" x2="68" y2="114" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
         <line x1="48" y1="140" x2="62" y2="140" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`
      ),
  },
  {
    id: 'conical-flask',
    label: 'Conical Flask',
    w: 160,
    h: 190,
    build: (c) =>
      wrapSvg(
        '0 0 160 190',
        160,
        190,
        `<path d="M 60 20 L 100 20 M 64 20 L 64 68 L 24 152 Q 20 164 34 164 L 126 164 Q 140 164 136 152 L 96 68 L 96 20" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
         <line x1="44" y1="126" x2="116" y2="126" stroke="${c}" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>`
      ),
  },
  {
    id: 'round-flask',
    label: 'Round Flask',
    w: 150,
    h: 190,
    build: (c) =>
      wrapSvg(
        '0 0 150 190',
        150,
        190,
        `<line x1="56" y1="20" x2="94" y2="20" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
         <path d="M 62 20 L 62 72 A 48 48 0 1 0 88 72 L 88 20" stroke="${c}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'test-tube',
    label: 'Test Tube',
    w: 90,
    h: 200,
    build: (c) =>
      wrapSvg(
        '0 0 90 200',
        90,
        200,
        `<line x1="22" y1="22" x2="68" y2="22" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
         <path d="M 27 22 L 27 154 A 18 18 0 0 0 63 154 L 63 22" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
         <line x1="34" y1="96" x2="56" y2="96" stroke="${c}" stroke-width="2" stroke-dasharray="4 4"/>`
      ),
  },
  {
    id: 'burette',
    label: 'Burette',
    w: 96,
    h: 240,
    build: (c) =>
      wrapSvg(
        '0 0 96 240',
        96,
        240,
        `<line x1="32" y1="18" x2="64" y2="18" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
         <rect x="38" y="18" width="20" height="156" stroke="${c}" stroke-width="3"/>
         <line x1="38" y1="48" x2="48" y2="48" stroke="${c}" stroke-width="2"/>
         <line x1="38" y1="74" x2="52" y2="74" stroke="${c}" stroke-width="2"/>
         <line x1="38" y1="100" x2="48" y2="100" stroke="${c}" stroke-width="2"/>
         <line x1="38" y1="126" x2="52" y2="126" stroke="${c}" stroke-width="2"/>
         <line x1="38" y1="152" x2="48" y2="152" stroke="${c}" stroke-width="2"/>
         <line x1="30" y1="188" x2="66" y2="188" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/>
         <circle cx="48" cy="188" r="6" fill="${c}"/>
         <path d="M 44 174 L 44 212 L 48 226 L 52 212 L 52 174" stroke="${c}" stroke-width="2.6" stroke-linejoin="round"/>`
      ),
  },
  {
    id: 'sep-funnel',
    label: 'Sep. Funnel',
    w: 140,
    h: 230,
    build: (c) =>
      wrapSvg(
        '0 0 140 230',
        140,
        230,
        `<path d="M 58 20 L 82 20 M 62 20 L 62 38 C 30 56, 30 104, 64 146 L 64 194 L 70 212 L 76 194 L 76 146 C 110 104, 110 56, 78 38 L 78 20" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
         <line x1="46" y1="96" x2="94" y2="96" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>
         <line x1="52" y1="166" x2="88" y2="166" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>
         <circle cx="70" cy="166" r="5" fill="${c}"/>`
      ),
  },
];

export function buildCoordinateAxesSvg(c = '#111827') {
  const ticks = [];
  for (let i = 40; i <= 320; i += 28) {
    if (Math.abs(i - 180) < 4) continue;
    ticks.push(`<line x1="${i}" y1="175" x2="${i}" y2="185" stroke="${c}" stroke-width="1.8"/>`);
    ticks.push(`<line x1="175" y1="${i}" x2="185" y2="${i}" stroke="${c}" stroke-width="1.8"/>`);
  }
  return wrapSvg(
    '0 0 360 360',
    340,
    340,
    `<g opacity="0.22" stroke="${c}" stroke-width="1">
       <line x1="40" y1="68" x2="320" y2="68"/><line x1="40" y1="96" x2="320" y2="96"/>
       <line x1="40" y1="124" x2="320" y2="124"/><line x1="40" y1="152" x2="320" y2="152"/>
       <line x1="40" y1="208" x2="320" y2="208"/><line x1="40" y1="236" x2="320" y2="236"/>
       <line x1="40" y1="264" x2="320" y2="264"/><line x1="40" y1="292" x2="320" y2="292"/>
       <line x1="68" y1="40" x2="68" y2="320"/><line x1="96" y1="40" x2="96" y2="320"/>
       <line x1="124" y1="40" x2="124" y2="320"/><line x1="152" y1="40" x2="152" y2="320"/>
       <line x1="208" y1="40" x2="208" y2="320"/><line x1="236" y1="40" x2="236" y2="320"/>
       <line x1="264" y1="40" x2="264" y2="320"/><line x1="292" y1="40" x2="292" y2="320"/>
     </g>
     <line x1="24" y1="180" x2="336" y2="180" stroke="${c}" stroke-width="2.8" stroke-linecap="round"/>
     <polyline points="324,172 338,180 324,188" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
     <polyline points="36,172 22,180 36,188" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
     <line x1="180" y1="24" x2="180" y2="336" stroke="${c}" stroke-width="2.8" stroke-linecap="round"/>
     <polyline points="172,36 180,22 188,36" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
     <polyline points="172,324 180,338 188,324" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
     ${ticks.join('')}
     <text x="342" y="198" font-family="Segoe UI, sans-serif" font-size="16" font-weight="700" fill="${c}">X</text>
     <text x="192" y="26" font-family="Segoe UI, sans-serif" font-size="16" font-weight="700" fill="${c}">Y</text>
     <text x="164" y="198" font-family="Segoe UI, sans-serif" font-size="13" font-weight="700" fill="${c}">O</text>`
  );
}

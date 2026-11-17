/**
 * One stylesheet for the official letter. The on-screen preview and the print window both use it,
 * so a line, a page break or the signature lands in the same place in each.
 *
 * Every length is a multiple of `--u`, the body font size: `12pt` when printing, and a share of the
 * sheet width on screen. The sheet therefore scales as a whole and keeps the proportions of an A4 page.
 */
const u = (n: number) => `calc(var(--u) * ${n})`;
const S = '.letter-sheet';

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const BODY_PT = 12;
/** Size of 1mm, in `--u`. */
const U_PER_MM = PT_PER_INCH / MM_PER_INCH / BODY_PT;

export const LETTER_PAGE_MM = { width: 210, height: 297, margin: 20 } as const;
/** Page margin, and the writing area of one page, in `--u`. */
export const LETTER_MARGIN_U = LETTER_PAGE_MM.margin * U_PER_MM;
export const LETTER_PAGE_CONTENT_U = (LETTER_PAGE_MM.height - 2 * LETTER_PAGE_MM.margin) * U_PER_MM;
/** The sheet is `LETTER_SHEET_WIDTH_U` units wide, so one unit is `100cqw / LETTER_SHEET_WIDTH_U` on screen. */
export const LETTER_SHEET_WIDTH_U = LETTER_PAGE_MM.width * U_PER_MM;

export const LETTER_CSS = `
${S}{font-family:'Times New Roman',Times,serif;color:#111;font-size:var(--u);line-height:1.5;text-align:left}
${S} p{margin:0}
${S} h1,${S} h2{margin:0;font-size:inherit;font-weight:inherit}

${S} .kop-container{display:flex;align-items:center;justify-content:space-between;padding-bottom:${u(0.5)};margin-bottom:${u(1.25)};border-bottom:max(3px,${u(0.1875)}) double #111}
${S} .kop-logo{flex:none;width:${u(3.5)};height:${u(3.5)}}
${S} .kop-logo img{display:block;width:100%;height:100%;object-fit:contain}
${S} .kop-text{flex:1;min-width:0;padding:0 ${u(0.625)};text-align:center}
${S} .kop-instansi{font-size:${u(1.125)};font-weight:800;text-transform:uppercase;letter-spacing:${u(0.0125)};line-height:1.2;white-space:nowrap}
${S} .kop-satker{font-size:${u(0.9167)};font-weight:700;text-transform:uppercase;letter-spacing:${u(0.0125)};line-height:1.25;margin:${u(0.1875)} 0;white-space:nowrap}
${S} .kop-alamat{font-size:${u(0.7083)};margin-top:${u(0.125)};line-height:1.3;white-space:nowrap}
${S} .kop-kontak{font-size:${u(0.7083)};margin-top:${u(0.0625)};line-height:1.3;white-space:nowrap}

${S} .letter-meta{margin-bottom:${u(1)};font-size:${u(0.9167)}}
${S} .meta-row{display:flex}
${S} .meta-label{flex:none;width:${u(4.0625)}}
${S} .meta-sep{flex:none;width:${u(0.75)}}
${S} .meta-value{min-width:0;flex:1;white-space:pre-wrap}
${S} .meta-bold{font-weight:700}
${S} .meta-hal{font-weight:700;text-decoration:underline}

${S} .destination-block{margin:${u(1)} 0;font-size:${u(0.9167)}}
${S} .dest-name{font-weight:700;white-space:pre-line}
${S} .dest-city{font-style:italic}

${S} .letter-content{margin:${u(1.25)} 0;text-align:justify;font-size:${u(0.9583)}}
${S} .letter-content p{margin:0 0 ${u(0.75)};white-space:pre-line}
${S} .letter-content .indented{text-indent:${u(1.75)}}
${S} .letter-content .salam,${S} .letter-closing .salam{font-style:italic;white-space:pre-line}
${S} .task-giver{white-space:pre-line}
${S} .task-people{margin:${u(1)} 0;padding-left:${u(2.5)};list-style:decimal}
${S} .raw-block{margin:${u(0.625)} 0 ${u(0.625)} ${u(1.75)};white-space:pre-wrap}

${S} .letter-closing{display:flow-root;margin-top:${u(1)};font-size:${u(0.9583)};break-inside:avoid;page-break-inside:avoid}
${S} .letter-closing--pushed{margin-top:0}
${S} .letter-closing .salam{margin:0}
${S} .signature-block{width:${u(15.625)};margin:${u(2.25)} 0 0 auto;text-align:center;font-size:${u(0.9167)}}
${S} .signature-date{font-weight:500}
${S} .signature-jabatan{margin-top:${u(0.25)};font-weight:500}
${S} .sign-space{height:${u(4.6875)}}
${S} .sign-name{font-weight:700;text-decoration:underline}

`;

/** Extra rules for the on-screen sheet only: the paper itself, and the dashed lines where pages end. */
export const LETTER_SCREEN_CSS = `
.letter-frame{container-type:inline-size;width:100%;min-width:540px;max-width:${LETTER_PAGE_MM.width}mm;margin-inline:auto}
${S}.letter-sheet--screen{--u:calc(100cqw / ${LETTER_SHEET_WIDTH_U.toFixed(4)});position:relative;box-sizing:border-box;padding:${u(LETTER_MARGIN_U)}}
${S} .letter-page-guide{position:absolute;left:0;right:0;border-top:1px dashed #818cf8;pointer-events:none}
${S} .letter-page-guide span{position:absolute;right:${u(0.75)};top:${u(0.25)};font:${u(0.6)}/1 system-ui,sans-serif;color:#6366f1}
`;

/** The print window: A4 with 20mm margins; the body font is 12pt. */
export const LETTER_PRINT_CSS = `
@page{size:A4 portrait;margin:${LETTER_PAGE_MM.margin}mm}
html,body{margin:0;padding:0;background:#fff}
${S}{--u:${BODY_PT}pt}
${LETTER_CSS}
`;

/**
 * One stylesheet for the official letter. The on-screen preview and the print window both use it,
 * so a line, a page break or the signature lands in the same place in each.
 *
 * Every length is a multiple of `--u`, the body font size: `12pt` when printing, and a share of the
 * sheet width on screen. The sheet therefore scales as a whole and keeps the proportions of an A4 page.
 */
import { LETTER_BASE_PT, LETTER_MAX_INDENT } from '@/lib/surat-menyurat/letterDoc';

const u = (n: number) => `calc(var(--u) * ${n})`;
const S = '.letter-sheet';
const D = '.letter-sheet .letter-doc';

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
${D}{font-size:${u(LETTER_BASE_PT / BODY_PT)}}

${D} p{margin:0 0 ${u(0.75)};text-indent:${u(1.75)};white-space:pre-wrap}
${D} p[data-first-line="false"]{text-indent:0}
${Array.from({ length: LETTER_MAX_INDENT }, (_, i) => `${D} p[data-indent="${i + 1}"]{margin-left:${u(1.75 * (i + 1))}}`).join('\n')}
${D} .ProseMirror{outline:none;white-space:pre-wrap}
${D} ul,${D} ol{margin:0 0 ${u(0.75)};padding-left:${u(2.5)}}
${D} ul{list-style:disc}
${D} ol{list-style:decimal}
${D} li p{margin:0;text-indent:0}
${D} li>ul,${D} li>ol{margin:0}

${D} .kop-container{display:flex;align-items:center;padding-bottom:${u(0.5)};margin-bottom:${u(1.25)};border-bottom:max(3px,${u(0.1875)}) double #111}
${D} .kop-logo{flex:none;width:${u(3.5)};height:${u(3.5)}}
${D} .kop-logo img{display:block;width:100%;height:100%;max-width:none;margin:0;object-fit:contain}
${D} .kop-text{flex:1;min-width:0;padding:0 ${u(0.625)}}
${D} .kop-text p{text-indent:0;line-height:1.25}

${D} .meta-row{display:flex}
${D} .meta-label{flex:none;width:${u(4.0625)}}
${D} .meta-sep{flex:none;width:${u(0.75)}}
${D} .meta-value{min-width:0;flex:1;white-space:pre-wrap}
${D} .meta-row + :not(.meta-row){margin-top:${u(1)}}

${D} .task-giver{margin-bottom:${u(0.75)};white-space:pre-line}
${D} .task-people{margin:0 0 ${u(0.75)};padding-left:${u(2.5)};list-style:decimal}

${D} table{width:100%;margin:0 0 ${u(0.75)};border-collapse:collapse;table-layout:fixed}
${D} td,${D} th{position:relative;min-width:1em;padding:${u(0.25)} ${u(0.5)};border:1px solid #111;vertical-align:top}
${D} th{background:#f1f1f1;font-weight:700;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact}
${D} td p,${D} th p{margin:0;text-indent:0}
${D} tr{break-inside:avoid}
${D} img{display:block;max-width:100%;height:auto;margin:0 auto ${u(0.75)}}
${D} img[data-align="left"]{margin-left:0;margin-right:auto}
${D} img[data-align="right"]{margin-left:auto;margin-right:0}

${D} .letter-closing{display:flow-root;margin-top:${u(1)};break-inside:avoid;page-break-inside:avoid}
${D} .signature-block{width:${u(15.625)};margin:${u(2.25)} 0 0 auto}
${D} .sign-space{height:${u(4.6875)}}
`;

/** Extra rules for the on-screen sheet only: the paper itself, the editor's cursors and selections, and the dashed lines where pages end. */
export const LETTER_SCREEN_CSS = `
.letter-frame{container-type:inline-size;width:100%;min-width:540px;max-width:${LETTER_PAGE_MM.width}mm;margin-inline:auto}
${S}.letter-sheet--screen{--u:calc(100cqw / ${LETTER_SHEET_WIDTH_U.toFixed(4)});position:relative;box-sizing:border-box;padding:${u(LETTER_MARGIN_U)}}
${D} .ProseMirror{cursor:text}
${D} .ProseMirror ::selection{background:#c7d2fe}
${D} img.ProseMirror-selectednode,${D} .ProseMirror-selectednode{outline:2px solid #6366f1}
${D} .selectedCell:after{content:'';position:absolute;inset:0;background:rgba(99,102,241,.18);pointer-events:none}
${D} .ProseMirror-gapcursor{display:none;position:relative;pointer-events:none}
${D} .ProseMirror-gapcursor:after{content:'';display:block;position:absolute;top:-2px;width:20px;border-top:1px solid #111;animation:letter-cursor-blink 1.1s steps(2,start) infinite}
${D} .ProseMirror-focused .ProseMirror-gapcursor{display:block}
@keyframes letter-cursor-blink{to{visibility:hidden}}
${S} .letter-page-guide{position:absolute;left:0;right:0;border-top:1px dashed #818cf8;pointer-events:none}
${S} .letter-page-guide span{position:absolute;right:${u(0.75)};top:${u(0.25)};font:${u(0.6)}/1 system-ui,sans-serif;color:#6366f1}
`;

/** The print window: A4 with 20mm margins; one unit is 12pt. */
export const LETTER_PRINT_CSS = `
@page{size:A4 portrait;margin:${LETTER_PAGE_MM.margin}mm}
html,body{margin:0;padding:0;background:#fff}
${S}{--u:${BODY_PT}pt}
${LETTER_CSS}
`;

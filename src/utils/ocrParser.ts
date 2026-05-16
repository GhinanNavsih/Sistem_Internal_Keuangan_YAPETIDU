/**
 * ocrParser.ts
 */

import type { RekapColumn } from '@/types';

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export interface ParsedRow {
  employeeId: string | null;
  name: string;
  nameConfidence: number;
  values: Record<string, number>;
}

// ─── File to Canvas (PDF or Image) ──────────────────────────────────────────

export async function renderFileToCanvas(
  file: File,
  rotation: number = 0
): Promise<HTMLCanvasElement> {
  if (file.type === 'application/pdf') {
    const pdfjsLib = await import('pdfjs-dist');
    const version = pdfjsLib.version;
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 2, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d')!;
    await (page as any).render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } else {
    // Handle Images
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d')!;
          
          // Apply rotation
          if (rotation === 90 || rotation === 270) {
            canvas.width = img.height;
            canvas.height = img.width;
          } else {
            canvas.width = img.width;
            canvas.height = img.height;
          }
          
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
          resolve(canvas);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

export function cropCanvas(
  originalCanvas: HTMLCanvasElement,
  cropPercent: { x: number; y: number; w: number; h: number }
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  const x = (cropPercent.x / 100) * originalCanvas.width;
  const y = (cropPercent.y / 100) * originalCanvas.height;
  const w = (cropPercent.w / 100) * originalCanvas.width;
  const h = (cropPercent.h / 100) * originalCanvas.height;
  
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(originalCanvas, x, y, w, h, 0, 0, w, h);
  return canvas;
}

// ─── OCR ────────────────────────────────────────────────────────────────────

export async function runOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number) => void
): Promise<{ words: OcrWord[]; text: string }> {
  const Tesseract = await import('tesseract.js');

  const result = await Tesseract.recognize(canvas, 'ind+eng', {
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  const words: OcrWord[] = ((result.data as any).words || []).map((w: any) => ({
    text: w.text,
    x: w.bbox.x0,
    y: w.bbox.y0,
    w: w.bbox.x1 - w.bbox.x0,
    h: w.bbox.y1 - w.bbox.y0,
    confidence: w.confidence,
  }));

  return { words, text: result.data.text };
}

// ─── Group words into rows ──────────────────────────────────────────────────

function groupIntoRows(words: OcrWord[], yTolerance: number = 30): OcrWord[][] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: OcrWord[][] = [];
  let currentRow: OcrWord[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= yTolerance) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow.sort((a, b) => a.x - b.x));
      currentRow = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  rows.push(currentRow.sort((a, b) => a.x - b.x));
  return rows;
}

// ─── Fuzzy name matching ────────────────────────────────────────────────────

function normalise(s: string): string {
  // Strip row numbers, noise, and prefixes
  return s.toUpperCase()
    .replace(/^\d+/, '') // strip leading row number
    .replace(/[|\[\]()=~—_]/g, '')
    .replace(/\b(M|H|HJ|DR|ST|SPD|SI)\b/g, '') // strip common titles
    .replace(/[^A-Z0-9]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const tmp = [];
  for (let i = 0; i <= a.length; i++) tmp[i] = [i];
  for (let j = 0; j <= b.length; j++) tmp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

function nameSimilarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const distance = levenshtein(na, nb);
  const maxLength = Math.max(na.length, nb.length);
  return (maxLength - distance) / maxLength;
}

export function matchEmployee(
  ocrName: string,
  employees: { employeeId: string; name: string }[]
): { employeeId: string; name: string; confidence: number } | null {
  let best: { employeeId: string; name: string; confidence: number } | null = null;

  const ocrNorm = normalise(ocrName);

  // Check if this OCR name uses an initial abbreviation, e.g. "M. WAHYUDI"
  // Pattern: first token is 1-2 letters (optionally followed by a dot), rest is the surname
  const ocrTokens = ocrName.trim().split(/\s+/);
  const firstToken = ocrTokens[0].replace(/\.$/, ''); // strip trailing dot
  const isInitial = firstToken.length <= 2 && /^[A-Za-z]+$/.test(firstToken);
  const ocrSurname = ocrTokens.slice(1).join(' '); // everything after the initial

  // ── Suffix-fragment match ────────────────────────────────────────────────
  // If the OCR produced a short clipped fragment (e.g. "IK" from "KHOLIK"),
  // check whether any employee name ENDS with that fragment.
  const isShortFragment = ocrNorm.length <= 5 && ocrTokens.length === 1;

  for (const emp of employees) {
    // ── Standard fuzzy score ───────────────────────────────────────────────
    let score = nameSimilarity(ocrName, emp.name);

    // ── Initial-expansion boost ────────────────────────────────────────────
    if (isInitial && ocrSurname.length > 2) {
      const empTokens = emp.name.trim().split(/\s+/);
      const empFirstLetter = empTokens[0][0]?.toUpperCase();
      const empSurname = empTokens.slice(1).join(' ');

      if (empFirstLetter === firstToken.toUpperCase()) {
        const surnameScore = nameSimilarity(ocrSurname, empSurname);
        if (surnameScore > 0.7) {
          score = Math.max(score, 0.85);
        }
      }
    }

    // ── Suffix-fragment boost ──────────────────────────────────────────────
    // e.g. "IK" matches end of "KHOLIK", "ADI" matches end of "MUHADI"
    if (isShortFragment && ocrNorm.length >= 2) {
      const empNorm = normalise(emp.name);
      if (empNorm.endsWith(ocrNorm)) {
        // Length ratio: shorter fragment = lower confidence ceiling
        const coverageRatio = ocrNorm.length / empNorm.length;
        const suffixScore = 0.55 + coverageRatio * 0.3; // range: 0.55 – 0.85
        score = Math.max(score, suffixScore);
      }
    }

    if (score > 0.2 && (!best || score > best.confidence)) {
      best = { employeeId: emp.employeeId, name: emp.name, confidence: score };
    }
  }
  return best;
}

// ─── Parse number from OCR text ─────────────────────────────────────────────

function parseNumber(text: string): number | null {
  // Strip noise and fix common OCR substitutions
  let cleaned = text.replace(/[Rp\s|\[\]()=~—_]/gi, '')
    .replace(/o/gi, '0')
    .replace(/[lIi!|]/gi, '1')
    .replace(/z/gi, '2')
    .replace(/s/gi, '8')
    .replace(/g/gi, '9')
    .replace(/b/gi, '6');

  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '');
  if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/,/g, '');

  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

function isNumericish(text: string): boolean {
  const cleaned = text.replace(/[Rp.\s,|\[\]()=~—_-]/gi, '')
    .replace(/[olsIizgb!|]/gi, '1');
  return /^\d+$/.test(cleaned) && cleaned.length > 0;
}

// ─── Main parser ────────────────────────────────────────────────────────────

export function parseRekapRows(
  words: OcrWord[],
  employees: { employeeId: string; name: string }[],
  columns: RekapColumn[]
): ParsedRow[] {
  const rows = groupIntoRows(words);
  const results: ParsedRow[] = [];
  
  for (const row of rows) {
    const textWords: OcrWord[] = [];
    const numWords: OcrWord[] = [];

    for (const w of row) {
      const cleanWord = w.text.replace(/[|\[\]()=~—_]/g, '').trim();
      if (!cleanWord) continue;

      if (isNumericish(cleanWord)) {
        numWords.push({ ...w, text: cleanWord });
      } else if (cleanWord.length > 1 && !/^[Rp\-]+$/i.test(cleanWord)) {
        textWords.push({ ...w, text: cleanWord });
      }
    }

    if (textWords.length === 0) continue;

    const joined = textWords.map(w => w.text).join(' ').toUpperCase();
    if (/\b(REKAPITULASI|UNIVERSITAS|PESANTREN|KETERANGAN|JUMLAH|HARI|BULAN|JOMBANG|MENGETAHUI|RI|RON)\b/.test(joined)) {
      continue;
    }

    // Name is usually the group of words before the first numeric word
    const firstNumX = numWords.length > 0 ? numWords[0].x : 9999;
    const nameCandidate = textWords.filter(w => w.x < firstNumX).map(w => w.text).join(' ');
    
    const match = matchEmployee(nameCandidate, employees);
    if (!match) continue;

    const values: Record<string, number> = {};
    const sortedNums = [...numWords].sort((a, b) => a.x - b.x);
    
    // Skip row index if it's there
    if (sortedNums.length > 0 && sortedNums[0].x < 200) {
      sortedNums.shift();
    }

    for (let i = 0; i < columns.length && i < sortedNums.length; i++) {
      const val = parseNumber(sortedNums[i].text);
      if (val !== null) {
        values[columns[i].key] = val;
      }
    }

    results.push({
      employeeId: match.employeeId,
      name: match.name,
      nameConfidence: match.confidence,
      values,
    });
  }

  return results;
}

// ─── Auto-Orientation Heuristic ──────────────────────────────────────────────

const ANCHOR_KEYWORDS = ['NAMA', 'HARIAN', 'REKAPITULASI', 'PRESENSI', 'BAGIAN', 'JUMAT', 'URAIAN'];

export async function detectBestRotation(
  file: File,
  onProgress?: (p: number) => void
): Promise<number> {
  const rotations = [270, 90, 0, 180];
  for (const rot of rotations) {
    const canvas = await renderPdfToCanvas(file, rot);
    const { text } = await runOcr(canvas, (p) => { if (onProgress) onProgress(p); });
    const upperText = text.toUpperCase();
    const matchCount = ANCHOR_KEYWORDS.filter(k => upperText.includes(k)).length;
    if (matchCount >= 2) return rot;
  }
  return 270;
}

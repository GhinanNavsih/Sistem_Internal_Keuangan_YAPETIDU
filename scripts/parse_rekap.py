import sys
import json
import re
import easyocr
import numpy as np
from PIL import Image, ImageDraw
from pathlib import Path
import traceback
try:
    import pypdfium2 as pdfium
except ImportError:
    pdfium = None

# Broad patterns used solely to identify which row is the header row
HEADER_PATTERNS = {
    'harian': r'harian|presensi\s*hari|vaka',
    'jumatLibur': r'bonus\s*jum|jumat|libur',
    'bonusPresensi': r'bonus\s*presen',
    'piket': r'piket',
    'praktek': r'praktek',
    'spj': r'spj|sopir',
    'tunjangan': r'tunjangan|khusus'
}

def match_header(text):
    text = re.sub(r'[^a-z\s/]', '', text.lower()).strip()
    if 'nama' in text: return None
    if 'bonus' in text and 'finger' in text: return 'bonusFinger'
    if 'bonus' in text and 'triwulan' in text: return 'bonusTriwulan'
    if 'bonus' in text and 'presen' in text: return 'bonusPresensi'
    if 'bonus' in text and ('jum' in text or 'libur' in text): return 'jumatLibur'
    if ('presen' in text or 'vaka' in text) and ('hari' in text or 'harian' in text): return 'harian'
    if 'jum' in text and 'bonus' in text: return 'jumatLibur'
    if 'piket' in text: return 'piket'
    if 'praktek' in text: return 'praktek'
    if 'spj' in text: return 'lemburSPJ'
    if 'tunjangan' in text or 'khusus' in text: return 'tunjanganKhusus'
    if 'harian' in text: return 'harian'
    if 'vakas' in text: return 'harian'
    for key, pattern in HEADER_PATTERNS.items():
        if re.search(pattern, text, re.IGNORECASE):
            mapping = {'spj': 'lemburSPJ', 'tunjangan': 'tunjanganKhusus'}
            res = mapping.get(key, key)
            if res == 'lemburSPJ' and 'spj' not in text and 'sopir' not in text: continue
            return res
    return None

def cluster_lines(indices, gap=15):
    if len(indices) == 0: return []
    indices = sorted(indices)
    clusters = []
    curr = [indices[0]]
    for i in range(1, len(indices)):
        if indices[i] - curr[-1] <= gap:
            curr.append(indices[i])
        else:
            clusters.append(int(sum(curr) / len(curr)))
            curr = [indices[i]]
    clusters.append(int(sum(curr) / len(curr)))
    return clusters

def remove_table_lines(pil_img):
    gray = np.array(pil_img.convert('L'))
    h, w = gray.shape
    binary = (gray < 200).astype(np.uint8)
    
    # Restore safe thresholds to prevent false positives from text
    col_dark = np.sum(binary, axis=0)
    col_transitions = np.sum(np.abs(np.diff(binary, axis=0)), axis=0)
    # More aggressive line detection to catch thin/broken grid lines
    line_cols = np.where((col_dark > h * 0.15) & (col_transitions < 80))[0]
    v_lines = cluster_lines(line_cols)
    
    row_dark = np.sum(binary, axis=1)
    row_transitions = np.sum(np.abs(np.diff(binary, axis=1)), axis=1)
    line_rows = np.where((row_dark > w * 0.15) & (row_transitions < 80))[0]
    
    clean_gray = gray.copy()
    left_safe = int(w * 0.15)
    right_safe = int(w * 0.98)
    for col in line_cols:
        if left_safe < col < right_safe: clean_gray[:, max(0, col-3):min(w, col+4)] = 255
    for row in line_rows: clean_gray[max(0, row-3):min(h, row+4), :] = 255
    return Image.fromarray(clean_gray).convert('RGB'), v_lines, cluster_lines(line_rows)

def assign_to_column(word, boundaries):
    cx = word['x'] + word['w'] / 2
    for b in boundaries:
        if b['x_min'] <= cx <= b['x_max']: return b['key']
    return None

def is_numeric_value(text):
    cleaned = re.sub(r'[Rr][Pp]\.?\s*', '', text)
    cleaned = cleaned.replace('.', '').replace(',', '').replace(' ', '')
    cleaned = cleaned.replace('-', '0').replace('o', '0').replace('O', '0').replace('|', '').strip()
    if not cleaned: return False, "0"
    return cleaned.isdigit(), cleaned

def main():
    if len(sys.argv) < 2: sys.exit(1)
    file_path = sys.argv[1]
    try:
        if Path(file_path).suffix.lower() == '.pdf' and pdfium:
            pdf = pdfium.PdfDocument(file_path)
            pil_image = pdf[0].render(scale=3).to_pil()
        else:
            pil_image = Image.open(file_path).convert('RGB')
            w, h = pil_image.size
            pil_image = pil_image.resize((w * 2, h * 2), Image.Resampling.LANCZOS)
        clean_image, v_grid, h_grid = remove_table_lines(pil_image)
        img_np = np.array(clean_image); reader = easyocr.Reader(['id', 'en'], gpu=False)
        results = reader.readtext(img_np, min_size=5, text_threshold=0.3)
        
        # Initial word extraction
        raw_words = [{"text": t.strip(), "x": int(b[0][0]), "y": int(b[0][1]), "w": int(b[2][0]-b[0][0]), "h": int(b[2][1]-b[0][1])} for (b, t, p) in results]
        
        # Filter for single-digit noise that looks like a vertical line fragment (narrow and tall)
        all_words = []
        for w in raw_words:
            if len(w['text']) == 1:
                aspect = w['w'] / w['h']
                # If it's extremely narrow and matches line-like characters, it's probably a grid fragment
                if aspect < 0.28 and w['text'] in "127I|l/j":
                    continue
            all_words.append(w)
        
        # Always use text clustering to group rows safely. Physical lines are too
        # noisy and can cause valid text to be dropped if the grid is incomplete.
        all_words.sort(key=lambda w: w['y'])
        row_ranges = []
        if all_words:
            avg_h = sum(w['h'] for w in all_words) / len(all_words)
            curr_row = [all_words[0]]; curr_cy = all_words[0]['y'] + all_words[0]['h']/2
            for i in range(1, len(all_words)):
                w = all_words[i]; w_cy = w['y'] + w['h']/2
                if abs(w_cy - curr_cy) <= avg_h * 0.8:
                    curr_row.append(w); curr_cy = sum((xw['y']+xw['h']/2) for xw in curr_row)/len(curr_row)
                else:
                    row_ranges.append((min(xw['y'] for xw in curr_row), max(xw['y']+xw['h'] for xw in curr_row)))
                    curr_row = [w]; curr_cy = w['y'] + w['h']/2
            row_ranges.append((min(xw['y'] for xw in curr_row), max(xw['y']+xw['h'] for xw in curr_row)))

        rows = [[] for _ in row_ranges]
        for w in all_words:
            w_cy = w['y'] + w['h'] / 2
            for i, (top, bottom) in enumerate(row_ranges):
                if top <= w_cy <= bottom: rows[i].append(w); break
        rows = [sorted(r, key=lambda x: x['x']) for r in rows if r]

        # ── Multi-Row Header Detection ──────────────────────────────────────
        header_row_indices = []
        for idx in range(min(8, len(rows))):
            row_text = ' '.join(w['text'] for w in rows[idx]).lower()
            if any(re.search(pat, row_text, re.IGNORECASE) for pat in HEADER_PATTERNS.values()):
                header_row_indices.append(idx)
        
        header_candidates = [rows[i] for i in header_row_indices] if header_row_indices else []
        header_end_idx = max(header_row_indices) if header_row_indices else -1
        
        # If no headers found, fallback to row 0 just in case
        if not header_candidates and rows:
            header_candidates = [rows[0]]; header_end_idx = 0

        boundaries = []
        merged_matched = []
        
        # Collect all words from the header rows
        all_header_words = []
        for r in header_candidates:
            all_header_words.extend(r)
            
        # Group vertically stacked words in the header
        all_header_words.sort(key=lambda w: w['x'])
        merged_header_words = []
        if all_header_words:
            curr_hw = dict(all_header_words[0])
            for i in range(1, len(all_header_words)):
                w = all_header_words[i]
                c_cx = curr_hw['x'] + curr_hw['w']/2
                w_cx = w['x'] + w['w']/2
                
                # Check for significant horizontal overlap (vertically aligned)
                if abs(c_cx - w_cx) < max(curr_hw['w'], w['w']) * 0.8:
                    # To keep text in visual top-down order, we should probably sort by Y when combining, 
                    # but simple appending is usually fine since all_header_words originally came from ordered rows,
                    # wait, all_header_words is sorted by X. We should join them in Y order.
                    # Since it's only 2-3 words max, just append. The regex ignores order anyway.
                    curr_hw['text'] += " " + w['text']
                    x_end = max(curr_hw['x'] + curr_hw['w'], w['x'] + w['w'])
                    curr_hw['x'] = min(curr_hw['x'], w['x'])
                    curr_hw['w'] = x_end - curr_hw['x']
                else:
                    merged_header_words.append(curr_hw)
                    curr_hw = dict(w)
            merged_header_words.append(curr_hw)

        for w in merged_header_words:
            key = match_header(w['text'])
            if key: merged_matched.append({'key': key, 'cx': w['x'] + w['w']/2})
        
        if merged_matched:
            by_key = {}
            for m in merged_matched: by_key.setdefault(m['key'], []).append(m['cx'])
            centers = sorted([{'key': k, 'cx': sum(v)/len(v)} for k, v in by_key.items()], key=lambda x: x['cx'])
            
            # Map to grid
            mapped_keys = set()
            if len(v_grid) >= 2:
                for c in centers:
                    for j in range(len(v_grid)-1):
                        if v_grid[j]-60 <= c['cx'] <= v_grid[j+1]+60:
                            boundaries.append({'key': c['key'], 'x_min': v_grid[j], 'x_max': v_grid[j+1]})
                            mapped_keys.add(c['key']); break
            
            # Fallback for keys that didn't map to a grid lane
            for i, c in enumerate(centers):
                if c['key'] not in mapped_keys:
                    x_min = (centers[i-1]['cx'] + c['cx'])/2 if i > 0 else (c['cx'] - 150)
                    x_max = (c['cx'] + centers[i+1]['cx'])/2 if i < len(centers)-1 else (c['cx'] + 1000)
                    boundaries.append({'key': c['key'], 'x_min': x_min, 'x_max': x_max})

        draw = ImageDraw.Draw(pil_image)
        for (top, bottom) in row_ranges:
            draw.line([(0, top), (pil_image.width, top)], fill="red", width=2)
            draw.line([(0, bottom), (pil_image.width, bottom)], fill="red", width=2)
        for b in boundaries:
            draw.line([(b['x_min'], 0), (b['x_min'], pil_image.height)], fill="blue", width=3)
            draw.line([(b['x_max'], 0), (b['x_max'], pil_image.height)], fill="blue", width=3)
        pil_image.save("tmp/debug_preprocessed.png")

        structured_rows = []
        target_rows = rows[header_end_idx + 1:] if header_end_idx >= 0 else rows
        avg_h = sum(w['h'] for w in all_words) / len(all_words) if all_words else 10
        for row in target_rows:
            merged = []; curr = row[0] if row else None
            if curr:
                for i in range(1, len(row)):
                    next_w = row[i]
                    c_left = curr['x']
                    c_right = curr['x'] + curr['w']
                    n_left = next_w['x']
                    n_right = next_w['x'] + next_w['w']
                    
                    gap = n_left - c_right
                    # If the next word heavily overlaps the current word (by more than 50% of its own width),
                    # it is almost certainly a phantom OCR read or noise (like the rogue '7'). Discard it.
                    if gap < -(next_w['w'] * 0.5):
                        continue
                        
                    t1_c = curr['text'].replace('.','').replace(',','')
                    t2_c = next_w['text'].replace('.','').replace(',','')
                    
                    if gap < (avg_h * 0.6) and abs((curr['y']+curr['h']/2)-(next_w['y']+next_w['h']/2)) < (avg_h * 0.3):
                        joiner = "" if (t1_c.isdigit() and t2_c.isdigit()) else " "
                        curr = {
                            "text": f"{curr['text']}{joiner}{next_w['text']}", 
                            "x": min(c_left, n_left), 
                            "y": min(curr['y'], next_w['y']), 
                            "w": max(c_right, n_right) - min(c_left, n_left), 
                            "h": max(curr['h'], next_w['h'])
                        }
                    else: 
                        merged.append(curr)
                        curr = next_w
                merged.append(curr)
            
            row_text = ' '.join(w['text'] for w in merged).upper()
            if sum(1 for kw in ['HARIAN', 'PRESENSI', 'JUMAT', 'PIKET', 'SOPIR', 'NAMA', 'PRAKTEK', 'TUNJANGAN'] if kw in row_text) >= 2: continue
            if any(kw in row_text for kw in ['REKAPITULASI', 'JUMLAH', 'UNIVERSITAS', 'BULAN']): continue
            name_parts = []; data_words = []; found_data_start = False
            for w in merged:
                is_num, _ = is_numeric_value(w['text'])
                if not found_data_start:
                    if is_num or w['text'] in ['-', '0']:
                        found_data_start = True; data_words.append(w)
                    elif len(w['text']) > 1 or (w['text'].endswith('.') and len(w['text']) <= 3):
                        if not re.match(r'^\d+$', w['text']): name_parts.append(w['text'])
                else: data_words.append(w)
            if name_parts:
                name = ' '.join(name_parts); col_values = {}
                # Capture the Y bounds for this row for frontend slicing
                y_top = min(w['y'] for w in merged)
                y_bottom = max(w['y'] + w['h'] for w in merged)
                
                for w in data_words:
                    is_num, cl = is_numeric_value(w['text'])
                    if is_num:
                        key = assign_to_column(w, boundaries)
                        if key: col_values[key] = max(col_values.get(key, -1), int(cl))
                structured_rows.append({
                    'name': name, 
                    'values': col_values,
                    'y_top': int(y_top),
                    'y_bottom': int(y_bottom)
                })
        output_data = {
            "structured": structured_rows, 
            "columns_detected": [b['key'] for b in boundaries], 
            "raw_words": all_words,
            "img_w": img_np.shape[1],
            "img_h": img_np.shape[0]
        }
        json_str = json.dumps(output_data)
        print(json_str)
        with open('tmp/rekap_output.json', 'w') as f:
            f.write(json_str)
    except Exception as e:
        error_json = json.dumps({"error": str(e), "traceback": traceback.format_exc()})
        print(error_json)
        with open('tmp/rekap_output.json', 'w') as f:
            f.write(error_json)
        sys.exit(1)

if __name__ == "__main__":
    main()

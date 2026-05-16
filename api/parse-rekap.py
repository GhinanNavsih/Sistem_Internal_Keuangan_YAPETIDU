import json
import re
import easyocr
import numpy as np
from PIL import Image, ImageDraw
import io
import os
import traceback
from http.server import BaseHTTPRequestHandler
import cgi

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
    
    col_dark = np.sum(binary, axis=0)
    col_transitions = np.sum(np.abs(np.diff(binary, axis=0)), axis=0)
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

# Singleton Reader to avoid re-initializing on every request (Vercel warm starts)
READER = None
def get_reader():
    global READER
    if READER is None:
        # Note: In Vercel, we must ensure easyocr downloads models to /tmp or includes them in the bundle
        # By default it uses ~/.EasyOCR. We might need to set easyocr_path.
        model_storage_directory = '/tmp/.EasyOCR'
        if not os.path.exists(model_storage_directory):
            os.makedirs(model_storage_directory)
        READER = easyocr.Reader(['id', 'en'], gpu=False, model_storage_directory=model_storage_directory)
    return READER

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_type, pdict = cgi.parse_header(self.headers.get('Content-Type'))
            if content_type != 'multipart/form-data':
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Expected multipart/form-data')
                return

            # Note: pdict['boundary'] needs to be bytes in some python versions
            if isinstance(pdict.get('boundary'), str):
                pdict['boundary'] = bytes(pdict['boundary'], "utf-8")
            
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={'REQUEST_METHOD': 'POST'}
            )

            if 'file' not in form:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'No file uploaded')
                return

            file_item = form['file']
            file_data = file_item.file.read()
            
            # Process the image
            pil_image = Image.open(io.BytesIO(file_data)).convert('RGB')
            w, h = pil_image.size
            if w < 1500: # Upscale if low res
                pil_image = pil_image.resize((w * 2, h * 2), Image.Resampling.LANCZOS)
            
            clean_image, v_grid, h_grid = remove_table_lines(pil_image)
            img_np = np.array(clean_image)
            
            reader = get_reader()
            results = reader.readtext(img_np, min_size=5, text_threshold=0.3)
            
            raw_words = [{"text": t.strip(), "x": int(b[0][0]), "y": int(b[0][1]), "w": int(b[2][0]-b[0][0]), "h": int(b[2][1]-b[0][1])} for (b, t, p) in results]
            
            all_words = []
            for word in raw_words:
                if len(word['text']) == 1:
                    aspect = word['w'] / word['h']
                    if aspect < 0.28 and word['text'] in "127I|l/j": continue
                all_words.append(word)
            
            all_words.sort(key=lambda w: w['y'])
            row_ranges = []
            if all_words:
                avg_h = sum(w['h'] for w in all_words) / len(all_words)
                curr_row = [all_words[0]]
                curr_cy = all_words[0]['y'] + all_words[0]['h']/2
                for i in range(1, len(all_words)):
                    w_item = all_words[i]
                    w_cy = w_item['y'] + w_item['h']/2
                    if abs(w_cy - curr_cy) <= avg_h * 0.8:
                        curr_row.append(w_item)
                        curr_cy = sum((xw['y']+xw['h']/2) for xw in curr_row)/len(curr_row)
                    else:
                        row_ranges.append((min(xw['y'] for xw in curr_row), max(xw['y']+xw['h'] for xw in curr_row)))
                        curr_row = [w_item]
                        curr_cy = w_item['y'] + w_item['h']/2
                row_ranges.append((min(xw['y'] for xw in curr_row), max(xw['y']+xw['h'] for xw in curr_row)))

            rows = [[] for _ in row_ranges]
            for word in all_words:
                w_cy = word['y'] + word['h'] / 2
                for i, (top, bottom) in enumerate(row_ranges):
                    if top <= w_cy <= bottom: rows[i].append(word); break
            rows = [sorted(r, key=lambda x: x['x']) for r in rows if r]

            header_row_indices = []
            for idx in range(min(8, len(rows))):
                row_text = ' '.join(w['text'] for w in rows[idx]).lower()
                if any(re.search(pat, row_text, re.IGNORECASE) for pat in HEADER_PATTERNS.values()):
                    header_row_indices.append(idx)
            
            header_candidates = [rows[i] for i in header_row_indices] if header_row_indices else []
            header_end_idx = max(header_row_indices) if header_row_indices else -1
            if not header_candidates and rows:
                header_candidates = [rows[0]]; header_end_idx = 0

            boundaries = []
            merged_matched = []
            all_header_words = []
            for r in header_candidates: all_header_words.extend(r)
            all_header_words.sort(key=lambda w: w['x'])
            
            merged_header_words = []
            if all_header_words:
                curr_hw = dict(all_header_words[0])
                for i in range(1, len(all_header_words)):
                    w_item = all_header_words[i]
                    c_cx = curr_hw['x'] + curr_hw['w']/2
                    w_cx = w_item['x'] + w_item['w']/2
                    if abs(c_cx - w_cx) < max(curr_hw['w'], w_item['w']) * 0.8:
                        curr_hw['text'] += " " + w_item['text']
                        x_end = max(curr_hw['x'] + curr_hw['w'], w_item['x'] + w_item['w'])
                        curr_hw['x'] = min(curr_hw['x'], w_item['x'])
                        curr_hw['w'] = x_end - curr_hw['x']
                    else:
                        merged_header_words.append(curr_hw)
                        curr_hw = dict(w_item)
                merged_header_words.append(curr_hw)

            for w_item in merged_header_words:
                key = match_header(w_item['text'])
                if key: merged_matched.append({'key': key, 'cx': w_item['x'] + w_item['w']/2})
            
            if merged_matched:
                by_key = {}
                for m in merged_matched: by_key.setdefault(m['key'], []).append(m['cx'])
                centers = sorted([{'key': k, 'cx': sum(v)/len(v)} for k, v in by_key.items()], key=lambda x: x['cx'])
                mapped_keys = set()
                if len(v_grid) >= 2:
                    for c in centers:
                        for j in range(len(v_grid)-1):
                            if v_grid[j]-60 <= c['cx'] <= v_grid[j+1]+60:
                                boundaries.append({'key': c['key'], 'x_min': v_grid[j], 'x_max': v_grid[j+1]})
                                mapped_keys.add(c['key']); break
                for i, c in enumerate(centers):
                    if c['key'] not in mapped_keys:
                        x_min = (centers[i-1]['cx'] + c['cx'])/2 if i > 0 else (c['cx'] - 150)
                        x_max = (c['cx'] + centers[i+1]['cx'])/2 if i < len(centers)-1 else (c['cx'] + 1000)
                        boundaries.append({'key': c['key'], 'x_min': x_min, 'x_max': x_max})

            structured_rows = []
            target_rows = rows[header_end_idx + 1:] if header_end_idx >= 0 else rows
            avg_h = sum(w['h'] for w in all_words) / len(all_words) if all_words else 10
            for row in target_rows:
                merged = []; curr = row[0] if row else None
                if curr:
                    for i in range(1, len(row)):
                        next_w = row[i]
                        c_right = curr['x'] + curr['w']
                        n_left = next_w['x']
                        gap = n_left - c_right
                        if gap < -(next_w['w'] * 0.5): continue
                        t1_c = curr['text'].replace('.','').replace(',','')
                        t2_c = next_w['text'].replace('.','').replace(',','')
                        if gap < (avg_h * 0.6) and abs((curr['y']+curr['h']/2)-(next_w['y']+next_w['h']/2)) < (avg_h * 0.3):
                            joiner = "" if (t1_c.isdigit() and t2_c.isdigit()) else " "
                            curr = {
                                "text": f"{curr['text']}{joiner}{next_w['text']}", 
                                "x": min(curr['x'], next_w['x']), 
                                "y": min(curr['y'], next_w['y']), 
                                "w": max(c_right, next_w['x'] + next_w['w']) - min(curr['x'], next_w['x']), 
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
                for w_item in merged:
                    is_num, _ = is_numeric_value(w_item['text'])
                    if not found_data_start:
                        if is_num or w_item['text'] in ['-', '0']:
                            found_data_start = True; data_words.append(w_item)
                        elif len(w_item['text']) > 1 or (w_item['text'].endswith('.') and len(w_item['text']) <= 3):
                            if not re.match(r'^\d+$', w_item['text']): name_parts.append(w_item['text'])
                    else: data_words.append(w_item)
                if name_parts:
                    name = ' '.join(name_parts); col_values = {}
                    y_top = min(w_item['y'] for w_item in merged)
                    y_bottom = max(w_item['y'] + w_item['h'] for w_item in merged)
                    for w_item in data_words:
                        is_num, cl = is_numeric_value(w_item['text'])
                        if is_num:
                            key = assign_to_column(w_item, boundaries)
                            if key: col_values[key] = max(col_values.get(key, -1), int(cl))
                    structured_rows.append({
                        'name': name, 
                        'values': col_values,
                        'y_top': int(y_top),
                        'y_bottom': int(y_bottom)
                    })
            
            output_data = {
                "data": {
                    "structured": structured_rows, 
                    "columns_detected": [b['key'] for b in boundaries], 
                    "raw_words": all_words,
                    "img_w": img_np.shape[1],
                    "img_h": img_np.shape[0]
                }
            }
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(output_data).encode('utf-8'))
            
        except Exception as e:
            error_data = {"error": str(e), "traceback": traceback.format_exc()}
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(error_data).encode('utf-8'))

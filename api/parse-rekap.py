import json
import os
import io
import traceback
import cgi
from http.server import BaseHTTPRequestHandler
import google.generativeai as genai
from PIL import Image

# Initialize Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_type, pdict = cgi.parse_header(self.headers.get('Content-Type'))
            if content_type != 'multipart/form-data':
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Expected multipart/form-data')
                return

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
            
            # Get expected columns from form if provided
            columns_json = form.getvalue('columns', '[]')
            columns = json.loads(columns_json)
            column_names = ", ".join([f"'{c['label']}' (key: {c['key']})" for c in columns])

            # Get image dimensions
            pil_img = Image.open(io.BytesIO(file_data))
            img_w, img_h = pil_img.size

            if not GEMINI_API_KEY:
                raise Exception("GEMINI_API_KEY not configured in environment variables.")

            # Prepare Gemini request
            model = genai.GenerativeModel('gemini-1.5-flash')
            
            prompt = f"""
            You are a payroll document parser. Extract data from this table image into structured JSON.
            
            Expected columns to look for: {column_names}
            
            Rules:
            1. Find the table rows. Each row typically starts with a name.
            2. For each row, identify the person's name and the values for the columns.
            3. Return the results in this exact JSON structure:
            {{
              "structured": [
                {{
                  "name": "Full Name",
                  "values": {{ "column_key": 10000, ... }},
                  "y_top": approximate_y_percentage_top_of_row,
                  "y_bottom": approximate_y_percentage_bottom_of_row
                }}
              ]
            }}
            
            4. 'y_top' and 'y_bottom' should be integers from 0 to 100 representing the vertical position in the image.
            5. If a value is missing or represented by a dash '-', use 0.
            6. Names might be slightly misspelled due to scan quality, extract them as accurately as possible.
            7. Return ONLY the JSON object, no markdown formatting or extra text.
            """

            response = model.generate_content([
                prompt,
                {
                    'mime_type': 'image/png',
                    'data': file_data
                }
            ])

            # Clean the response (sometimes Gemini wraps JSON in markdown blocks)
            text_response = response.text
            if "```json" in text_response:
                text_response = text_response.split("```json")[1].split("```")[0].strip()
            elif "```" in text_response:
                text_response = text_response.split("```")[1].split("```")[0].strip()
            
            try:
                parsed_json = json.loads(text_response)
            except Exception as json_err:
                # Fallback: if it's not valid JSON, try to find the first { and last }
                start = text_response.find('{')
                end = text_response.rfind('}')
                if start != -1 and end != -1:
                    parsed_json = json.loads(text_response[start:end+1])
                else:
                    raise json_err

            output_data = {
                "data": {
                    "structured": parsed_json.get("structured", []),
                    "img_w": img_w,
                    "img_h": img_h
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

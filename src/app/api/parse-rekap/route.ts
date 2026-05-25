import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60; 

// Helper to get image dimensions from Buffer
function getImageDimensions(buffer: Buffer) {
  // Simple PNG dimension reader
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readInt32BE(16);
    const height = buffer.readInt32BE(20);
    return { width, height };
  }
  // Simple JPEG dimension reader
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      const marker = buffer.readUInt16BE(offset);
      offset += 2;
      if (marker === 0xffc0 || marker === 0xffc2) {
        offset += 3;
        const height = buffer.readUInt16BE(offset);
        offset += 2;
        const width = buffer.readUInt16BE(offset);
        return { width, height };
      } else {
        offset += buffer.readUInt16BE(offset);
      }
    }
  }
  return { width: 1000, height: 1000 }; // Fallback
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const columnsStr = formData.get('columns') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { width, height } = getImageDimensions(buffer);
    const base64Data = buffer.toString('base64');
    
    const columns = columnsStr ? JSON.parse(columnsStr) : [];
    const columnNames = columns.map((c: any) => `'${c.label}' (key: ${c.key})`).join(', ');

    const prompt = `
You are a precision payroll document parser. Extract data from this table image into structured JSON.

Expected columns: ${columnNames}

Rules for Extraction:
1. Identify ONLY the data rows (where employee names are). 
2. DO NOT include the table header in any row's coordinates.
3. For each data row:
   - "y_top": The vertical position (0-1000) of the horizontal line IMMEDIATELY ABOVE the employee's name.
   - "y_bottom": The vertical position (0-1000) of the horizontal line IMMEDIATELY BELOW the employee's name.
   - Ensure these coordinates perfectly "box in" the specific row for that employee.
   - DOUBLE CHECK: If the image slice shows the row above, your y_top is too small. Increase it.

4. IMPORTANT: Identify the horizontal order of the data columns in the header from left to right (after the Name column).

5. VALUE EXTRACTION: Extract the exact numerical value present in each cell.
   - Some fields are dual-mapped and may contain either a small count (e.g., 5, 12, 20) or a large monetary amount (e.g., 150000, 300000).
   - Extract EXACTLY the number you see. Do NOT perform any math or conversions.
   - Remove any currency symbols (Rp) and thousands separators. Return as a raw integer.

Return results in this structure:
{
  "detected_column_order": ["key1", "key2", ...],
  "structured": [
    {
      "name": "NAME",
      "values": { "key": 123 },
      "y_top": 250,
      "y_bottom": 280
    }
  ]
}

Return ONLY the JSON object.
`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: file.type || 'image/png'
        }
      }
    ]);

    let textResponse = result.response.text();
    if (textResponse.includes('```json')) {
      textResponse = textResponse.split('```json')[1].split('```')[0].trim();
    } else if (textResponse.includes('```')) {
      textResponse = textResponse.split('```')[1].split('```')[0].trim();
    }

    let parsedJson;
    try {
      parsedJson = JSON.parse(textResponse);
    } catch (e) {
      const start = textResponse.indexOf('{');
      const end = textResponse.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        parsedJson = JSON.parse(textResponse.substring(start, end + 1));
      } else {
        throw new Error('Failed to parse JSON');
      }
    }

    if (parsedJson.structured && Array.isArray(parsedJson.structured)) {
      parsedJson.structured = parsedJson.structured.map((row: any) => {
        const parseCoord = (val: any) => {
          if (val === undefined || val === null) return undefined;
          let num = Number(val);
          if (isNaN(num)) return undefined;
          
          // Gemini is now instructed to return 0-1000 scale.
          // Convert the 0-1000 scale to absolute pixels for the frontend.
          // Fallback: If it somehow returns 0-100 percentage, scale it up.
          if (num <= 100 && num > 0) {
            // It likely gave a percentage anyway
            return Math.round((num / 100) * height);
          }
          
          return Math.round((num / 1000) * height);
        };

        return {
          ...row,
          y_top: parseCoord(row.y_top),
          y_bottom: parseCoord(row.y_bottom),
        };
      });
    }

    return NextResponse.json({
      data: {
        structured: parsedJson.structured || [],
        img_w: width,
        img_h: height
      }
    });

  } catch (error: any) {
    console.error('OCR Error:', error);
    return NextResponse.json({
      error: error.message || 'Internal Error',
      errorType: error.constructor?.name,
      errorDetails: error?.errorDetails ?? error?.cause ?? null,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    }, { status: 500 });
  }
}

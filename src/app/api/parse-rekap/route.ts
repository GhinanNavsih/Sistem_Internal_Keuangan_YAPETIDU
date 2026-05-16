import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const maxDuration = 60; // Allow up to 60 seconds for processing

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const columnsStr = formData.get('columns') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured in .env.local' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');
    
    const columns = columnsStr ? JSON.parse(columnsStr) : [];
    const columnNames = columns.map((c: any) => `'${c.label}' (key: ${c.key})`).join(', ');

    const prompt = `
You are a payroll document parser. Extract data from this table image into structured JSON.

Expected columns to look for: ${columnNames}

Rules:
1. Find the table rows. Each row typically starts with a name.
2. For each row, identify the person's name and the values for the columns.
3. Return the results in this exact JSON structure:
{
  "structured": [
    {
      "name": "Full Name",
      "values": { "column_key": 10000 },
      "y_top": 10,
      "y_bottom": 15
    }
  ]
}

4. 'y_top' and 'y_bottom' should be integers from 0 to 100 representing the approximate vertical percentage position of the row in the image.
5. If a value is missing or represented by a dash '-', use 0.
6. Names might be slightly misspelled due to scan quality, extract them as accurately as possible.
7. Return ONLY the JSON object, no markdown formatting or extra text.
`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    try {
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
      
      // Clean JSON response
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
          throw new Error('Failed to parse JSON response from Gemini');
        }
      }

      return NextResponse.json({
        data: {
          structured: parsedJson.structured || [],
          img_w: 1000, 
          img_h: 1000
        }
      });
    } catch (genError: any) {
      if (genError.message?.includes('404')) {
        // Fetch available models to help debug
        const models = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`)
          .then(res => res.json())
          .catch(() => ({}));
        
        const modelNames = models.models?.map((m: any) => m.name) || [];
        return NextResponse.json({ 
          error: `Model not found. Available models for your key: ${modelNames.join(', ')}` 
        }, { status: 404 });
      }
      throw genError;
    }

  } catch (error: any) {
    console.error('OCR Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

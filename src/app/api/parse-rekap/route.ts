import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // 1. Prepare directories
    const tmpDir = join(process.cwd(), 'tmp');
    await mkdir(tmpDir, { recursive: true });

    // 2. Save uploaded file with correct extension
    const ext = file.name.split('.').pop() || 'pdf';
    const inputPath = join(tmpDir, `rekap_upload.${ext}`);
    const outputPath = join(tmpDir, 'rekap_output.json');

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(inputPath, buffer);

    // 3. Run the Python script using our venv
    const scriptPath = join(process.cwd(), 'scripts', 'parse_rekap.py');
    const pythonPath = join(process.cwd(), 'venv', 'bin', 'python3');
    
    console.log(`Executing: ${pythonPath} ${scriptPath} ${inputPath}`);
    
    try {
      const { stdout, stderr } = await execAsync(`"${pythonPath}" "${scriptPath}" "${inputPath}"`, { timeout: 120000 });
      if (stdout) console.log('Python stdout:', stdout);
      if (stderr) console.warn('Python stderr:', stderr);
    } catch (execErr: any) {
      console.error('Python script error:', execErr.stdout, execErr.stderr);
      return NextResponse.json({ 
        error: 'Python script failed', 
        details: execErr.stderr || execErr.stdout 
      }, { status: 500 });
    }

    // 4. Read the output JSON
    const outputContent = await readFile(outputPath, 'utf-8');
    const parsedData = JSON.parse(outputContent);

    return NextResponse.json({ data: parsedData });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

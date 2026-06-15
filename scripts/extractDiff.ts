import * as fs from 'fs';
import * as path from 'path';

function run() {
  const logPath = '/Users/ghinannavsih/.gemini/antigravity-ide/brain/1287c318-d3cf-45e7-bf2e-eaeb74398360/.system_generated/logs/transcript.jsonl';
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  
  let found = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.includes('diff_block_start') && line.includes('employees/page.tsx') && line.includes('structural_positions')) {
      try {
        const obj = JSON.parse(line);
        if (obj.content) {
          fs.writeFileSync(path.resolve(process.cwd(), 'scripts/step276_diff.txt'), obj.content, 'utf8');
          console.log(`Successfully wrote diff from step ${obj.step_index} to scripts/step276_diff.txt`);
          found = true;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
  }
  if (!found) {
    console.log('Failed to find matching diff line');
  }
}

run();

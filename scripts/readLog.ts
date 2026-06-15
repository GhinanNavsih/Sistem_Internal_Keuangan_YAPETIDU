import * as fs from 'fs';

function run() {
  const logPath = '/Users/ghinannavsih/.gemini/antigravity-ide/brain/1287c318-d3cf-45e7-bf2e-eaeb74398360/.system_generated/logs/transcript.jsonl';
  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.step_index >= 274 && obj.step_index <= 280) {
        console.log(`=== Step ${obj.step_index} (${obj.type}) ===`);
        if (obj.content) {
          console.log(`Content:\n${obj.content}`);
        }
        console.log('='.repeat(60));
      }
    } catch (e) {
      // ignore
    }
  }
}

run();

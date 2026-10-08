const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), '_posts');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
let fixed = 0;
for (const f of files) {
  const fp = path.join(dir, f);
  let txt = fs.readFileSync(fp, 'utf8');
  if (!txt.includes('{{')) continue;
  const lines = txt.split('\n');
  const out = [];
  let i = 0;
  let touched = false;
  while (i < lines.length) {
    const line = lines[i];
    const open = line.match(/^(`{3,})(.*)$/);
    if (open) {
      const fence = open[1];
      const fenceLen = fence.length;
      out.push(line);
      i++;
      const block = [];
      while (i < lines.length) {
        const l = lines[i];
        // close fence: 同行只有 fence(允许后跟空白)
        if (l.match(/^(`{3,})\s*$/)) {
          break;
        }
        block.push(l);
        i++;
      }
      const hasCurly = block.some(l => l.includes('{{'));
      if (hasCurly) {
        out.push('{% raw %}');
        out.push(...block);
        out.push('{% endraw %}');
        touched = true;
      } else {
        out.push(...block);
      }
      if (i < lines.length) {
        out.push(lines[i]);
        i++;
      }
    } else {
      out.push(line);
      i++;
    }
  }
  if (touched) {
    fs.writeFileSync(fp, out.join('\n'), 'utf8');
    fixed++;
    console.log('fixed:', f);
  }
}
console.log(`\nfixed ${fixed} files`);

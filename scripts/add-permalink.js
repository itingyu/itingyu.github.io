const fs = require('fs');
const path = require('path');

// 给 _posts/*.md 加显式 permalink 字段,绕开 github-pages 不加载 _plugins 的限制
// permalink = /notes/<column>/<series>/<slug>/
// 自动剥 series 值外层引号
const dir = '_posts';
let updated = 0, fixed = 0, skipped = 0;

for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
  const fp = path.join(dir, f);
  let txt = fs.readFileSync(fp, 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) { skipped++; continue; }
  const fm = m[1], body = m[2];
  
  // 解析字段(strip 引号)
  const get = (k) => {
    const r = fm.match(new RegExp(`^${k}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'));
    return r ? r[1].trim() : null;
  };
  const column = get('column');
  const series = get('series');
  const slug = get('slug') || f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  
  if (!column || !series) { skipped++; continue; }
  
  // 已有 permalink? 若是错的(URL 含引号或 %22),重写
  const existing = fm.match(/^permalink:\s*(.+)$/m);
  if (existing) {
    const cur = existing[1].trim();
    const correct = `/notes/${encodeURIComponent(column)}/${encodeURIComponent(series)}/${encodeURIComponent(slug)}/`;
    if (cur === correct) { skipped++; continue; }
    // 错的,替换
    const newFm = fm.replace(/^permalink:\s*.+$/m, `permalink: ${correct}`);
    fs.writeFileSync(fp, `---\n${newFm}\n---\n${body}`, 'utf8');
    fixed++;
  } else {
    const permalink = `/notes/${encodeURIComponent(column)}/${encodeURIComponent(series)}/${encodeURIComponent(slug)}/`;
    const newFm = fm + `\npermalink: ${permalink}`;
    fs.writeFileSync(fp, `---\n${newFm}\n---\n${body}`, 'utf8');
    updated++;
  }
}
console.log(`updated: ${updated}, fixed: ${fixed}, skipped: ${skipped}`);

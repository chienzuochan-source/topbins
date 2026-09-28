// Packs the Vite build into one self-contained HTML page (CSS and JS inlined)
// for publishing as a claude.ai artifact. Run after `vite build`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, file) => {
  const css = readFileSync(join(dist, file), 'utf8');
  return `<style>\n${css}\n</style>`;
});

html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('an asset reference was not inlined');

// The artifact host supplies the doctype, html/head/body, charset and viewport.
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body[^>]*>/gi, '')
  .replace(/<meta charset="[^"]*"\s*\/?>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .trim();

mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/top-bins.html', html + '\n');
console.log(`dist-artifact/top-bins.html: ${(html.length / 1024).toFixed(0)} KB`);

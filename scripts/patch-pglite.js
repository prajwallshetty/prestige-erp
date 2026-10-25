const fs = require('fs');
const path = require('path');

function patchDir(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      patchDir(full);
    } else if (f.name.endsWith('.js') || f.name.endsWith('.cjs') || f.name.endsWith('.mjs')) {
      let content = fs.readFileSync(full, 'utf8');
      let changed = false;
      if (content.includes('isFileURI(e)?new URL(e):e')) {
        content = content.replaceAll('isFileURI(e)?new URL(e):e', 'isFileURI(e)?require("url").fileURLToPath(e):e');
        changed = true;
      }
      if (content.includes('isFileURI(filename)?new URL(filename):filename')) {
        content = content.replaceAll('isFileURI(filename)?new URL(filename):filename', 'isFileURI(filename)?require("url").fileURLToPath(filename):filename');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(full, content);
        console.log('Patched:', full);
      }
    }
  }
}

patchDir(path.join(process.cwd(), 'node_modules', '@electric-sql', 'pglite'));
console.log('Done patching pglite.');

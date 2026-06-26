const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = process.argv[2] || 'D:/ADB-TOOLS-V1.0/logo_1_shield.svg';
const outDir = path.join(__dirname, '..', 'build');
const outPath = path.join(outDir, 'icon.png');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const svgBuf = fs.readFileSync(svgPath);

sharp(svgBuf)
  .resize(512, 512)
  .png()
  .toFile(outPath)
  .then(() => {
    console.log('icon.png written to', outPath);
  })
  .catch(err => {
    console.error('sharp convert failed:', err.message);
    process.exit(1);
  });

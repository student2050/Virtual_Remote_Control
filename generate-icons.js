const generateIconHTML = `
<svg xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" style="stop-color:#1a1a3e"/>
      <stop offset="100%" style="stop-color:#0d0d24"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="80" fill="url(#bg)"/>
  <text x="256" y="290" font-size="220" text-anchor="middle" dominant-baseline="central">🚀</text>
</svg>
`;

const sizes = [72, 96, 128, 192, 512];
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate SVG icons as fallback (browsers can use SVG)
sizes.forEach(size => {
    const svgContent = generateIconHTML.replace(/SIZE/g, size);
    const filePath = path.join(iconsDir, `icon-${size}.svg`);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, svgContent);
    }
});

module.exports = { sizes };

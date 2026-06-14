// scripts/build-icons.js
// One-off: convert icons/icon.svg → icons/icon-{16,48,128}.png via sharp.
// Same pattern as page-translator.
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const SVG = path.join(__dirname, "..", "icons", "icon.svg");
const SIZES = [16, 48, 128];

(async () => {
  const svg = fs.readFileSync(SVG);
  for (const size of SIZES) {
    const out = path.join(__dirname, "..", "icons", `icon-${size}.png`);
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log("wrote", out);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

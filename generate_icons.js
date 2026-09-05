const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 计算函数
function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    }
    table[i] = c;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// 创建 PNG chunk
function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(4 + 4 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crcTarget = buf.subarray(4, 8 + len);
  const crcVal = crc32(crcTarget);
  buf.writeUInt32BE(crcVal, 8 + len);
  return buf;
}

// 生成单个尺寸的 PNG
function generateIcon(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // 8 bit
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Deflate
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // No interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Scanlines 数据
  // 每行: 1 字节 filter(0) + size * 4 字节(RGBA)
  const rowLen = 1 + size * 4;
  const rawData = Buffer.alloc(rowLen * size);

  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowLen;
    rawData[rowOffset] = 0; // Filter type 0: None

    for (let x = 0; x < size; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // 绘制圆角矩形背景 (深蓝黑 #131921 亚马逊经典底色)
      let inBounds = true;
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      if (dx < radius && dy < radius) {
        const dist = Math.hypot(dx - radius, dy - radius);
        if (dist > radius) {
          inBounds = false;
        }
      }

      if (!inBounds) {
        // 透明
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
        continue;
      }

      // 背景渐变色 (#1a222d 到 #131921)
      let r = 24, g = 32, b = 44;

      // 绘制中间的橙色采集/购物标记 (#FF9900)
      const arrowMidX = size / 2;
      const arrowHeadY = size * 0.52;
      const arrowTopY = size * 0.24;
      const stemHalfWidth = Math.max(1, size * 0.08);

      const inArrowStem = (Math.abs(x - arrowMidX) <= stemHalfWidth) && (y >= arrowTopY && y <= arrowHeadY);
      const inArrowHead = (y >= arrowHeadY && y <= size * 0.64) && (Math.abs(x - arrowMidX) <= (size * 0.64 - y) * 1.3 + 1);

      // 底部弧形托盘/微笑曲线
      const trayY = size * 0.72;
      const trayThickness = Math.max(1.5, size * 0.08);
      const trayHalfW = size * 0.28;
      const distTrayCenter = Math.abs(x - arrowMidX);
      const curveY = trayY + (distTrayCenter / trayHalfW) * (distTrayCenter / trayHalfW) * (size * 0.08);
      const inTray = distTrayCenter <= trayHalfW && Math.abs(y - curveY) <= trayThickness;

      if (inArrowStem || inArrowHead || inTray) {
        // 亚马逊亮橙色 #FF9900
        r = 255;
        g = 153;
        b = 0;
      }

      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = 255;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const iconBuffer = generateIcon(size);
  const targetPath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(targetPath, iconBuffer);
  console.log(`Generated: ${targetPath} (${iconBuffer.length} bytes)`);
});

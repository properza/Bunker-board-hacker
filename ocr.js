// OCR for the green phosphor displays. Keep operators; never guess a missing sign.
function createDefaultTextTargets() {
  const targets = {};
  for (let row = 0; row < 8; row++) for (const column of ['a', 'b']) {
    targets[`r${row}${column}`] = { x: 15, y: 6, w: 70, h: 32 };
  }
  return targets;
}

function adjustTextTarget(initial, dx, dy, resize) {
  const b = { ...initial };
  if (resize) {
    b.w = Math.max(10, Math.min(100 - b.x, b.w + dx));
    b.h = Math.max(10, Math.min(100 - b.y, b.h + dy));
  } else {
    b.x = Math.max(0, Math.min(100 - b.w, b.x + dx));
    b.y = Math.max(0, Math.min(100 - b.h, b.y + dy));
  }
  return b;
}

function switchCropRect(box, row, target, image) {
  const columnW = box.w / 100 * image.naturalWidth;
  const rowH = box.h / 100 * image.naturalHeight / 8;
  return [box.x / 100 * image.naturalWidth + columnW * target.x / 100,
    box.y / 100 * image.naturalHeight + row * rowH + rowH * target.y / 100,
    columnW * target.w / 100, rowH * target.h / 100];
}

function autoDetectBlackSlots(image, boxes, existingTargets) {
  const targets = existingTargets ? { ...existingTargets } : createDefaultTextTargets();
  if (!image || !boxes) return targets;
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!w || !h) return targets;

  let pixels = null;
  if (image.data && (ArrayBuffer.isView(image.data) || image.data.BYTES_PER_ELEMENT || typeof image.data.length === 'number')) {
    pixels = image.data;
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    pixels = ctx.getImageData(0, 0, w, h).data;
  } else {
    return targets;
  }

  for (const col of ['a', 'b']) {
    const box = boxes[`box-col-${col}`];
    if (!box) continue;
    const colX = (box.x / 100) * w;
    const colY = (box.y / 100) * h;
    const colW = (box.w / 100) * w;
    const colH = (box.h / 100) * h;
    const rowH = colH / 8;

    const detected = [];

    for (let row = 0; row < 8; row++) {
      const swIndex = 7 - row;
      const key = `r${swIndex}${col}`;
      const cellX = Math.round(colX);
      const cellY = Math.round(colY + row * rowH);
      const cellW = Math.round(colW);
      const cellH = Math.round(rowH);

      let minGX = cellW, maxGX = -1, minGY = cellH, maxGY = -1, greenCount = 0;
      const yLimit = Math.min(cellY + Math.round(cellH * 0.48), h);
      const yStart = Math.min(cellY + Math.max(1, Math.round(cellH * 0.03)), h);

      for (let y = yStart; y < yLimit; y++) {
        const rowOffset = y * (w * 4);
        const xLimit = Math.min(cellX + cellW, w);
        const xStart = Math.max(0, cellX);

        for (let x = xStart; x < xLimit; x++) {
          const p = rowOffset + (x * 4);
          const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
          const isGreen = g >= 80 && (g - r) >= 6 && (g - b) >= 3;
          const relX = x - cellX, relY = y - cellY;

          if (isGreen) {
            greenCount++;
            if (relX < minGX) minGX = relX;
            if (relX > maxGX) maxGX = relX;
            if (relY < minGY) minGY = relY;
            if (relY > maxGY) maxGY = relY;
          }
        }
      }

      if (greenCount >= 6) {
        // Exactly 1px padding around the detected green text
        const pad = 1;
        const targetPixelX = Math.max(0, minGX - pad);
        const targetPixelY = Math.max(0, minGY - pad);
        const targetPixelW = Math.min(cellW - targetPixelX, (maxGX - minGX + 1) + (2 * pad));
        const targetPixelH = Math.min(cellH - targetPixelY, (maxGY - minGY + 1) + (2 * pad));

        const targetX = Math.round((targetPixelX / cellW) * 1000) / 10;
        const targetY = Math.round((targetPixelY / cellH) * 1000) / 10;
        const targetW = Math.round((targetPixelW / cellW) * 1000) / 10;
        const targetH = Math.round((targetPixelH / cellH) * 1000) / 10;

        const slot = { x: targetX, y: targetY, w: targetW, h: targetH, hasText: true, greenCount };
        targets[key] = slot;
        detected.push(slot);
      } else {
        targets[key] = { hasText: false };
      }
    }

    let medianX = col === 'a' ? 14 : 18;
    let medianY = 6;
    let medianW = 68;
    let medianH = 28;

    const textSlots = detected.filter(d => d.hasText);
    if (textSlots.length > 0) {
      const getMed = (arr, prop) => {
        const s = arr.map(a => a[prop]).sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };
      medianX = getMed(textSlots, 'x');
      medianY = getMed(textSlots, 'y');
      medianW = getMed(textSlots, 'w');
      medianH = getMed(textSlots, 'h');
    }

    for (let row = 0; row < 8; row++) {
      const swIndex = 7 - row;
      const key = `r${swIndex}${col}`;
      if (!targets[key] || !targets[key].hasText) {
        targets[key] = { x: medianX, y: medianY, w: medianW, h: medianH, hasText: false };
      } else {
        const { x, y, w, h } = targets[key];
        targets[key] = { x, y, w, h, hasText: true };
      }
    }
  }

  return targets;
}
function cleanSwitchToken(text) {
  const token = (text || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[×xX]/g, "*")
    .replace(/[÷\\]/g, "/")
    .replace(/[−–—_]/g, "-");
  return /^(?:[*/]2|[+-](?:10|20|40|50|60|80|100|150))$/.test(token)
    ? token
    : "";
}

function cleanGoalToken(text) {
  const token = (text || "").trim().replace(/\s+/g, "");
  return /^\d{1,5}$/.test(token) ? Number(token) : "";
}

// Separate the leading symbol from the digits using the empty column between them.
function detectSwitchOperator(mask, width, height) {
  const columns = Array.from({ length: width }, (_, x) => {
    for (let y = 0; y < height; y++) if (mask[y * width + x]) return true;
    return false;
  });
  const first = columns.indexOf(true);
  if (first < 0) return null;
  let end = first;
  while (end + 1 < width && columns[end + 1]) end++;
  let digitX = end + 1;
  while (digitX < width && !columns[digitX]) digitX++;
  if (digitX >= width || digitX - end < 2) return null;
  const points = [];
  let top = height,
    bottom = -1,
    digitTop = height,
    digitBottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = first; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x <= end) {
        points.push([x, y]);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      } else {
        digitTop = Math.min(digitTop, y);
        digitBottom = Math.max(digitBottom, y);
      }
    }
  if (points.length < 2 || digitBottom < digitTop) return null;
  const w = end - first + 1,
    h = bottom - top + 1,
    digitH = digitBottom - digitTop + 1;
  const meanX = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const meanY = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  let xx = 0,
    yy = 0,
    xy = 0;
  for (const [x, y] of points) {
    xx += (x - meanX) ** 2;
    yy += (y - meanY) ** 2;
    xy += (x - meanX) * (y - meanY);
  }
  const correlation = xy / Math.sqrt(xx * yy || 1);
  let kind = null;
  if (w / h >= 1.8 && h <= digitH * 0.45) kind = "-";
  else if (correlation < -0.65 && h >= digitH * 0.65 && w / h < 0.95)
    kind = "/";
  else if (
    w / h >= 0.55 &&
    w / h <= 1.65 &&
    h <= digitH * 0.85 &&
    h >= digitH * 0.25 &&
    Math.abs(meanY - (digitTop + digitBottom) / 2) < digitH * 0.35
  )
    kind = "compact";
  return kind ? { kind, digitX } : null;
}

function switchTokenFromShape(text, operator) {
  if (!operator) return cleanSwitchToken(text);
  const digits = (text || "").trim().replace(/\s+/g, "");
  if (!/^\d+$/.test(digits)) return "";
  const sign =
    operator.kind === "compact" ? (digits === "2" ? "*" : "+") : operator.kind;
  return cleanSwitchToken(sign + digits);
}

// Deterministic switch classifier for SCUM Bunker switches from green pixel mask
function classifySwitchFromMask(mask, width, height) {
  if (!mask || width <= 0 || height <= 0) return "";

  const colOccupied = new Array(width).fill(0);
  let totalPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        colOccupied[x]++;
        totalPixels++;
      }
    }
  }
  if (totalPixels < 10) return "";

  let first = 0;
  while (first < width && colOccupied[first] === 0) first++;
  if (first >= width) return "";

  let opEnd = first;
  while (opEnd + 1 < width && colOccupied[opEnd + 1] > 0) opEnd++;

  let digitStart = opEnd + 1;
  while (digitStart < width && colOccupied[digitStart] === 0) digitStart++;
  if (digitStart >= width) return "";

  // Operator shape detection
  const opWidth = opEnd - first + 1;
  let opTop = height, opBottom = -1;
  const opPoints = [];
  for (let y = 0; y < height; y++) {
    for (let x = first; x <= opEnd; x++) {
      if (mask[y * width + x]) {
        opPoints.push([x, y]);
        if (y < opTop) opTop = y;
        if (y > opBottom) opBottom = y;
      }
    }
  }
  const opH = opBottom - opTop + 1;
  const meanX = opPoints.reduce((s, p) => s + p[0], 0) / opPoints.length;
  const meanY = opPoints.reduce((s, p) => s + p[1], 0) / opPoints.length;
  let xx = 0, yy = 0, xy = 0;
  for (const [x, y] of opPoints) {
    xx += (x - meanX) ** 2;
    yy += (y - meanY) ** 2;
    xy += (x - meanX) * (y - meanY);
  }
  const corr = xy / Math.sqrt(xx * yy || 1);

  let op = null;
  if (corr < -0.55 && opH > opWidth * 0.8) {
    op = "/";
  } else if (opWidth / opH >= 1.6 && opH <= 5) {
    op = "-";
  } else {
    op = "compact";
  }

  // Segment isolated digit glyphs separated by blank columns
  const glyphs = [];
  let inGlyph = false;
  let gStart = -1;
  for (let x = digitStart; x < width; x++) {
    let colHasPixel = false;
    for (let y = 0; y < height; y++) {
      if (mask[y * width + x]) { colHasPixel = true; break; }
    }
    if (colHasPixel) {
      if (!inGlyph) { inGlyph = true; gStart = x; }
    } else {
      if (inGlyph) {
        glyphs.push({ startX: gStart, endX: x - 1, width: x - gStart });
        inGlyph = false;
      }
    }
  }
  if (inGlyph) {
    glyphs.push({ startX: gStart, endX: width - 1, width: width - gStart });
  }

  if (glyphs.length === 0) return "";

  // Single digit glyph in bunker puzzle is always '2' (*2 or /2)
  if (glyphs.length === 1) {
    const finalOp = (op === "/" ? "/" : "*");
    return `${finalOp}2`;
  }

  const sign = (op === "-" ? "-" : "+");

  // Three digit glyphs: 100 or 150
  if (glyphs.length >= 3) {
    const g2 = glyphs[1];
    let rowMidPixels = 0;
    const midY = Math.floor(height / 2);
    for (let x = g2.startX; x <= g2.endX; x++) {
      if (mask[midY * width + x]) rowMidPixels++;
    }
    return rowMidPixels >= 3 ? `${sign}150` : `${sign}100`;
  }

  // Two digit glyphs: 10, 20, 40, 50, 60, 80
  const g1 = glyphs[0];
  let minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = g1.startX; x <= g1.endX; x++) {
      if (mask[y * width + x]) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const gw = g1.endX - g1.startX + 1;
  const gh = maxY - minY + 1;
  const at = (rx, ry) => {
    const x = g1.startX + Math.round(rx * (gw - 1));
    const y = minY + Math.round(ry * (gh - 1));
    return mask[y * width + x] === 1;
  };

  const topL = at(0.15, 0.25);
  const topR = at(0.85, 0.25);
  const botL = at(0.15, 0.75);
  const botR = at(0.85, 0.75);
  const lowerDiagR = at(0.85, 0.60);

  let d1 = "8";
  if (!botL && !botR) d1 = "1";
  else if (topR && !topL && !lowerDiagR) d1 = "2";
  else if (topL && !topR && botL && botR) d1 = "6";
  else if (topL && topR && botL && botR) d1 = "8";
  else if (topL && topR && !botL && botR) d1 = "4";
  else if (topL && !topR && !botL && botR) d1 = "5";
  else if (!topR) d1 = "6";
  else if (!botL) d1 = "2";

  return cleanSwitchToken(`${sign}${d1}0`);
}

function validateVisionResult(result) {
  for (const key of ["input", "goalA", "goalB"]) {
    if (
      !Number.isInteger(result[key]) ||
      result[key] < 0 ||
      result[key] > 99999
    ) {
      throw new Error(
        `AI อ่าน ${key} ไม่ชัด กรุณาตรวจภาพหรือใช้โหมด Tesseract`,
      );
    }
  }
  if (!Array.isArray(result.switches) || result.switches.length !== 8) {
    throw new Error("AI อ่านสวิตช์ไม่ครบ 8 แถว กรุณาสแกนใหม่");
  }
  const rows = new Set();
  for (const sw of result.switches) {
    if (
      !sw ||
      !Number.isInteger(sw.row) ||
      sw.row < 1 ||
      sw.row > 8 ||
      rows.has(sw.row)
    ) {
      throw new Error("AI ระบุแถวสวิตช์ไม่ถูกต้อง กรุณาสแกนใหม่");
    }
    rows.add(sw.row);
    for (const col of ["a", "b"]) {
      if (
        typeof sw[col] !== "string" ||
        (sw[col] !== "" && cleanSwitchToken(sw[col]) !== sw[col])
      ) {
        throw new Error(
          `AI อ่าน SW ${sw.row} ${col.toUpperCase()} ไม่ชัด กรุณาตรวจภาพ`,
        );
      }
    }
  }
}

function extractCleanCanvas(sx, sy, sw, sh, mode = 0, image = rawImage) {
  if (!image || sw <= 0 || sh <= 0) return null;
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round(sw));
  crop.height = Math.max(1, Math.round(sh));
  const ctx = crop.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
  const pixels = ctx.getImageData(0, 0, crop.width, crop.height);
  const mask = new Uint8Array(crop.width * crop.height);
  for (let p = 0; p < mask.length; p++) {
    const [r, g, b] = pixels.data.subarray(p * 4, p * 4 + 3);
    // Relative green contrast rejects yellow guide frames and pink switch lamps.
    mask[p] =
      g >= (mode ? 85 : 120) &&
      g - r >= (mode ? 6 : 12) &&
      g - b >= (mode ? 3 : 8)
        ? 1
        : 0;
  }

  // Connected components remove isolated noise and large annotation borders.
  const seen = new Uint8Array(mask.length);
  const kept = new Uint8Array(mask.length);
  let count = 0,
    minX = crop.width,
    minY = crop.height,
    maxX = -1,
    maxY = -1;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let x0 = crop.width,
      y0 = crop.height,
      x1 = 0,
      y1 = 0;
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i],
        x = p % crop.width,
        y = Math.floor(p / crop.width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy,
            n = ny * crop.width + nx;
          if (nx < 0 || ny < 0 || nx >= crop.width || ny >= crop.height)
            continue;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            queue.push(n);
          }
        }
    }
    if (queue.length < 2) continue;
    if (
      (x1 - x0 + 1 > crop.width * 0.9 || y1 - y0 + 1 > crop.height * 0.9) &&
      (x0 === 0 || y0 === 0 || x1 === crop.width - 1 || y1 === crop.height - 1)
    )
      continue;
    for (const p of queue) kept[p] = 1;
    count += queue.length;
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y1);
  }
  for (let p = 0; p < kept.length; p++) {
    const v = kept[p] ? 0 : 255;
    pixels.data.set([v, v, v, 255], p * 4);
  }
  ctx.putImageData(pixels, 0, 0);
  const output = document.createElement("canvas");
  const inkW = Math.max(1, maxX - minX + 1),
    inkH = Math.max(1, maxY - minY + 1);
  const scale = Math.min(12, Math.max(3, Math.ceil(64 / inkH)));
  output.width = inkW * scale + 40;
  output.height = inkH * scale + 40;
  const out = output.getContext("2d");
  out.fillStyle = "white";
  out.fillRect(0, 0, output.width, output.height);
  out.imageSmoothingEnabled = false;
  if (count)
    out.drawImage(
      crop,
      minX,
      minY,
      inkW,
      inkH,
      20,
      20,
      inkW * scale,
      inkH * scale,
    );
  const operator = detectSwitchOperator(kept, crop.width, crop.height);
  let digitsCanvas = null;
  if (operator) {
    digitsCanvas = document.createElement("canvas");
    const digitW = maxX - operator.digitX + 1;
    digitsCanvas.width = digitW * scale + 40;
    digitsCanvas.height = output.height;
    const digitCtx = digitsCanvas.getContext("2d");
    digitCtx.fillStyle = "white";
    digitCtx.fillRect(0, 0, digitsCanvas.width, digitsCanvas.height);
    digitCtx.imageSmoothingEnabled = false;
    digitCtx.drawImage(
      crop,
      operator.digitX,
      minY,
      digitW,
      inkH,
      20,
      20,
      digitW * scale,
      inkH * scale,
    );
  }
  const classifiedToken = classifySwitchFromMask(kept, crop.width, crop.height);
  return {
    canvas: output,
    digitsCanvas,
    operator,
    classifiedToken,
    count,
    fillRatio: count / mask.length,
    inkW,
    inkH,
  };
}

let tesseractWorker = null;
async function getTesseractWorker() {
  if (!tesseractWorker) {
    updateProgress(2, "กำลังโหลด Tesseract OCR…");
    tesseractWorker = Tesseract.createWorker("eng")
      .then(async (worker) => {
        try {
          await worker.setParameters({ user_defined_dpi: "300" });
          return worker;
        } catch (err) {
          await worker.terminate();
          throw err;
        }
      })
      .catch((err) => {
        tesseractWorker = null;
        throw err;
      });
  }
  return tesseractWorker;
}

async function recognizeDisplay(worker, rect, isSwitch, image) {
  const crops = [0, 1].map((mode) => extractCleanCanvas(...rect, mode, image));
  // Blank only when both masks contain virtually no green strokes.
  if (crops.every((c) => c.count < 3)) {
    return { value: "", certain: isSwitch, preview: crops[1].canvas };
  }
  if (isSwitch) {
    for (const crop of crops) {
      if (crop.classifiedToken) {
        return { value: crop.classifiedToken, certain: true, preview: crop.canvas };
      }
    }
  }
  const votes = new Map();
  let best = "";
  for (let pass = 0; pass < 3; pass++) {
    const crop = crops[pass === 0 ? 0 : 1];
    const useShape = isSwitch && crop.operator && crop.digitsCanvas;
    await worker.setParameters({
      tessedit_char_whitelist:
        isSwitch && !useShape ? "0123456789+-/*xX" : "0123456789",
      tessedit_pageseg_mode:
        pass === 2 ? Tesseract.PSM.SINGLE_WORD : Tesseract.PSM.SINGLE_LINE,
    });
    const { data } = await worker.recognize(
      useShape ? crop.digitsCanvas : crop.canvas,
    );
    const value = isSwitch
      ? switchTokenFromShape(data.text, useShape ? crop.operator : null)
      : cleanGoalToken(data.text);
    if (value === "") continue;
    const entry = votes.get(value) || { count: 0, confidence: 0 };
    entry.count++;
    entry.confidence = Math.max(entry.confidence, Number(data.confidence) || 0);
    votes.set(value, entry);
  }
  const ranked = [...votes].sort(
    (a, b) => b[1].count - a[1].count || b[1].confidence - a[1].confidence,
  );
  if (ranked.length) best = ranked[0][0];
  const certain =
    ranked.length === 1 &&
    ranked[0][1].count >= 2 &&
    ranked[0][1].confidence >= 65;
  return { value: best, certain, preview: crops[1].canvas };
}

function clearOcrReview() {
  document.querySelectorAll(".ocr-review").forEach((el) => {
    el.classList.remove("ocr-review");
    el.removeAttribute("title");
  });
  document.getElementById("ocr-review-list").replaceChildren();
}

function showOcrReview(field, label, result) {
  field.classList.add("ocr-review");
  field.title = "OCR อ่านไม่ชัด กรุณาตรวจเทียบภาพและแก้ไข";
  const item = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-btn";
  button.textContent = `${label}: ${result.value === "" ? "อ่านไม่ได้" : result.value} — ตรวจแก้`;
  button.onclick = () => field.focus();
  const img = document.createElement("img");
  img.src = result.preview.toDataURL();
  img.alt = `ภาพข้อความ ${label}`;
  img.style.cssText =
    "max-width:100%;height:48px;object-fit:contain;background:white";
  item.append(button, img);
  document.getElementById("ocr-review-list").append(item);
}

let ocrScanning = false;
async function scanWithTesseract() {
  if (ocrScanning) return;
  ocrScanning = true;
  const btn = document.getElementById("btn-scan");
  btn.disabled = true;
  clearOcrReview();
  document.getElementById("solution-box").className = "";
  document.getElementById("solution-box").style.display = "none";
  for (let i = 0; i < 8; i++) {
    document.getElementById(`l${i}`).className = "led";
    document.getElementById(`row-${i}`).classList.remove("active-on");
    document.getElementById(`tag-${i}`).innerText = "[ปิด / OFF]";
  }
  // Snapshot the image and frames so dragging during a scan cannot mix regions.
  const image = rawImage,
    boxes = JSON.parse(JSON.stringify(currentBoxes));
  const targets = autoDetectBlackSlots(image, boxes, currentTextTargets);
  const jobs = [];
  for (const [boxId, fieldId, label] of [
    ["box-goala", "ga", "Goal A"],
    ["box-goalb", "gb", "Goal B"],
    ["box-input", "inp", "Input"],
  ]) {
    const b = boxes[boxId];
    // Slight inset avoids bounding box border strokes while keeping wide numbers intact
    jobs.push({
      fieldId,
      label,
      isSwitch: false,
      rect: [
        ((b.x + b.w * 0.02) / 100) * image.naturalWidth,
        ((b.y + b.h * 0.02) / 100) * image.naturalHeight,
        ((b.w * 0.96) / 100) * image.naturalWidth,
        ((b.h * 0.96) / 100) * image.naturalHeight,
      ],
    });
  }
  for (const column of ["a", "b"]) {
    const b = boxes[`box-col-${column}`];
    for (let row = 0; row < 8; row++)
      jobs.push({
        fieldId: `r${7 - row}${column}`,
        label: `SW ${8 - row} ${column.toUpperCase()}`,
        isSwitch: true,
        rect: switchCropRect(b, row, targets[`r${7 - row}${column}`], image),
      });
  }
  // Do not leave values from an earlier image when OCR fails.
  for (const job of jobs) document.getElementById(job.fieldId).value = "";
  try {
    const worker = await getTesseractWorker();
    const results = [];
    for (let i = 0; i < jobs.length; i++) {
      updateProgress(
        5 + (90 * i) / jobs.length,
        `กำลังอ่าน ${jobs[i].label} (${i + 1}/${jobs.length})…`,
      );
      results.push(
        await recognizeDisplay(worker, jobs[i].rect, jobs[i].isSwitch, image),
      );
    }
    if (rawImage !== image)
      throw new Error("รูปภาพเปลี่ยนระหว่างสแกน กรุณาสแกนรูปใหม่อีกครั้ง");
    let uncertain = 0;
    results.forEach((result, i) => {
      const job = jobs[i],
        field = document.getElementById(job.fieldId);
      field.value = result.value;
      if (!result.certain) {
        uncertain++;
        showOcrReview(field, job.label, result);
      }
    });
    updateProgress(
      100,
      uncertain
        ? `มี ${uncertain} ช่องที่ต้องตรวจสอบ (กรอบสีเหลือง) ตรวจแก้แล้วกด CALCULATE BYPASS`
        : "อ่านค่าเสร็จแล้ว กำลังคำนวณ…",
    );
    ocrStatus.style.color = uncertain ? "var(--yellow)" : "var(--green)";
    if (!uncertain) solve();
  } catch (err) {
    console.error(err);
    ocrStatus.textContent = `OCR: ${err.message}`;
    ocrStatus.style.color = "var(--red)";
  } finally {
    btn.disabled = false;
    ocrScanning = false;
    document.getElementById("pbar-container").style.display = "none";
  }
}

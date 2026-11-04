const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("ocr.js", "utf8");

function setup(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  vm.runInContext(source, context);
  return context;
}

test('individual targets move and resize within their row and map to OCR image coordinates', () => {
  const ctx = setup();
  const targets = ctx.createDefaultTextTargets();
  assert.equal(Object.keys(targets).length, 16);
  const moved = ctx.adjustTextTarget(targets.r6b, 10, 20, false);
  assert.equal(moved.x, 25); assert.equal(moved.y, 26);
  assert.equal(targets.r6a.x, 15); assert.equal(targets.r6b.x, 15);
  const image = { naturalWidth: 1000, naturalHeight: 800 };
  const box = { x: 10, y: 10, w: 20, h: 80 };
  assert.deepEqual(Array.from(ctx.switchCropRect(box, 1, moved, image)), [150, 180.8, 140, 25.6]);
  const resized = ctx.adjustTextTarget(moved, 200, 200, true);
  assert.equal(resized.w, 75); assert.equal(resized.h, 74);
  const edge = ctx.adjustTextTarget(resized, -200, 200, false);
  assert.equal(edge.x, 0); assert.equal(edge.y, 26);
  const small = ctx.adjustTextTarget(resized, -200, -200, true);
  assert.equal(small.w, 10); assert.equal(small.h, 10);
});

test('operator shapes from the supplied review screenshot resolve *2, *2, +60 and +20', () => {
  const ctx = setup();
  const fixtures = JSON.parse(fs.readFileSync('tests/operator-screenshot.json', 'utf8').replace(/^\uFEFF/, ''));
  for (const fixture of fixtures) {
    const mask = Uint8Array.from(fixture.rows.join(''), v => Number(v));
    const operator = ctx.detectSwitchOperator(mask, fixture.rows[0].length, fixture.rows.length);
    assert.ok(operator, fixture.expected);
    assert.equal(ctx.switchTokenFromShape(fixture.expected.slice(1), operator), fixture.expected);
  }
});

test('clear minus and slash remain negative and division; missing symbols are not defaulted', () => {
  const ctx = setup();
  const build = symbol => {
    const mask = new Uint8Array(30 * 20);
    for (const [x, y] of symbol) mask[y * 30 + x] = 1;
    for (let y = 4; y < 16; y++) for (let x = 18; x < 23; x++) mask[y * 30 + x] = 1;
    return ctx.detectSwitchOperator(mask, 30, 20);
  };
  const minus = build(Array.from({length: 8}, (_, i) => [3 + i, 9]));
  assert.equal(minus.kind, '-');
  assert.equal(ctx.switchTokenFromShape('20', minus), '-20');
  const slash = build(Array.from({length: 12}, (_, i) => [10 - Math.floor(i / 2), 4 + i]));
  assert.equal(slash.kind, '/');
  assert.equal(ctx.switchTokenFromShape('2', slash), '/2');
  assert.equal(ctx.switchTokenFromShape('', {kind:'compact'}), '');
  assert.equal(ctx.switchTokenFromShape('2', null), '');
});

test('compact symbol plus digit-only OCR resolves unreadable multiplication and incorrect minus', async () => {
  const ctx = setup({ Tesseract: { PSM: { SINGLE_LINE: 7, SINGLE_WORD: 8 } } });
  vm.runInContext("extractCleanCanvas = () => ({ count: 30, canvas: {}, digitsCanvas: {}, operator: {kind: 'compact'} })", ctx);
  for (const [digits, expected] of [['2', '*2'], ['20', '+20'], ['60', '+60']]) {
    const result = await ctx.recognizeDisplay({ setParameters: async () => {},
      recognize: async () => ({ data: { text: digits, confidence: 90 } }) }, [0,0,50,20], true, {});
    assert.equal(result.value, expected);
    assert.equal(result.certain, true);
  }
});

test("preserves exact operations and rejects missing signs or guessed numbers", () => {
  const ctx = setup();
  for (const text of ["/ 2", "*2", "-20", "+60", "-10", "+150"]) {
    assert.equal(ctx.cleanSwitchToken(text), text.replace(/\s/g, ""));
  }
  assert.equal(ctx.cleanSwitchToken("×2"), "*2");
  assert.equal(ctx.cleanSwitchToken("−60"), "-60");
  for (const text of [
    "2",
    "20",
    "7/2",
    "+19",
    "-6O",
    "12",
    "noise",
    "",
    "+0",
  ]) {
    assert.equal(ctx.cleanSwitchToken(text), "");
  }
  assert.equal(ctx.cleanGoalToken("2 80\n"), 280);
  assert.equal(ctx.cleanGoalToken("0"), 0);
  assert.equal(ctx.cleanGoalToken("2O0"), "");
  assert.equal(ctx.cleanGoalToken("-20"), "");
});

test("AI output must contain all eight distinct rows and readable values", () => {
  const ctx = setup();
  const data = {
    input: 200,
    goalA: 20,
    goalB: 280,
    switches: Array.from({ length: 8 }, (_, i) => ({
      row: i + 1,
      a: "/2",
      b: "",
    })),
  };
  ctx.validateVisionResult(data);
  for (const mutate of [
    (d) => {
      d.goalA = null;
    },
    (d) => {
      d.switches.pop();
    },
    (d) => {
      d.switches[0].row = 2;
    },
    (d) => {
      d.switches[0].a = "20";
    },
    (d) => {
      d.switches[0].b = null;
    },
  ]) {
    const invalid = structuredClone(data);
    mutate(invalid);
    assert.throws(() => ctx.validateVisionResult(invalid));
  }
});

test("OCR requires repeated valid readings, keeps disagreement for review, recognizes blank slots", async () => {
  const ctx = setup({ Tesseract: { PSM: { SINGLE_LINE: 7, SINGLE_WORD: 8 } } });
  vm.runInContext(
    "extractCleanCanvas = () => ({ count: 30, canvas: {} })",
    ctx,
  );
  const worker = (texts) => ({
    setParameters: async () => {},
    recognize: async () => ({ data: { text: texts.shift(), confidence: 85 } }),
  });
  const rect = [0, 0, 50, 20];
  let result = await ctx.recognizeDisplay(
    worker(["-20", "-20", "-20"]),
    rect,
    true,
    {},
  );
  assert.equal(result.value, "-20");
  assert.equal(result.certain, true);
  result = await ctx.recognizeDisplay(
    worker(["/2", "*2", "/2"]),
    rect,
    true,
    {},
  );
  assert.equal(result.certain, false);
  result = await ctx.recognizeDisplay(worker(["20", "", "20"]), rect, true, {});
  assert.equal(result.value, "");
  assert.equal(result.certain, false);
  result = await ctx.recognizeDisplay(worker(["0", "0", "0"]), rect, false, {});
  assert.equal(result.value, 0);
  assert.equal(result.certain, true);
  vm.runInContext("extractCleanCanvas = () => ({ count: 0, canvas: {} })", ctx);
  assert.equal(
    (await ctx.recognizeDisplay(worker([]), rect, true, {})).certain,
    true,
  );
  assert.equal(
    (await ctx.recognizeDisplay(worker([]), rect, false, {})).certain,
    false,
  );
});

test("green mask keeps small minus strokes and drops yellow, pink and annotation borders", () => {
  const width = 30,
    height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, color) => data.set([...color, 255], (y * width + x) * 4);
  // A small minus sign, a glyph, a single noise pixel and unrelated equipment.
  for (let x = 4; x < 9; x++) paint(x, 9, [160, 240, 160]);
  for (let y = 6; y < 13; y++) paint(14, y, [160, 240, 160]);
  paint(24, 4, [160, 240, 160]);
  for (let x = 0; x < width; x++) paint(x, 0, [0, 255, 0]);
  for (let y = 1; y < height; y++) paint(0, y, [0, 255, 0]);
  for (let y = 5; y < 16; y++) {
    paint(20, y, [255, 255, 0]);
    paint(22, y, [255, 190, 200]);
  }
  const createCanvas = () => {
    const canvas = {};
    canvas.getContext = () => ({
      drawImage() {},
      fillRect() {},
      getImageData: () => ({ data: data.slice() }),
      putImageData() {},
    });
    return canvas;
  };
  const ctx = setup({ document: { createElement: createCanvas } });
  const result = ctx.extractCleanCanvas(0, 0, width, height, 0, {});
  assert.equal(result.count, 12);
  assert.equal(result.inkW, 11);
  assert.equal(result.inkH, 7);
  assert.ok(result.canvas.height >= 64);
});

test("page loads OCR module and example maps attached screenshot from SW8 to SW1", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.includes('<script src="ocr.js"></script>'));
  const elements = new Map();
  function element(id) {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        style: { removeProperty() {} },
        classList: { remove() {}, add() {} },
        addEventListener() {},
        replaceChildren() {},
      });
    return elements.get(id);
  }
  const ctx = setup({
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { addEventListener() {} },
    localStorage: { getItem: () => "" },
  });
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(inline, ctx);
  ctx.loadExampleData();
  assert.equal(element("inp").value, "200");
  assert.equal(element("ga").value, "20");
  assert.equal(element("gb").value, "280");
  assert.equal(element("r7a").value, "/2");
  assert.equal(element("r0a").value, "-60");
  assert.equal(element("r3a").value, "");
  assert.equal(element("r3b").value, "+60");
  assert.equal(ctx.solve(), true);
});

test("autoDetectBlackSlots detects active text windows and aligns empty switches to column median", () => {
  const ctx = setup();
  const w = 200, h = 400;
  const data = new Uint8ClampedArray(w * h * 4);
  // Place green text on row 0 of Column A (Y=15..25, X=15..35)
  for (let y = 15; y < 25; y++) {
    for (let x = 15; x < 35; x++) {
      const p = (y * w + x) * 4;
      data[p] = 20; data[p + 1] = 200; data[p + 2] = 20; data[p + 3] = 255;
    }
  }
  const mockImg = { naturalWidth: w, naturalHeight: h, data };
  const boxes = {
    'box-col-a': { x: 5, y: 2, w: 25, h: 80 },
    'box-col-b': { x: 32, y: 2, w: 25, h: 80 }
  };
  const targets = ctx.autoDetectBlackSlots(mockImg, boxes);
  assert.ok(targets.r7a.x >= 0 && targets.r7a.w > 0, "r7a text target detected");
  assert.equal(targets.r7a.hasText, true, "r7a has green text detected");
  assert.equal(targets.r6a.hasText, false, "empty r6a marked as no green text");
  assert.equal(targets.r6a.x, targets.r7a.x, "empty r6a inherits median x");
  assert.equal(targets.r6a.y, targets.r7a.y, "empty r6a inherits median y");
  // 1px padding calculation check:
  // cell w=50, h=40; green bounds relX: [5, 24], relY: [7, 16]
  // with pad=1: pixelX=4 (8%), pixelY=6 (15%), pixelW=22 (44%), pixelH=12 (30%)
  assert.equal(targets.r7a.x, 8);
  assert.equal(targets.r7a.y, 15);
  assert.equal(targets.r7a.w, 44);
  assert.equal(targets.r7a.h, 30);
});

test("classifySwitchFromMask accurately identifies SCUM switch tokens from pixel masks", () => {
  const ctx = setup();
  // Empty returns blank
  assert.equal(ctx.classifySwitchFromMask(new Uint8Array(100), 10, 10), "");

  const createMask = (rows) => {
    const w = rows[0].length, h = rows.length;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (rows[y][x] === "1" || rows[y][x] === "#") mask[y * w + x] = 1;
      }
    }
    return { mask, w, h };
  };

  // Real in-game -20
  const minus20 = createMask([
    "000000000000000000000000000000000000",
    "000000000000000000011111100011111000",
    "000000000000000000111111110111111110",
    "000000000000000000111000110110001110",
    "000000000000000000000011110110001110",
    "011111111000000000000111100110001110",
    "011111111000000000000111000110001110",
    "000000000000000000001110000110001110",
    "000000000000000000011100000110001110",
    "000000000000000000111111100111111110",
    "000000000000000000111111110111111100",
    "000000000000000000011111100011111000",
    "000000000000000000000000000000000000"
  ]);
  assert.equal(ctx.classifySwitchFromMask(minus20.mask, minus20.w, minus20.h), "-20");

  // Real in-game +80
  const plus80 = createMask([
    "000000000000000000000000000000000000",
    "000000000000000000011111100011111000",
    "000000000000000000111111110111111110",
    "000111000000000000111000110110001110",
    "000111000000000000111000110110001110",
    "011111110000000000111111110110001110",
    "011111110000000000111111110110001110",
    "000111000000000000111000110110001110",
    "000111000000000000111000110110001110",
    "000000000000000000111111110111111110",
    "000000000000000000011111100011111000",
    "000000000000000000000000000000000000"
  ]);
  assert.equal(ctx.classifySwitchFromMask(plus80.mask, plus80.w, plus80.h), "+80");

  // Real in-game *2
  const mult2 = createMask([
    "000000000000000000000000000",
    "000000000000000000001111100",
    "000000000000000000111111110",
    "001110110000000000010000110",
    "000111110000000000000001110",
    "011111111000000000000011100",
    "011111111000000000000111000",
    "001111110000000000001110000",
    "000110110000000000111100000",
    "000000000000000000111111110",
    "000000000000000000111111110",
    "000000000000000000000000000"
  ]);
  assert.equal(ctx.classifySwitchFromMask(mult2.mask, mult2.w, mult2.h), "*2");
});

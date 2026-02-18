const CHAR_ASPECT = 2.0;
const FONT_SIZE = 12;

const DIRECTION_CHARSETS = {
  flat: "@%#*+=-:. ",
  horizontal: "═─━=~",
  vertical: "║│┃I!",
  diagonal: "/\\X*+",
};

const PALETTES = {
  Green: { background: "#001100", foreground: "#33ff66" },
  Amber: { background: "#1a0f00", foreground: "#ffb000" },
  Mono: { background: "#000000", foreground: "#ffffff" },
};

const elements = {
  imageInput: document.getElementById("imageInput"),
  colsInput: document.getElementById("colsInput"),
  colsValue: document.getElementById("colsValue"),
  contrastInput: document.getElementById("contrastInput"),
  contrastValue: document.getElementById("contrastValue"),
  thresholdInput: document.getElementById("thresholdInput"),
  thresholdValue: document.getElementById("thresholdValue"),
  ditherInput: document.getElementById("ditherInput"),
  paletteSelect: document.getElementById("paletteSelect"),
  canvas: document.getElementById("previewCanvas"),
  saveBtn: document.getElementById("saveBtn"),
  copyBtn: document.getElementById("copyBtn"),
  textOutput: document.getElementById("textOutput"),
};

const ctx = elements.canvas.getContext("2d", { willReadFrequently: true });
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

const state = {
  image: null,
  grid: [],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function gridToText(grid) {
  return grid.map((row) => row.join("")).join("\n");
}

function toTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function classifyDirection(dx, dy, threshold) {
  const magnitude = Math.sqrt(dx * dx + dy * dy);
  if (magnitude < threshold) {
    return "flat";
  }

  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  if (angle < 22.5 || angle >= 157.5) {
    return "horizontal";
  }
  if (angle >= 67.5 && angle < 112.5) {
    return "vertical";
  }
  return "diagonal";
}

function renderGridToCanvas(grid, palette) {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : Number(elements.colsInput.value);
  const cellW = FONT_SIZE;
  const cellH = FONT_SIZE * CHAR_ASPECT;

  elements.canvas.width = cols * cellW;
  elements.canvas.height = rows * cellH;

  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (rows === 0) {
    return;
  }

  ctx.fillStyle = palette.foreground;
  ctx.font = `${FONT_SIZE}px monospace`;
  ctx.textBaseline = "top";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      ctx.fillText(grid[y][x], x * cellW, y * cellH);
    }
  }
}

function buildLumaAndDirectionMaps(image, cols, rows, contrast, threshold) {
  sampleCanvas.width = cols;
  sampleCanvas.height = rows;
  sampleCtx.clearRect(0, 0, cols, rows);
  sampleCtx.drawImage(image, 0, 0, cols, rows);

  const { data } = sampleCtx.getImageData(0, 0, cols, rows);
  const lumaMap = Array.from({ length: rows }, () => new Array(cols));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const offset = (y * cols + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const lumaBase = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lumaContrast = (lumaBase - 128) * contrast + 128;
      lumaMap[y][x] = clamp(lumaContrast, 0, 255);
    }
  }

  const directionMap = Array.from({ length: rows }, () => new Array(cols));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const left = lumaMap[y][Math.max(0, x - 1)];
      const right = lumaMap[y][Math.min(cols - 1, x + 1)];
      const up = lumaMap[Math.max(0, y - 1)][x];
      const down = lumaMap[Math.min(rows - 1, y + 1)][x];
      const dx = right - left;
      const dy = down - up;
      directionMap[y][x] = classifyDirection(dx, dy, threshold);
    }
  }

  return { lumaMap, directionMap };
}

function convertImageToGrid(image, cols, contrast, threshold, ditherEnabled) {
  const rows = Math.max(1, Math.round((image.height / image.width) * cols / CHAR_ASPECT));
  const { lumaMap, directionMap } = buildLumaAndDirectionMaps(image, cols, rows, contrast, threshold);

  const grid = Array.from({ length: rows }, () => new Array(cols));
  const toneBuffer = lumaMap.map((row) => row.map((luma) => 1 - luma / 255));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const direction = directionMap[y][x];
      const charset = DIRECTION_CHARSETS[direction];
      const tone = clamp(toneBuffer[y][x], 0, 1);
      const maxIndex = charset.length - 1;
      const index = clamp(Math.floor(tone * maxIndex), 0, maxIndex);
      grid[y][x] = charset[index];

      if (!ditherEnabled || maxIndex === 0) {
        continue;
      }

      const representedTone = index / maxIndex;
      const error = tone - representedTone;

      if (x + 1 < cols) {
        toneBuffer[y][x + 1] += error * (7 / 16);
      }
      if (y + 1 < rows && x - 1 >= 0) {
        toneBuffer[y + 1][x - 1] += error * (3 / 16);
      }
      if (y + 1 < rows) {
        toneBuffer[y + 1][x] += error * (5 / 16);
      }
      if (y + 1 < rows && x + 1 < cols) {
        toneBuffer[y + 1][x + 1] += error * (1 / 16);
      }
    }
  }

  return grid;
}

function refresh() {
  const palette = PALETTES[elements.paletteSelect.value];

  if (!state.image) {
    state.grid = [];
    renderGridToCanvas([], palette);
    elements.textOutput.textContent = "";
    elements.saveBtn.disabled = true;
    elements.copyBtn.disabled = true;
    return;
  }

  const cols = Number(elements.colsInput.value);
  const contrast = Number(elements.contrastInput.value);
  const threshold = Number(elements.thresholdInput.value);
  const ditherEnabled = elements.ditherInput.checked;

  const grid = convertImageToGrid(state.image, cols, contrast, threshold, ditherEnabled);
  state.grid = grid;

  renderGridToCanvas(grid, palette);
  elements.textOutput.textContent = gridToText(grid);
  elements.saveBtn.disabled = false;
  elements.copyBtn.disabled = false;
}

function handleImageUpload(file) {
  if (!file) {
    state.image = null;
    refresh();
    return;
  }

  const img = new Image();
  img.onload = () => {
    state.image = img;
    refresh();
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => {
    state.image = null;
    refresh();
    URL.revokeObjectURL(img.src);
    alert("画像の読み込みに失敗しました。");
  };
  img.src = URL.createObjectURL(file);
}

elements.imageInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  handleImageUpload(file);
});

elements.colsInput.addEventListener("input", () => {
  elements.colsValue.value = elements.colsInput.value;
  refresh();
});

elements.contrastInput.addEventListener("input", () => {
  elements.contrastValue.value = Number(elements.contrastInput.value).toFixed(1);
  refresh();
});

elements.thresholdInput.addEventListener("input", () => {
  elements.thresholdValue.value = elements.thresholdInput.value;
  refresh();
});

elements.ditherInput.addEventListener("change", refresh);
elements.paletteSelect.addEventListener("change", refresh);

elements.saveBtn.addEventListener("click", () => {
  elements.canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `mz_textart_${toTimestamp()}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, "image/png");
});

elements.copyBtn.addEventListener("click", async () => {
  const text = gridToText(state.grid);

  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(elements.textOutput);
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

refresh();

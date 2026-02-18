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

const MICRO80 = {
  palette8: ["#000000", "#0000FF", "#FF0000", "#FF00FF", "#00FF00", "#00FFFF", "#FFFF00", "#FFFFFF"],
  green: { background: "#001100", foreground: "#33ff66" },
  mono: { background: "#000000", foreground: "#ffffff" },
  contrast: 1.15,
  shadeChars: " █▓▒░.",
  lineH: "─━═",
  lineV: "│┃║",
  diagChars: "/\\",
  markChars: "·:;*+xX#@",
};

const elements = {
  imageInput: document.getElementById("imageInput"),
  modeSelect: document.getElementById("modeSelect"),
  textControls: document.getElementById("textControls"),
  micro80Controls: document.getElementById("micro80Controls"),
  colsInput: document.getElementById("colsInput"),
  colsValue: document.getElementById("colsValue"),
  contrastInput: document.getElementById("contrastInput"),
  contrastValue: document.getElementById("contrastValue"),
  thresholdInput: document.getElementById("thresholdInput"),
  thresholdValue: document.getElementById("thresholdValue"),
  ditherInput: document.getElementById("ditherInput"),
  paletteSelect: document.getElementById("paletteSelect"),
  microColorModeSelect: document.getElementById("microColorModeSelect"),
  microColsInput: document.getElementById("microColsInput"),
  microColsValue: document.getElementById("microColsValue"),
  cellPxSelect: document.getElementById("cellPxSelect"),
  microDitherInput: document.getElementById("microDitherInput"),
  microEdgeThresholdInput: document.getElementById("microEdgeThresholdInput"),
  microEdgeThresholdValue: document.getElementById("microEdgeThresholdValue"),
  microSplitThresholdInput: document.getElementById("microSplitThresholdInput"),
  microSplitThresholdValue: document.getElementById("microSplitThresholdValue"),
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

function renderGridToCanvas(grid, options) {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : options.cols;
  const cellW = FONT_SIZE;
  const cellH = FONT_SIZE * CHAR_ASPECT;

  elements.canvas.width = cols * cellW;
  elements.canvas.height = rows * cellH;

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (rows === 0) {
    return;
  }

  ctx.font = `${FONT_SIZE}px monospace`;
  ctx.textBaseline = "top";

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      ctx.fillStyle = options.colorGrid ? options.colorGrid[y][x] : options.foreground;
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

function convertImageToGridTextMode(image, cols, contrast, threshold, ditherEnabled) {
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

  return { grid, background: PALETTES[elements.paletteSelect.value].background, foreground: PALETTES[elements.paletteSelect.value].foreground, cols };
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    return { h: 0, s: 0, l };
  }

  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  switch (max) {
    case rn:
      h = ((gn - bn) / d) % 6;
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }

  h *= 60;
  if (h < 0) {
    h += 360;
  }

  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return {
    r: clamp((r1 + m) * 255, 0, 255),
    g: clamp((g1 + m) * 255, 0, 255),
    b: clamp((b1 + m) * 255, 0, 255),
  };
}

function preprocessForMicro80(image, cols, rows, cellPx, colorMode) {
  const width = cols * cellPx;
  const height = rows * cellPx;
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  sampleCtx.clearRect(0, 0, width, height);
  sampleCtx.imageSmoothingEnabled = false;
  sampleCtx.drawImage(image, 0, 0, width, height);

  const imageData = sampleCtx.getImageData(0, 0, width, height);
  const { data } = imageData;
  const pixels = new Array(width * height);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    let r = data[offset];
    let g = data[offset + 1];
    let b = data[offset + 2];

    if (colorMode === "DIGITAL_8") {
      const hsl = rgbToHsl(r, g, b);
      const boosted = hslToRgb(hsl.h, clamp(hsl.s * 1.2, 0, 1), hsl.l);
      r = boosted.r;
      g = boosted.g;
      b = boosted.b;
    }

    r = clamp((r - 128) * MICRO80.contrast + 128, 0, 255);
    g = clamp((g - 128) * MICRO80.contrast + 128, 0, 255);
    b = clamp((b - 128) * MICRO80.contrast + 128, 0, 255);

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    pixels[i] = { r, g, b, luma };
  }

  return { width, height, pixels };
}

function pickNearestPalette8Color(r, g, b) {
  let best = MICRO80.palette8[0];
  let minDist = Number.POSITIVE_INFINITY;

  for (const color of MICRO80.palette8) {
    const rr = parseInt(color.slice(1, 3), 16);
    const gg = parseInt(color.slice(3, 5), 16);
    const bb = parseInt(color.slice(5, 7), 16);
    const dist = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (dist < minDist) {
      minDist = dist;
      best = color;
    }
  }

  return best;
}

function pickByTone(chars, tone) {
  const maxIndex = chars.length - 1;
  const index = clamp(Math.floor(clamp(tone, 0, 1) * maxIndex), 0, maxIndex);
  return { char: chars[index], index, maxIndex };
}

function convertImageToGridMicro80(image, options) {
  const cols = options.cols;
  const rows = Math.max(1, Math.round((image.height / image.width) * cols / CHAR_ASPECT));
  const cellPx = options.cellPx;
  const analyzed = preprocessForMicro80(image, cols, rows, cellPx, options.colorMode);

  const grid = Array.from({ length: rows }, () => new Array(cols));
  const colorGrid = Array.from({ length: rows }, () => new Array(cols));
  const toneBuffer = Array.from({ length: rows }, () => new Array(cols));
  const tonalChars = `${MICRO80.shadeChars}${MICRO80.markChars}`;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const baseX = x * cellPx;
      const baseY = y * cellPx;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumL = 0;
      let topSum = 0;
      let bottomSum = 0;
      let leftSum = 0;
      let rightSum = 0;

      for (let py = 0; py < cellPx; py += 1) {
        for (let px = 0; px < cellPx; px += 1) {
          const ix = baseX + px;
          const iy = baseY + py;
          const pixel = analyzed.pixels[iy * analyzed.width + ix];
          sumR += pixel.r;
          sumG += pixel.g;
          sumB += pixel.b;
          sumL += pixel.luma;

          if (py < cellPx / 2) {
            topSum += pixel.luma;
          } else {
            bottomSum += pixel.luma;
          }
          if (px < cellPx / 2) {
            leftSum += pixel.luma;
          } else {
            rightSum += pixel.luma;
          }
        }
      }

      const count = cellPx * cellPx;
      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;
      const avgLuma = sumL / count;
      toneBuffer[y][x] = 1 - avgLuma / 255;

      const halfCount = count / 2;
      const topAvg = topSum / halfCount;
      const bottomAvg = bottomSum / halfCount;
      const leftAvg = leftSum / halfCount;
      const rightAvg = rightSum / halfCount;

      const cx = baseX + Math.floor(cellPx / 2);
      const cy = baseY + Math.floor(cellPx / 2);
      const leftL = analyzed.pixels[cy * analyzed.width + Math.max(0, cx - 1)].luma;
      const rightL = analyzed.pixels[cy * analyzed.width + Math.min(analyzed.width - 1, cx + 1)].luma;
      const upL = analyzed.pixels[Math.max(0, cy - 1) * analyzed.width + cx].luma;
      const downL = analyzed.pixels[Math.min(analyzed.height - 1, cy + 1) * analyzed.width + cx].luma;
      const dx = rightL - leftL;
      const dy = downL - upL;
      const mag = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);

      let decision = null;
      const topBottomDiff = Math.abs(topAvg - bottomAvg);
      const leftRightDiff = Math.abs(leftAvg - rightAvg);

      if (topBottomDiff > options.splitThreshold) {
        decision = topAvg > bottomAvg ? { char: "▀", representedTone: 0.5 } : { char: "▄", representedTone: 0.5 };
      } else if (leftRightDiff > options.splitThreshold) {
        decision = leftAvg > rightAvg ? { char: "▌", representedTone: 0.5 } : { char: "▐", representedTone: 0.5 };
      } else if (mag > options.edgeThreshold) {
        const currentTone = clamp(toneBuffer[y][x], 0, 1);
        if (angle < 22.5 || angle >= 157.5) {
          const picked = pickByTone(MICRO80.lineH, currentTone);
          decision = { char: picked.char, representedTone: picked.index / picked.maxIndex };
        } else if (angle > 67.5 && angle < 112.5) {
          const picked = pickByTone(MICRO80.lineV, currentTone);
          decision = { char: picked.char, representedTone: picked.index / picked.maxIndex };
        } else {
          const picked = pickByTone(MICRO80.diagChars, currentTone);
          decision = { char: picked.char, representedTone: picked.index / picked.maxIndex };
        }
      } else {
        const currentTone = clamp(toneBuffer[y][x], 0, 1);
        const picked = pickByTone(tonalChars, currentTone);
        decision = { char: picked.char, representedTone: picked.index / picked.maxIndex, isTonal: true };
      }

      grid[y][x] = decision.char;

      if (options.colorMode === "DIGITAL_8") {
        colorGrid[y][x] = pickNearestPalette8Color(avgR, avgG, avgB);
      } else if (options.colorMode === "GREEN_1") {
        colorGrid[y][x] = MICRO80.green.foreground;
      } else {
        colorGrid[y][x] = MICRO80.mono.foreground;
      }

      const shouldDither = options.ditherEnabled && options.colorMode !== "DIGITAL_8" && decision.isTonal;
      if (!shouldDither) {
        continue;
      }

      const tone = clamp(toneBuffer[y][x], 0, 1);
      const error = tone - decision.representedTone;
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

  const background = options.colorMode === "DIGITAL_8" ? "#000000" : options.colorMode === "GREEN_1" ? MICRO80.green.background : MICRO80.mono.background;

  return { grid, colorGrid, background, foreground: null, cols };
}

function updateModeVisibility() {
  const mode = elements.modeSelect.value;
  const isMicro = mode === "micro80";
  elements.textControls.classList.toggle("hidden", isMicro);
  elements.micro80Controls.classList.toggle("hidden", !isMicro);
}

function refresh() {
  const mode = elements.modeSelect.value;
  const emptyOptions = mode === "micro80"
    ? { background: "#000000", foreground: "#ffffff", cols: Number(elements.microColsInput.value) }
    : { ...PALETTES[elements.paletteSelect.value], cols: Number(elements.colsInput.value) };

  if (!state.image) {
    state.grid = [];
    renderGridToCanvas([], emptyOptions);
    elements.textOutput.textContent = "";
    elements.saveBtn.disabled = true;
    elements.copyBtn.disabled = true;
    return;
  }

  let result;
  if (mode === "micro80") {
    result = convertImageToGridMicro80(state.image, {
      colorMode: elements.microColorModeSelect.value,
      cols: Number(elements.microColsInput.value),
      cellPx: Number(elements.cellPxSelect.value),
      ditherEnabled: elements.microDitherInput.checked,
      edgeThreshold: Number(elements.microEdgeThresholdInput.value),
      splitThreshold: Number(elements.microSplitThresholdInput.value),
    });
  } else {
    result = convertImageToGridTextMode(
      state.image,
      Number(elements.colsInput.value),
      Number(elements.contrastInput.value),
      Number(elements.thresholdInput.value),
      elements.ditherInput.checked,
    );
  }

  state.grid = result.grid;
  renderGridToCanvas(result.grid, {
    background: result.background,
    foreground: result.foreground,
    colorGrid: result.colorGrid,
    cols: result.cols,
  });
  elements.textOutput.textContent = gridToText(result.grid);
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

elements.modeSelect.addEventListener("change", () => {
  updateModeVisibility();
  refresh();
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

elements.microColorModeSelect.addEventListener("change", refresh);
elements.microColsInput.addEventListener("input", () => {
  elements.microColsValue.value = elements.microColsInput.value;
  refresh();
});
elements.cellPxSelect.addEventListener("change", refresh);
elements.microDitherInput.addEventListener("change", refresh);
elements.microEdgeThresholdInput.addEventListener("input", () => {
  elements.microEdgeThresholdValue.value = elements.microEdgeThresholdInput.value;
  refresh();
});
elements.microSplitThresholdInput.addEventListener("input", () => {
  elements.microSplitThresholdValue.value = elements.microSplitThresholdInput.value;
  refresh();
});

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

updateModeVisibility();
refresh();

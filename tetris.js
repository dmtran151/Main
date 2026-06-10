"use strict";

/* ============================================================
 * Mobile Tetris — vanilla JS, canvas-rendered, guideline-style
 * rules: SRS rotation with wall kicks, 7-bag randomizer, hold,
 * ghost piece, lock delay, B2B / combo scoring.
 * ============================================================ */

const COLS = 10;
const ROWS = 20;
const HIDDEN = 2; // spawn rows above the visible field
const TOTAL_ROWS = ROWS + HIDDEN;

const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
const NEXT_COUNT = 4;
const BEST_KEY = "tetris.best";

const COLORS = {
  I: "#3fd8e8",
  O: "#f7d048",
  T: "#b04fff",
  S: "#4ade80",
  Z: "#ff5c6c",
  J: "#4f7cff",
  L: "#ff9f43",
  ghost: "rgba(232, 234, 255, 0.18)",
  grid: "rgba(255, 255, 255, 0.045)",
};

// Shapes as rotation-0 cell offsets inside their bounding box.
const SHAPES = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

// Pre-compute all 4 rotation states for each piece.
const ROTATIONS = {};
for (const [name, { size, cells }] of Object.entries(SHAPES)) {
  const states = [cells];
  for (let r = 1; r < 4; r++) {
    states.push(states[r - 1].map(([x, y]) => [size - 1 - y, x]));
  }
  ROTATIONS[name] = states;
}

// SRS wall-kick data: KICKS[from][to] -> list of [dx, dy] offsets to try.
// dy here is screen-down positive (SRS tables negated on y).
const KICKS_JLSTZ = {
  "0>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "1>0": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "1>2": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "2>1": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "2>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "3>2": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "3>0": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "0>3": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const KICKS_I = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

// Guideline gravity: seconds per row at a given level.
function gravitySeconds(level) {
  const l = Math.min(level, 20);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1);
}

/* ---------------- Storage ----------------
 * localStorage access throws in sandboxed viewers and some private
 * browsing modes; degrade to a session-only high score instead of dying. */

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* session-only */ }
  },
};

/* ---------------- Sound (tiny WebAudio blips) ---------------- */

const sound = {
  ctx: null,
  enabled: true,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  blip(freq, dur = 0.06, type = "square", gain = 0.04) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  move() { this.blip(220, 0.03); },
  rotate() { this.blip(330, 0.04); },
  lock() { this.blip(150, 0.06); },
  clear(n) { this.blip(440 + n * 110, 0.12, "triangle", 0.06); },
  drop() { this.blip(180, 0.05, "sawtooth"); },
  over() { this.blip(110, 0.4, "sawtooth", 0.06); },
};

/* ---------------- Game state ---------------- */

const game = {
  board: [],          // TOTAL_ROWS x COLS, null or color key
  piece: null,        // { name, rot, x, y }
  bag: [],
  queue: [],
  hold: null,
  holdUsed: false,
  score: 0,
  lines: 0,
  level: 1,
  best: Number(storage.get(BEST_KEY) || 0),
  combo: -1,
  backToBack: false,
  state: "menu",      // menu | playing | paused | over
  gravityAcc: 0,
  lockTimer: null,    // ms remaining once grounded, else null
  lockResets: 0,
  lastTime: 0,
};

function emptyBoard() {
  return Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(null));
}

function refillBag() {
  const bag = ["I", "O", "T", "S", "Z", "J", "L"];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function nextFromQueue() {
  while (game.queue.length <= NEXT_COUNT) {
    if (game.bag.length === 0) game.bag = refillBag();
    game.queue.push(game.bag.pop());
  }
  return game.queue.shift();
}

function pieceCells(piece) {
  return ROTATIONS[piece.name][piece.rot].map(([x, y]) => [piece.x + x, piece.y + y]);
}

function collides(piece) {
  for (const [x, y] of pieceCells(piece)) {
    if (x < 0 || x >= COLS || y >= TOTAL_ROWS) return true;
    if (y >= 0 && game.board[y][x]) return true;
  }
  return false;
}

function spawnPiece(name) {
  const size = SHAPES[name].size;
  const piece = {
    name,
    rot: 0,
    x: Math.floor((COLS - size) / 2),
    y: name === "I" ? 0 : HIDDEN - 1,
  };
  if (collides(piece)) {
    piece.y -= 1;
    if (collides(piece)) return null; // blocked out
  }
  return piece;
}

function isGrounded() {
  const p = game.piece;
  return collides({ ...p, y: p.y + 1 });
}

// Called after any successful move/rotate to manage lock delay.
function touchLockDelay() {
  if (isGrounded()) {
    if (game.lockTimer === null) {
      game.lockTimer = LOCK_DELAY_MS;
    } else if (game.lockResets < MAX_LOCK_RESETS) {
      game.lockTimer = LOCK_DELAY_MS;
      game.lockResets++;
    }
  } else {
    game.lockTimer = null;
  }
}

function tryMove(dx, dy) {
  const p = game.piece;
  const moved = { ...p, x: p.x + dx, y: p.y + dy };
  if (collides(moved)) return false;
  game.piece = moved;
  touchLockDelay();
  return true;
}

function tryRotate(dir) {
  const p = game.piece;
  if (p.name === "O") return true;
  const from = p.rot;
  const to = (p.rot + dir + 4) % 4;
  const table = p.name === "I" ? KICKS_I : KICKS_JLSTZ;
  for (const [dx, dy] of table[`${from}>${to}`]) {
    const rotated = { ...p, rot: to, x: p.x + dx, y: p.y + dy };
    if (!collides(rotated)) {
      game.piece = rotated;
      touchLockDelay();
      return true;
    }
  }
  return false;
}

function holdPiece() {
  if (game.holdUsed) return;
  const current = game.piece.name;
  const swap = game.hold;
  game.hold = current;
  game.holdUsed = true;
  game.piece = spawnPiece(swap ?? nextFromQueue());
  game.lockTimer = null;
  game.lockResets = 0;
  game.gravityAcc = 0;
  if (!game.piece) return gameOver();
  sound.rotate();
}

function hardDrop() {
  let dist = 0;
  while (tryMove(0, 1)) dist++;
  game.score += dist * 2;
  sound.drop();
  lockPiece();
}

function softDropStep() {
  if (tryMove(0, 1)) {
    game.score += 1;
    game.gravityAcc = 0;
    return true;
  }
  return false;
}

function lockPiece() {
  const p = game.piece;
  let aboveField = true;
  for (const [x, y] of pieceCells(p)) {
    if (y >= 0) game.board[y][x] = p.name;
    if (y >= HIDDEN) aboveField = false;
  }
  if (aboveField) return gameOver(); // locked entirely above the visible field

  clearLines();
  game.piece = spawnPiece(nextFromQueue());
  game.holdUsed = false;
  game.lockTimer = null;
  game.lockResets = 0;
  game.gravityAcc = 0;
  if (!game.piece) return gameOver();
  sound.lock();
}

function clearLines() {
  const remaining = game.board.filter((row) => row.some((c) => !c));
  const cleared = TOTAL_ROWS - remaining.length;
  if (cleared === 0) {
    game.combo = -1;
    return;
  }
  while (remaining.length < TOTAL_ROWS) remaining.unshift(Array(COLS).fill(null));
  game.board = remaining;

  const base = [0, 100, 300, 500, 800][cleared];
  const isTetris = cleared === 4;
  let points = base * game.level;
  if (isTetris && game.backToBack) points = Math.floor(points * 1.5);
  game.backToBack = isTetris;

  game.combo++;
  if (game.combo > 0) points += 50 * game.combo * game.level;

  game.score += points;
  game.lines += cleared;
  game.level = Math.floor(game.lines / 10) + 1;
  sound.clear(cleared);
}

function gameOver() {
  game.state = "over";
  if (game.score > game.best) {
    game.best = game.score;
    storage.set(BEST_KEY, String(game.best));
  }
  sound.over();
  showOverlay("GAME OVER", `Score ${game.score.toLocaleString()} · Best ${game.best.toLocaleString()}`, "Play again");
}

function startGame() {
  game.board = emptyBoard();
  game.bag = [];
  game.queue = [];
  game.hold = null;
  game.holdUsed = false;
  game.score = 0;
  game.lines = 0;
  game.level = 1;
  game.combo = -1;
  game.backToBack = false;
  game.gravityAcc = 0;
  game.lockTimer = null;
  game.lockResets = 0;
  game.piece = spawnPiece(nextFromQueue());
  game.state = "playing";
  hideOverlay();
}

function togglePause() {
  if (game.state === "playing") {
    game.state = "paused";
    showOverlay("PAUSED", "", "Resume");
  } else if (game.state === "paused") {
    game.state = "playing";
    hideOverlay();
  }
}

/* ---------------- Update loop ---------------- */

function update(dt) {
  if (game.state !== "playing") return;

  if (game.lockTimer !== null) {
    if (!isGrounded()) {
      game.lockTimer = null; // ground vanished (e.g. after a kick)
    } else {
      game.lockTimer -= dt;
      if (game.lockTimer <= 0) lockPiece();
      return;
    }
  }

  game.gravityAcc += dt;
  const interval = gravitySeconds(game.level) * 1000;
  while (game.gravityAcc >= interval) {
    game.gravityAcc -= interval;
    if (!tryMove(0, 1)) break; // tryMove arms the lock timer when grounded
  }
}

function frame(now) {
  const dt = Math.min(now - game.lastTime, 100);
  game.lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

/* ---------------- Rendering ---------------- */

const boardCanvas = document.getElementById("board");
const boardCtx = boardCanvas.getContext("2d");
const holdCanvas = document.getElementById("hold-canvas");
const holdCtx = holdCanvas.getContext("2d");
const nextCanvas = document.getElementById("next-canvas");
const nextCtx = nextCanvas.getContext("2d");

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function drawCell(ctx, px, py, size, color, ghost = false) {
  if (ghost) {
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    return;
  }
  ctx.fillStyle = color;
  ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
  // bevel highlight / shade for a tile look
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.12));
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(px + 1, py + size - 1 - Math.max(2, size * 0.12), size - 2, Math.max(2, size * 0.12));
}

function render() {
  fitCanvas(boardCanvas);
  const ctx = boardCtx;
  const W = boardCanvas.width;
  const H = boardCanvas.height;
  const cell = Math.min(W / COLS, H / ROWS);
  const offX = (W - cell * COLS) / 2;
  const offY = (H - cell * ROWS) / 2;

  ctx.clearRect(0, 0, W, H);

  // grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= COLS; x++) {
    ctx.moveTo(offX + x * cell, offY);
    ctx.lineTo(offX + x * cell, offY + ROWS * cell);
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.moveTo(offX, offY + y * cell);
    ctx.lineTo(offX + COLS * cell, offY + y * cell);
  }
  ctx.stroke();

  // settled board
  for (let y = HIDDEN; y < TOTAL_ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = game.board[y][x];
      if (c) drawCell(ctx, offX + x * cell, offY + (y - HIDDEN) * cell, cell, COLORS[c]);
    }
  }

  if (game.piece && game.state !== "menu") {
    // ghost
    const ghost = { ...game.piece };
    while (!collides({ ...ghost, y: ghost.y + 1 })) ghost.y++;
    for (const [x, y] of pieceCells(ghost)) {
      if (y >= HIDDEN) drawCell(ctx, offX + x * cell, offY + (y - HIDDEN) * cell, cell, COLORS.ghost, true);
    }
    // active piece
    for (const [x, y] of pieceCells(game.piece)) {
      if (y >= HIDDEN) drawCell(ctx, offX + x * cell, offY + (y - HIDDEN) * cell, cell, COLORS[game.piece.name]);
    }
  }

  renderPreview(holdCtx, holdCanvas, game.hold ? [game.hold] : []);
  renderPreview(nextCtx, nextCanvas, game.queue.slice(0, NEXT_COUNT));
  renderHud();
}

function renderPreview(ctx, canvas, names) {
  fitCanvas(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (names.length === 0) return;
  const slotW = canvas.width / names.length;
  const cell = Math.min(slotW / 4.5, canvas.height / 4.5);
  names.forEach((name, i) => {
    const cells = ROTATIONS[name][0];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * cell;
    const h = (Math.max(...ys) - Math.min(...ys) + 1) * cell;
    const ox = i * slotW + (slotW - w) / 2 - Math.min(...xs) * cell;
    const oy = (canvas.height - h) / 2 - Math.min(...ys) * cell;
    for (const [x, y] of cells) {
      drawCell(ctx, ox + x * cell, oy + y * cell, cell, COLORS[name]);
    }
  });
}

const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("level");
const linesEl = document.getElementById("lines");
const bestEl = document.getElementById("best");

function renderHud() {
  scoreEl.textContent = game.score.toLocaleString();
  levelEl.textContent = String(game.level);
  linesEl.textContent = String(game.lines);
  bestEl.textContent = game.best.toLocaleString();
}

/* ---------------- Overlay ---------------- */

const overlayEl = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlaySub = document.getElementById("overlay-sub");
const startBtn = document.getElementById("btn-start");

function showOverlay(title, sub, btnText) {
  overlayTitle.textContent = title;
  overlaySub.innerHTML = sub;
  startBtn.textContent = btnText;
  overlayEl.classList.remove("hidden");
}

function hideOverlay() {
  overlayEl.classList.add("hidden");
}

startBtn.addEventListener("click", () => {
  sound.ensure();
  if (game.state === "paused") togglePause();
  else startGame();
});

document.getElementById("btn-pause").addEventListener("click", () => {
  if (game.state === "playing" || game.state === "paused") togglePause();
});

/* ---------------- Input: keyboard ---------------- */

document.addEventListener("keydown", (e) => {
  if (e.repeat && ["Space", "KeyC", "KeyP", "Escape"].includes(e.code)) return;
  if (game.state === "menu" || game.state === "over") {
    if (e.code === "Enter" || e.code === "Space") {
      sound.ensure();
      startGame();
    }
    return;
  }
  if (e.code === "KeyP" || e.code === "Escape") return togglePause();
  if (game.state !== "playing") return;

  switch (e.code) {
    case "ArrowLeft": if (tryMove(-1, 0)) sound.move(); break;
    case "ArrowRight": if (tryMove(1, 0)) sound.move(); break;
    case "ArrowDown": softDropStep(); break;
    case "ArrowUp":
    case "KeyX": if (tryRotate(1)) sound.rotate(); break;
    case "KeyZ": if (tryRotate(-1)) sound.rotate(); break;
    case "Space": e.preventDefault(); hardDrop(); break;
    case "KeyC": holdPiece(); break;
  }
});

/* ---------------- Input: touch gestures on the board ----------------
 * Horizontal drag  -> move piece one column per cell-width dragged
 * Downward drag    -> soft drop one row per cell-height dragged
 * Fast downward flick -> hard drop
 * Tap              -> rotate (left third CCW, rest CW)
 * ------------------------------------------------------------------ */

const touch = {
  id: null,
  startX: 0, startY: 0, startT: 0,
  lastX: 0, lastY: 0,
  movedCells: 0, droppedCells: 0,
  dropped: false,
};

boardCanvas.addEventListener("pointerdown", (e) => {
  if (game.state !== "playing") return;
  boardCanvas.setPointerCapture(e.pointerId);
  touch.id = e.pointerId;
  touch.startX = touch.lastX = e.clientX;
  touch.startY = touch.lastY = e.clientY;
  touch.startT = performance.now();
  touch.movedCells = 0;
  touch.droppedCells = 0;
  touch.dropped = false;
});

boardCanvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== touch.id || game.state !== "playing" || touch.dropped) return;
  const rect = boardCanvas.getBoundingClientRect();
  const cellW = rect.width / COLS;
  const cellH = rect.height / ROWS;

  const dx = e.clientX - touch.startX;
  const targetCells = Math.trunc(dx / cellW);
  while (touch.movedCells < targetCells) {
    if (!tryMove(1, 0)) break;
    touch.movedCells++;
    sound.move();
  }
  while (touch.movedCells > targetCells) {
    if (!tryMove(-1, 0)) break;
    touch.movedCells--;
    sound.move();
  }

  const dy = e.clientY - touch.startY;
  const targetDrops = Math.trunc(dy / cellH);
  while (touch.droppedCells < targetDrops) {
    if (!softDropStep()) break;
    touch.droppedCells++;
  }

  touch.lastX = e.clientX;
  touch.lastY = e.clientY;
});

boardCanvas.addEventListener("pointerup", (e) => {
  if (e.pointerId !== touch.id) return;
  touch.id = null;
  if (game.state !== "playing" || touch.dropped) return;

  const dt = performance.now() - touch.startT;
  const dx = e.clientX - touch.startX;
  const dy = e.clientY - touch.startY;
  const dist = Math.hypot(dx, dy);

  // Tap: short, barely moved -> rotate
  if (dt < 250 && dist < 12) {
    const rect = boardCanvas.getBoundingClientRect();
    const dir = e.clientX - rect.left < rect.width / 3 ? -1 : 1;
    if (tryRotate(dir)) sound.rotate();
    return;
  }

  // Fast downward flick -> hard drop
  const vy = dy / dt; // px per ms
  if (dy > 60 && vy > 0.5 && Math.abs(dx) < Math.abs(dy)) {
    touch.dropped = true;
    hardDrop();
  }
});

boardCanvas.addEventListener("pointercancel", () => { touch.id = null; });

/* ---------------- Input: on-screen pad ---------------- */

const repeatable = new Set(["left", "right", "down"]);
const padTimers = new Map();

function padAction(action) {
  if (game.state !== "playing") return;
  switch (action) {
    case "left": if (tryMove(-1, 0)) sound.move(); break;
    case "right": if (tryMove(1, 0)) sound.move(); break;
    case "down": softDropStep(); break;
    case "rotcw": if (tryRotate(1)) sound.rotate(); break;
    case "rotccw": if (tryRotate(-1)) sound.rotate(); break;
    case "drop": hardDrop(); break;
    case "hold": holdPiece(); break;
  }
}

for (const btn of document.querySelectorAll(".pad-btn")) {
  const action = btn.dataset.action;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sound.ensure();
    padAction(action);
    if (repeatable.has(action)) {
      const start = setTimeout(() => {
        const iv = setInterval(() => padAction(action), 50);
        padTimers.set(btn, iv);
      }, 200);
      padTimers.set(btn, start);
    }
  });
  const stop = () => {
    const t = padTimers.get(btn);
    if (t) { clearTimeout(t); clearInterval(t); padTimers.delete(btn); }
  };
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("pointerleave", stop);
}

/* ---------------- Lifecycle ---------------- */

// Pause automatically when the tab/app goes to the background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.state === "playing") togglePause();
});

game.board = emptyBoard();
renderHud();
requestAnimationFrame((t) => {
  game.lastTime = t;
  requestAnimationFrame(frame);
});

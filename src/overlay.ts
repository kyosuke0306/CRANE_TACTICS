import type { Analysis, Arrow, Box, Point } from "./types";

type DragTarget =
  | { kind: "target" }
  | { kind: "move"; which: "prize" | "hole"; startBox: Box; startPt: Point }
  | { kind: "resize"; which: "prize" | "hole"; corner: "tl" | "br" };

const COLORS = {
  prize: "#ffd23f",
  hole: "#2ee59d",
  target: "#ff4d6d",
  obstacle: "rgba(255,255,255,0.75)",
  arrow: "#ffffff",
};

/**
 * 写真の上に景品・落とし口・アームを下ろす位置・矢印を描画し、
 * ドラッグで位置を直せるようにするクラス。
 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private img: HTMLImageElement | null = null;
  private analysis: Analysis | null = null;
  private step = 0;
  private drag: DragTarget | null = null;
  private scale = 1; // 1000 正規化 → CSS px（x と y で別）
  private sx = 1;
  private sy = 1;
  editable = true;
  onEdit: (a: Analysis) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas が使えません");
    this.ctx = ctx;
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    new ResizeObserver(() => this.layout()).observe(canvas.parentElement ?? canvas);
  }

  setImage(img: HTMLImageElement) {
    this.img = img;
    this.layout();
  }

  setAnalysis(a: Analysis | null) {
    this.analysis = a;
    this.step = 0;
    this.draw();
  }

  setStep(i: number) {
    this.step = i;
    this.draw();
  }

  private layout() {
    if (!this.img) return;
    const parent = this.canvas.parentElement;
    const maxW = parent ? parent.clientWidth : 400;
    const maxH = Math.max(320, window.innerHeight * 0.62);
    const ratio = this.img.naturalWidth / this.img.naturalHeight;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sx = w / 1000;
    this.sy = h / 1000;
    this.scale = Math.min(w, h) / 400; // 線や文字の太さの基準
    this.draw();
  }

  // ---- 座標変換 ----
  private px(p: Point): [number, number] {
    return [p[1] * this.sx, p[0] * this.sy];
  }
  private rect(b: Box): [number, number, number, number] {
    return [b[1] * this.sx, b[0] * this.sy, (b[3] - b[1]) * this.sx, (b[2] - b[0]) * this.sy];
  }
  private toNorm(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * 1000;
    const x = ((e.clientX - r.left) / r.width) * 1000;
    return [Math.min(1000, Math.max(0, y)), Math.min(1000, Math.max(0, x))];
  }

  // ---- 描画 ----
  draw() {
    const { ctx } = this;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    if (!this.img) return;
    ctx.drawImage(this.img, 0, 0, w, h);
    const a = this.analysis;
    if (!a) return;

    // 少し暗くして印を見やすく
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, 0, w, h);

    a.obstacles.forEach((o) => this.drawBox(o.box, COLORS.obstacle, o.label, true));
    this.drawBox(a.hole.box, COLORS.hole, "落とし口", false, "rgba(46,229,157,0.22)");
    this.drawBox(a.prize.box, COLORS.prize, a.prize.label, false, "rgba(255,210,63,0.12)");

    const s = a.steps[this.step];
    if (s) {
      this.drawArrow(a.prize.box, s.arrow);
      a.steps.forEach((other, i) => {
        if (i !== this.step) this.drawGhostTarget(other.target, i + 1);
      });
      this.drawTarget(s.target, this.step + 1);
    }

    if (this.editable) {
      this.drawHandles(a.prize.box, COLORS.prize);
      this.drawHandles(a.hole.box, COLORS.hole);
    }
  }

  private drawBox(b: Box, color: string, label: string, dashed: boolean, fill?: string) {
    const { ctx } = this;
    const [x, y, w, h] = this.rect(b);
    ctx.save();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * this.scale;
    if (dashed) ctx.setLineDash([6 * this.scale, 5 * this.scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    if (label) {
      const fs = Math.max(11, 13 * this.scale);
      ctx.font = `700 ${fs}px "Zen Kaku Gothic New", system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + fs;
      const ly = y - fs * 1.6 < 0 ? y + 2 : y - fs * 1.6;
      ctx.fillStyle = color;
      roundRect(ctx, x, ly, tw, fs * 1.5, fs * 0.4);
      ctx.fill();
      ctx.fillStyle = "#14121a";
      ctx.fillText(label, x + fs / 2, ly + fs * 1.08);
    }
    ctx.restore();
  }

  private drawHandles(b: Box, color: string) {
    const { ctx } = this;
    const r = 7 * this.scale;
    for (const p of [
      [b[0], b[1]],
      [b[2], b[3]],
    ] as Point[]) {
      const [x, y] = this.px(p);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 3 * this.scale;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  private drawTarget(p: Point, n: number) {
    const { ctx } = this;
    const [x, y] = this.px(p);
    const r = 20 * this.scale;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 3 * this.scale;
    ctx.strokeStyle = COLORS.target;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.target;
    ctx.fill();
    // 十字
    ctx.beginPath();
    ctx.moveTo(x - r * 1.5, y);
    ctx.lineTo(x - r * 1.05, y);
    ctx.moveTo(x + r * 1.05, y);
    ctx.lineTo(x + r * 1.5, y);
    ctx.moveTo(x, y - r * 1.5);
    ctx.lineTo(x, y - r * 1.05);
    ctx.moveTo(x, y + r * 1.05);
    ctx.lineTo(x, y + r * 1.5);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 番号
    const fs = 13 * this.scale;
    ctx.font = `900 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), x, y + 0.5);
    // 「ここに下ろす」
    const label = "ここに下ろす";
    ctx.font = `700 ${Math.max(11, 12 * this.scale)}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 12 * this.scale;
    // 景品ラベルと重ならないよう基本は下側に。画面の下端にかかるときだけ上側に出す
    const canvasH = this.canvas.height / (window.devicePixelRatio || 1);
    const ly = y + r * 2.6 + 10 * this.scale < canvasH ? y + r * 2.6 : y - r * 2.6;
    ctx.fillStyle = COLORS.target;
    roundRect(ctx, x - tw / 2, ly - 10 * this.scale, tw, 20 * this.scale, 10 * this.scale);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x, ly);
    ctx.restore();
  }

  private drawGhostTarget(p: Point, n: number) {
    const { ctx } = this;
    const [x, y] = this.px(p);
    const r = 11 * this.scale;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,18,26,0.8)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${11 * this.scale}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), x, y + 0.5);
    ctx.restore();
  }

  private drawArrow(b: Box, arrow: Arrow) {
    if (arrow === "none") return;
    const { ctx } = this;
    const [bx, by, bw, bh] = this.rect(b);
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    const lw = 6 * this.scale;
    ctx.save();
    ctx.strokeStyle = COLORS.arrow;
    ctx.fillStyle = COLORS.arrow;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;

    if (arrow === "rotate_cw" || arrow === "rotate_ccw") {
      const r = Math.min(bw, bh) * 0.32;
      const cw = arrow === "rotate_cw";
      const start = cw ? -Math.PI * 0.8 : -Math.PI * 0.2;
      const end = cw ? Math.PI * 0.1 : -Math.PI * 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end, !cw);
      ctx.stroke();
      const ex = cx + r * Math.cos(end);
      const ey = cy + r * Math.sin(end);
      const tangent = end + (cw ? Math.PI / 2 : -Math.PI / 2);
      arrowHead(ctx, ex, ey, tangent, 14 * this.scale);
    } else {
      const len = Math.max(bw, bh) * 0.55 + 30 * this.scale;
      const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[arrow];
      const sx = cx - dir[0] * len * 0.2;
      const sy = cy - dir[1] * len * 0.2;
      const ex = cx + dir[0] * len * 0.8;
      const ey = cy + dir[1] * len * 0.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      arrowHead(ctx, ex, ey, Math.atan2(dir[1], dir[0]), 16 * this.scale);
    }
    ctx.restore();
  }

  // ---- ドラッグ編集 ----
  private hit(p: Point): DragTarget | null {
    const a = this.analysis;
    if (!a || !this.editable) return null;
    const [x, y] = this.px(p);
    const near = (q: Point, r: number) => {
      const [qx, qy] = this.px(q);
      return Math.hypot(qx - x, qy - y) < r;
    };
    const R = 22 * this.scale;
    const s = a.steps[this.step];
    if (s && near(s.target, R * 1.3)) return { kind: "target" };
    for (const which of ["hole", "prize"] as const) {
      const b = a[which].box;
      if (near([b[0], b[1]], R)) return { kind: "resize", which, corner: "tl" };
      if (near([b[2], b[3]], R)) return { kind: "resize", which, corner: "br" };
    }
    for (const which of ["prize", "hole"] as const) {
      const b = a[which].box;
      if (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])
        return { kind: "move", which, startBox: [...b] as Box, startPt: p };
    }
    return null;
  }

  /** 直前のタッチが印のドラッグだったか（スワイプ判定との切り分け用） */
  lastGestureWasDrag = false;

  private onDown = (e: PointerEvent) => {
    const t = this.hit(this.toNorm(e));
    this.lastGestureWasDrag = Boolean(t);
    if (!t) return;
    this.drag = t;
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent) => {
    const a = this.analysis;
    const p = this.toNorm(e);
    if (!this.drag) {
      this.canvas.style.cursor = this.hit(p) ? "grab" : "default";
      return;
    }
    if (!a) return;
    e.preventDefault();
    const d = this.drag;
    if (d.kind === "target") {
      a.steps[this.step].target = p;
    } else if (d.kind === "move") {
      const dy = p[0] - d.startPt[0];
      const dx = p[1] - d.startPt[1];
      const b = d.startBox;
      const h = b[2] - b[0];
      const w = b[3] - b[1];
      const y1 = Math.min(1000 - h, Math.max(0, b[0] + dy));
      const x1 = Math.min(1000 - w, Math.max(0, b[1] + dx));
      a[d.which].box = [y1, x1, y1 + h, x1 + w];
    } else {
      const b = a[d.which].box;
      if (d.corner === "tl") a[d.which].box = [Math.min(p[0], b[2] - 15), Math.min(p[1], b[3] - 15), b[2], b[3]];
      else a[d.which].box = [b[0], b[1], Math.max(p[0], b[0] + 15), Math.max(p[1], b[1] + 15)];
    }
    this.draw();
  };

  private onUp = () => {
    if (this.drag && this.analysis) this.onEdit(this.analysis);
    this.drag = null;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(angle) * size * 0.6, y + Math.sin(angle) * size * 0.6);
  ctx.lineTo(x + Math.cos(angle + 2.5) * size, y + Math.sin(angle + 2.5) * size);
  ctx.lineTo(x + Math.cos(angle - 2.5) * size, y + Math.sin(angle - 2.5) * size);
  ctx.closePath();
  ctx.fill();
}

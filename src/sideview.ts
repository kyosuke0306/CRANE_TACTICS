// 横から撮った写真と「奥行き（前後）はここで止める」の印。
// 写真の右上に小さく出し、タップすると大きく広げる。

import type { Analysis, Box, Point } from "./types";

const COLORS = { prize: "#ffd23f", hole: "#2ee59d", target: "#ff4d6d" };

export class SideView {
  private ctx: CanvasRenderingContext2D;
  private img: HTMLImageElement | null = null;
  private analysis: Analysis | null = null;
  private step = 0;
  private expanded = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.layout();
    });
    new ResizeObserver(() => this.layout()).observe(canvas.parentElement ?? canvas);
  }

  setImage(img: HTMLImageElement | null) {
    this.img = img;
    this.expanded = false;
    this.canvas.hidden = !img;
    this.layout();
  }

  setData(a: Analysis | null, step: number) {
    this.analysis = a;
    this.step = step;
    this.draw();
  }

  private layout() {
    const img = this.img;
    const stage = this.canvas.parentElement;
    if (!img || !stage) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    let w: number;
    let h: number;
    if (this.expanded) {
      w = sw - 16;
      h = w / ratio;
      if (h > sh - 16) {
        h = sh - 16;
        w = h * ratio;
      }
    } else {
      w = Math.min(130, sw * 0.32);
      h = w / ratio;
    }
    const dpr = window.devicePixelRatio || 1;
    this.canvas.classList.toggle("expanded", this.expanded);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private draw() {
    const { ctx, img } = this;
    if (!img) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const k = this.expanded ? Math.min(w, h) / 300 : Math.min(w, h) / 110;
    const px = (p: Point): [number, number] => [(p[1] / 1000) * w, (p[0] / 1000) * h];
    const rect = (b: Box): [number, number, number, number] => [
      (b[1] / 1000) * w,
      (b[0] / 1000) * h,
      ((b[3] - b[1]) / 1000) * w,
      ((b[2] - b[0]) / 1000) * h,
    ];

    const a = this.analysis;
    const s = a?.steps[this.step];
    if (a?.side) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = COLORS.hole;
      ctx.strokeRect(...rect(a.side.hole));
      ctx.strokeStyle = COLORS.prize;
      ctx.strokeRect(...rect(a.side.prize));
    }
    if (s?.sideTarget) {
      const [x, y] = px(s.sideTarget);
      // 前後の止める位置：縦の点線＋印
      ctx.save();
      ctx.strokeStyle = COLORS.target;
      ctx.lineWidth = 2.5 * k;
      ctx.setLineDash([6 * k, 4 * k]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(x, y, 9 * k, 0, Math.PI * 2);
      ctx.lineWidth = 3 * k;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 3.5 * k, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.target;
      ctx.fill();
      ctx.restore();
      if (this.expanded) {
        const label = "前後はここで止める";
        const fs = Math.max(12, 13 * k);
        ctx.font = `700 ${fs}px "Zen Kaku Gothic New", system-ui, sans-serif`;
        const tw = ctx.measureText(label).width + fs;
        const lx = Math.min(Math.max(x - tw / 2, 4), w - tw - 4);
        const ly = Math.min(y + 16 * k, h - fs * 1.6 - 4);
        ctx.fillStyle = COLORS.target;
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw, fs * 1.6, fs * 0.8);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(label, lx + fs / 2, ly + fs * 0.82);
      }
    }
    // 「横」の目印（小さいときは広げられることを示す）
    const tag = this.expanded ? "横から（タップで閉じる）" : "横";
    const fs = this.expanded ? 12 : 11;
    ctx.font = `900 ${fs}px "Zen Kaku Gothic New", system-ui, sans-serif`;
    const tw = ctx.measureText(tag).width + 10;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.beginPath();
    ctx.roundRect(4, 4, tw, fs + 8, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, 9, 4 + (fs + 8) / 2);
  }
}

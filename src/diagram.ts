// 手順ごとの「アームの使い方」図。写真とは別に、横から（回すときは上から）見た
// 簡単なアニメーションで、アームがどこに降りてどう景品を動かすかを見せる。

import type { Analysis, Box, Step, Technique } from "./types";

const NS = "http://www.w3.org/2000/svg";
const W = 240;
const H = 140;
const FLOOR = 116;
const DURATION = 3600;

const C = {
  claw: "#ffd23f",
  clawDark: "#b8901a",
  prize: "#ff4d6d",
  prizeTop: "#ff7a93",
  hole: "#2ee59d",
  floor: "#3a3349",
  stone: "#6f6585",
  arrow: "#ffffff",
};

/** 手順の「技」。Gemini が返さなかったときは矢印から決める */
export function techniqueOf(s: Step): Technique {
  if (s.technique) return s.technique;
  if (s.arrow === "rotate_cw" || s.arrow === "rotate_ccw") return "rotate";
  if (s.arrow === "none") return "press";
  return "push";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
/** 区間 [a, b] での進み具合 0〜1 */
const seg = (t: number, a: number, b: number) => ease(clamp((t - a) / (b - a), 0, 1));

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export class StepDiagram {
  private svg: SVGSVGElement;
  private raf = 0;
  private start = 0;
  private frame: ((t: number) => void) | null = null;

  constructor(private host: HTMLElement) {
    this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "diagram-svg", "aria-hidden": "true" });
    host.append(this.svg);
  }

  show(a: Analysis | null, stepIndex: number) {
    cancelAnimationFrame(this.raf);
    this.svg.replaceChildren();
    this.frame = null;
    const s = a?.steps[stepIndex];
    this.host.hidden = !a || !s;
    if (!a || !s) return;

    const tech = techniqueOf(s);
    // 2手目以降は、前の手のあとの位置を基準にする
    const ref = (stepIndex > 0 && a.steps[stepIndex - 1].after?.box) || a.prize.box;
    this.frame = tech === "rotate" ? this.buildTop(a, s, ref) : this.buildSide(a, s, tech, ref);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      this.frame(0.62); // 爪が閉じて景品が動いたところで止めて見せる
      return;
    }
    this.start = performance.now();
    const tick = () => {
      this.frame?.(((performance.now() - this.start) % DURATION) / DURATION);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  // ---------- 横から見た図（押す・押さえる・持ち上げる） ----------
  private buildSide(a: Analysis, s: Step, tech: Technique, p: Box): (t: number) => void {
    const svg = this.svg;
    const pw = Math.max(1, p[3] - p[1]);
    // 落とし口のある向き（写真の左右）。左右の矢印があればその向き、なければ穴の位置で決める
    const holeCx = (a.hole.box[1] + a.hole.box[3]) / 2;
    const prizeCx = (p[1] + p[3]) / 2;
    const dir = s.arrow === "left" ? -1 : s.arrow === "right" ? 1 : holeCx >= prizeCx ? 1 : -1;

    const boxW = tech === "lift" ? 46 : 76;
    const boxH = 40;
    const lift = a.setupType === "stones" ? 9 : a.setupType === "bridge" ? 14 : 0;
    const holeW = 40;
    const holeX = dir > 0 ? W - holeW - 10 : 10;
    const holeEdge = dir > 0 ? holeX : holeX + holeW; // 景品側の穴の縁
    // 景品の最初の位置。押さえるときは穴に少しはみ出している状態から
    const boxCx0 =
      tech === "press" ? holeEdge - dir * (boxW / 2 - 16) : tech === "lift" ? W / 2 - dir * 40 : W / 2 - dir * 30;
    const boxLeft0 = boxCx0 - boxW / 2;
    const boxBottom = FLOOR - lift;
    const boxTop = boxBottom - boxH;

    // アームを下ろす位置
    let clawX0: number;
    if (tech === "lift") clawX0 = boxCx0;
    else if (tech === "press") clawX0 = boxCx0 + dir * (boxW / 2 - 10); // 穴の上にはみ出した端を押さえる
    else {
      // 押す：写真の目標点を景品の幅に対する割合で写す（奥・手前に押すときは押す側の端）
      // 爪は押したい向きの反対側の端に掛ける
      let rel = clamp((s.target[1] - p[1]) / pw, -0.3, 1.3);
      if (s.arrow === "up" || s.arrow === "down") rel = 0.12;
      if (dir < 0) rel = 1 - rel;
      rel = clamp(rel, -0.2, 0.3);
      clawX0 = boxCx0 - dir * (0.5 - rel) * boxW;
    }

    // 床と落とし口
    svg.append(
      el("path", { d: `M0 ${FLOOR}H${holeX}M${holeX + holeW} ${FLOOR}H${W}`, stroke: C.floor, "stroke-width": 3 }),
      el("rect", { x: holeX, y: FLOOR, width: holeW, height: H - FLOOR, fill: C.hole, opacity: 0.22 }),
      el("path", { d: `M${holeX} ${FLOOR}v${H - FLOOR}M${holeX + holeW} ${FLOOR}v${H - FLOOR}`, stroke: C.hole, "stroke-width": 3 }),
    );
    // 台の種類（石・棒）
    if (a.setupType === "stones") {
      for (let x = 6; x < W; x += 13) {
        if (x > holeX - 5 && x < holeX + holeW + 5) continue;
        svg.append(el("circle", { cx: x, cy: FLOOR - 5, r: 5.5, fill: C.stone }));
      }
    } else if (a.setupType === "bridge") {
      for (const x of [boxLeft0 + 12, boxLeft0 + boxW - 12]) {
        svg.append(el("circle", { cx: x, cy: FLOOR - 7, r: 7, fill: C.stone }));
      }
    }

    // 景品を動かす向き（うっすら、アームと重ならない上の端に）。押さえるときは出さない
    const gx = dir > 0 ? W - 64 : 64;
    if (tech !== "press")
      svg.append(
      el("path", {
        d: `M${gx - dir * 22} 16h${dir * 40}m${-dir * 7}-6 ${dir * 7} 6-${dir * 7} 6`,
        stroke: C.arrow,
        "stroke-width": 3,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: 0.35,
      }),
    );

    // 景品
    const prize = el("g");
    prize.append(
      el("rect", { x: -boxW / 2, y: -boxH, width: boxW, height: boxH, rx: 4, fill: C.prize }),
      el("rect", { x: -boxW / 2, y: -boxH, width: boxW, height: 7, rx: 3, fill: C.prizeTop }),
    );
    svg.append(prize);

    const claw = this.sideClaw(a.clawCount, tech === "lift" ? 0.45 : 1);
    svg.append(claw.g);

    const top = 6;
    // 爪の先がどこで止まるか：景品の上なら景品の上面、それ以外は床
    let boxLeft = boxLeft0;
    const stopY = (x: number) => (x > boxLeft + 2 && x < boxLeft + boxW - 2 ? boxTop : boxBottom);
    // 開いた爪の先が床（景品の上）に届くまで下ろす
    const reach = Math.max(stopY(clawX0 - 20), stopY(clawX0 + 20), stopY(clawX0));
    const downY = tech === "press" ? boxTop - 56 : tech === "lift" ? boxTop - 34 : reach - 55;

    return (t) => {
      const down = seg(t, 0.05, 0.3);
      const close = seg(t, 0.32, 0.5);
      const up = seg(t, 0.62, 0.85);
      let clawX = clawX0;
      let clawY = top + (downY - top) * down;
      let px = boxCx0;
      let py = boxBottom;
      let rot = 0;
      let pivot = 0;
      let grip = close;

      if (tech === "push") {
        // 外側の爪が閉じながら景品の端を押す
        px += dir * 22 * close;
        clawY -= (downY - top) * up;
      } else if (tech === "press") {
        // 穴にはみ出した端を上から押さえる → 縁を支点に傾いて落ちる
        const press = seg(t, 0.3, 0.45);
        const fall = seg(t, 0.45, 0.62);
        clawY += 12 * press - (downY - top + 12) * up;
        rot = dir * (10 * press + 50 * fall);
        pivot = holeEdge - boxCx0; // 穴の縁のあたりを支点に
        px += dir * 14 * fall;
        py += 30 * fall;
        if (t > 0.66) py = H + 60;
        grip = 1; // 閉じた爪の先で押さえる
      } else {
        // つかんで持ち上げ、穴の上まで運んで離す
        const liftY = 44 * seg(t, 0.46, 0.56);
        const carry = seg(t, 0.56, 0.7);
        const release = seg(t, 0.72, 0.76);
        const dx = holeX + holeW / 2 - boxCx0;
        clawX = clawX0 + dx * carry;
        clawY -= liftY;
        px += dx * carry;
        py += -liftY + (liftY + 50) * seg(t, 0.74, 0.82);
        if (t > 0.84) py = H + 60;
        grip = close * (1 - release);
        if (t > 0.78) clawY -= (downY - top - liftY) * seg(t, 0.78, 0.95);
      }

      boxLeft = px - boxW / 2;
      prize.setAttribute("transform", `translate(${px} ${py}) rotate(${rot} ${pivot} 0)`);
      claw.set(clawX, clawY, grip, tech === "push" ? stopY : undefined);
    };
  }

  /**
   * 横から見たアーム。左右の爪（3本爪なら真ん中も）を開閉する。
   * maxClose は閉じきる量（景品をつかむときは途中で止まる）。
   * stop を渡すと、爪の先がその高さより下には行かない（景品の上に乗る）。
   */
  private sideClaw(count: number, maxClose = 1) {
    const g = el("g");
    const cable = el("path", { stroke: C.claw, "stroke-width": 3, "stroke-linecap": "round" });
    const head = el("rect", { x: -13, y: 0, width: 26, height: 11, rx: 4, fill: C.claw });
    const style = { fill: "none", stroke: C.claw, "stroke-width": 5, "stroke-linecap": "round" };
    const left = el("path", style);
    const right = el("path", style);
    const mid = el("path", { ...style, stroke: C.clawDark, "stroke-width": 4 });
    g.append(cable);
    if (count >= 3) g.append(mid);
    g.append(left, right, head);
    const prong = (x: number, yb: number, side: -1 | 1, spread: number, stop?: (x: number) => number) => {
      const tx = x + side * (spread - 10);
      let tip = yb + 44;
      if (stop) tip = Math.min(tip, stop(tx) - 1);
      const mid = (yb + tip) / 2;
      return `M${x + side * 8} ${yb}C${x + side * (spread + 8)} ${yb + 8} ${x + side * spread} ${mid} ${tx} ${tip}`;
    };
    return {
      g,
      set: (x: number, y: number, close: number, stop?: (x: number) => number) => {
        cable.setAttribute("d", `M${x} 0V${y}`);
        head.setAttribute("transform", `translate(${x - 0} ${y})`);
        const spread = 32 - 24 * Math.min(close, maxClose);
        const yb = y + 11;
        left.setAttribute("d", prong(x, yb, -1, spread, stop));
        right.setAttribute("d", prong(x, yb, 1, spread, stop));
        let midTip = yb + 40;
        if (stop) midTip = Math.min(midTip, stop(x) - 1);
        mid.setAttribute("d", `M${x} ${yb}V${midTip}`);
      },
    };
  }

  // ---------- 上から見た図（角を回す） ----------
  private buildTop(a: Analysis, s: Step, p: Box): (t: number) => void {
    const svg = this.svg;
    const pw = Math.max(1, p[3] - p[1]);
    const ph = Math.max(1, p[2] - p[0]);
    const boxW = 84;
    const boxH = 60;
    const cx = W / 2 - 22;
    const cy = H / 2 + 4;
    const rx = clamp((s.target[1] - p[1]) / pw, -0.2, 1.2) - 0.5;
    const ry = clamp((s.target[0] - p[0]) / ph, -0.2, 1.2) - 0.5;
    const cw = s.arrow !== "rotate_ccw";

    // 落とし口（景品の右か左、穴のある側）
    const holeRight = (a.hole.box[1] + a.hole.box[3]) / 2 >= (p[1] + p[3]) / 2;
    const hx = holeRight ? W - 52 : 8;
    svg.append(
      el("rect", { x: hx, y: cy - 24, width: 44, height: 48, rx: 4, fill: C.hole, opacity: 0.22 }),
      el("rect", { x: hx, y: cy - 24, width: 44, height: 48, rx: 4, fill: "none", stroke: C.hole, "stroke-width": 3 }),
    );
    if (a.setupType === "stones") {
      for (let x = 10; x < W - 60; x += 16)
        for (let y = 18; y < H - 6; y += 16) svg.append(el("circle", { cx: x, cy: y, r: 3, fill: C.stone, opacity: 0.5 }));
    }

    // 回る向きの矢印（うっすら）
    const r = 52;
    const a0 = cw ? -2.4 : -0.7;
    const a1 = cw ? -1.3 : -1.8;
    const ex = cx + r * Math.cos(a1);
    const ey = cy + r * Math.sin(a1);
    const tang = a1 + (cw ? Math.PI / 2 : -Math.PI / 2);
    svg.append(
      el("path", {
        d: `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 0 ${cw ? 1 : 0} ${ex} ${ey}`,
        stroke: C.arrow,
        "stroke-width": 3,
        fill: "none",
        "stroke-linecap": "round",
        opacity: 0.35,
      }),
      el("path", {
        d: `M${ex + Math.cos(tang) * 6} ${ey + Math.sin(tang) * 6}L${ex + Math.cos(tang + 2.4) * 8} ${ey + Math.sin(tang + 2.4) * 8}L${ex + Math.cos(tang - 2.4) * 8} ${ey + Math.sin(tang - 2.4) * 8}Z`,
        fill: C.arrow,
        opacity: 0.35,
      }),
    );

    const prize = el("g");
    prize.append(
      el("rect", { x: -boxW / 2, y: -boxH / 2, width: boxW, height: boxH, rx: 4, fill: C.prize }),
      el("rect", { x: -boxW / 2 + 6, y: -boxH / 2 + 6, width: boxW - 12, height: boxH - 12, rx: 3, fill: C.prizeTop, opacity: 0.5 }),
    );
    svg.append(prize);

    // 上から見たアーム（影＋爪）
    const shadow = el("ellipse", { rx: 18, ry: 18, fill: "#000", opacity: 0.35 });
    const clawG = el("g");
    const n = a.clawCount >= 3 ? 3 : 2;
    const prongs = Array.from({ length: n }, () =>
      el("path", { stroke: C.claw, "stroke-width": 5, "stroke-linecap": "round", fill: "none" }),
    );
    clawG.append(...prongs, el("circle", { r: 8, fill: C.claw }), el("circle", { r: 3, fill: C.clawDark }));
    svg.append(shadow, clawG);

    const tx = cx + rx * boxW;
    const ty = cy + ry * boxH;

    return (t) => {
      const down = seg(t, 0.05, 0.3);
      const close = seg(t, 0.32, 0.5);
      const turn = seg(t, 0.36, 0.6);
      const up = seg(t, 0.64, 0.86);
      const scale = 1.35 - 0.35 * down + 0.35 * up; // 近づくと小さく見える＝降りていく
      const rot = (cw ? 1 : -1) * 28 * turn;
      prize.setAttribute("transform", `translate(${cx} ${cy}) rotate(${rot})`);
      // 爪は景品の角と一緒に回る
      const ang = (rot * Math.PI) / 180;
      const dx = tx - cx;
      const dy = ty - cy;
      const kx = cx + dx * Math.cos(ang * close) - dy * Math.sin(ang * close);
      const ky = cy + dx * Math.sin(ang * close) + dy * Math.cos(ang * close);
      clawG.setAttribute("transform", `translate(${kx} ${ky}) scale(${scale})`);
      clawG.setAttribute("opacity", String(0.55 + 0.45 * down * (1 - up)));
      shadow.setAttribute("transform", `translate(${kx + 6} ${ky + 8})`);
      shadow.setAttribute("opacity", String(0.35 * down * (1 - up)));
      const spread = 22 - 13 * close;
      prongs.forEach((pr, i) => {
        const pa = -Math.PI / 2 + (i * Math.PI * 2) / n;
        pr.setAttribute("d", `M${Math.cos(pa) * 6} ${Math.sin(pa) * 6}L${Math.cos(pa) * spread} ${Math.sin(pa) * spread}`);
      });
    };
  }
}


// 座標はすべて写真に対する 0〜1000 の正規化値（Gemini の慣例に合わせて y, x の順）
export type Box = [ymin: number, xmin: number, ymax: number, xmax: number];
export type Point = [y: number, x: number];

export type Arrow =
  | "left"
  | "right"
  | "up"
  | "down"
  | "rotate_cw"
  | "rotate_ccw"
  | "none";

export interface Step {
  title: string;
  text: string;
  /** アームの中心を合わせる位置 */
  target: Point;
  /** 景品をどちらへ動かしたいか */
  arrow: Arrow;
  /** この手がうまくいったあとの景品の位置と向き（予想） */
  after?: Pose;
}

/** 景品の置かれ方。angle は写真上での時計回りの回転（度） */
export interface Pose {
  box: Box;
  angle: number;
}

export interface Analysis {
  setup: string;
  claw: string;
  prize: { label: string; box: Box };
  hole: { box: Box };
  obstacles: { label: string; box: Box }[];
  steps: Step[];
  /** 取れるまでの見込みプレイ回数 */
  tries: { min: number; max: number };
  /** 取れる瞬間の景品の形 */
  goal: Pose & { text: string };
  cautions: string[];
  confidence: "low" | "medium" | "high";
}

export interface PlayLog {
  stepIndex: number;
  result: string;
}

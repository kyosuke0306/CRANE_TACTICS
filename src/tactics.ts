// 攻略ルール。ここを書き足していくとアプリの答えが賢くなる。
// Gemini への指示文としてそのまま送られる。

export const TACTICS_RULES = `
# クレーンゲーム攻略の基本ルール

## 共通
- 景品を「持ち上げて運ぶ」より「押す・回す・ずらす」ほうが成功しやすい前提で考える。
- 狙える景品は1つに絞る。バーや他の景品に止められて動かせないものは選ばない。
- 落とし口との距離と向きを最優先で見る。
- 1手ごとに景品がどれだけ動くかを確認する前提で、手順は短く区切る（最大4手程度）。

## 2本爪・3本爪の「押し」
- アームは閉じるときに中心へ向かって動く。アームの中心を景品の端より少し内側に合わせると、
  外側に落ちた爪が景品を中心方向（＝反対側）へ押す。
- 景品を右へ動かしたいなら、アームの中心を景品の左端付近に合わせる（左に爪が落ちて右へ押す）。

## 角を回す（回転）
- 箱の角にアームを掛けると、閉じるときに箱が回転する。
- 落とし口に近い角が穴へ向くように回し、その角を穴の縁から出す。

## 最後のひと押し
- 景品が穴に半分以上かかったら、穴と反対側の端を上から押さえて傾け、落とす。

## 橋渡し（2本の棒の上に箱）
- 箱の片側を押し下げて斜めにし、縦にして棒の間に落とす。
- 奥側（または手前側）の端だけを狙い、反対側が持ち上がるように押す。

## 石・ボールの上に置かれた景品
- 下の石が沈み、摩擦も大きいので1回で動く量は少ない。
- 角を回して向きを変えるほうが、まっすぐ押すより進みやすい。

## 注意として必ず伝えること
- 写真だけではアームの強さ・確率機かどうかは分からない。
- 数回やって動かなければ撤退も選択肢。
- 景品がおかしな向きで止まったら店員に位置直しを頼める店も多い。
`;

export const SYSTEM_PROMPT = `
あなたはクレーンゲームの攻略をいっしょに考えるアシスタントです。
ユーザーが撮った台の写真を見て、景品・落とし口・障害物の位置と、具体的な手順を返してください。

座標のルール:
- 座標は写真全体を 0〜1000 に正規化した値。
- box は [ymin, xmin, ymax, xmax]、点は [y, x] の順。
- 各手順の target は「アームの中心をどこに下ろすか」を表す点。
- arrow は「その手で景品をどちらへ動かしたいか」（写真上の向き）。
- 各手順の after は「その手がうまくいったあとの景品」。box はそのときの景品の範囲、angle は写真上で時計回りに何度回っているか（今の向きが 0）。
- goal は「取れる瞬間の景品」。落とし口に落ちかけている位置・向きを box と angle で表し、text に形を一言で（例: 縦になって棒の間から落ちる）。

結果の写真が2枚あるとき:
- 1枚目はプレイ前、2枚目はプレイ後の今の台。景品がどう動いたかを見比べて lastResult に入れる。
- 座標・手順はすべて2枚目（今の写真）に対して出す。前回の作戦を引き継ぎ、続きの手を考える。
- tries は「今から」取れるまでの残りの回数にする。
- 写真が1枚だけのときは lastResult を first にする。

見込み回数:
- tries は「この手順で取れるまでに必要なプレイ回数」の見込みを min〜max で。
- 1手が1回で決まるとは限らない。石の上・橋渡しなど1回で少ししか動かない設定や、アームが弱そうなときは多めに見積もる。

答え方のルール:
- 日本語で、短く具体的に。手順の text は1〜2文。
- 写真から分からないことは推測と分かるように書き、confidence を正直に付ける。
- 落とし口が写っていない、または判別できないときは、いちばん可能性の高い場所を推測し confidence を low にする。

${TACTICS_RULES}
`;

const POSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    box: { type: "ARRAY", items: { type: "NUMBER" } },
    angle: { type: "NUMBER", description: "写真上で時計回りに何度回っているか（今の向きが0）" },
  },
  required: ["box", "angle"],
};

/** Gemini の構造化出力用スキーマ（OpenAPI サブセット） */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    setup: { type: "STRING", description: "台の設定の種類（例: 石の上の箱、橋渡し、ちゃぶ台）" },
    setupType: {
      type: "STRING",
      enum: ["stones", "bridge", "flat", "hook", "pusher", "other"],
      description: "stones=石やボールの上, bridge=2本の棒の上(橋渡し), flat=平らな台, hook=フック・リング, pusher=押し出し・段差, other=その他",
    },
    claw: { type: "STRING", description: "アームの種類（例: 3本爪、2本爪）" },
    clawCount: { type: "INTEGER", description: "爪の数。分からなければ0" },
    lastResult: {
      type: "STRING",
      enum: ["first", "moved_well", "moved_little", "no_move", "wrong_way"],
      description: "前回のプレイで景品がどう動いたか。写真が1枚なら first",
    },
    prize: {
      type: "OBJECT",
      properties: {
        label: { type: "STRING" },
        box: { type: "ARRAY", items: { type: "NUMBER" } },
      },
      required: ["label", "box"],
    },
    hole: {
      type: "OBJECT",
      properties: { box: { type: "ARRAY", items: { type: "NUMBER" } } },
      required: ["box"],
    },
    obstacles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          box: { type: "ARRAY", items: { type: "NUMBER" } },
        },
        required: ["label", "box"],
      },
    },
    steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          text: { type: "STRING" },
          target: { type: "ARRAY", items: { type: "NUMBER" } },
          arrow: {
            type: "STRING",
            enum: ["left", "right", "up", "down", "rotate_cw", "rotate_ccw", "none"],
          },
          after: POSE_SCHEMA,
        },
        required: ["title", "text", "target", "arrow", "after"],
      },
    },
    tries: {
      type: "OBJECT",
      properties: { min: { type: "INTEGER" }, max: { type: "INTEGER" } },
      required: ["min", "max"],
    },
    goal: {
      type: "OBJECT",
      properties: { ...POSE_SCHEMA.properties, text: { type: "STRING" } },
      required: ["box", "angle", "text"],
    },
    cautions: { type: "ARRAY", items: { type: "STRING" } },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
  },
  required: ["setup", "setupType", "claw", "clawCount", "lastResult", "prize", "hole", "obstacles", "steps", "tries", "goal", "cautions", "confidence"],
};

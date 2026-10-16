# CRANE_TACTICS

クレーンゲームの台の写真から、**いっしょに作戦を考える** Web アプリ。

写真を送ると Gemini が景品・落とし口・障害物の位置を読み取り、写真の上に
「アームを下ろす位置（◎）」と「景品を動かす方向（→）」を描いて手順を示します。

- 印がずれていたら指でドラッグして直し、その位置で作戦を立て直せる
- プレイ結果（動いた／動かない など）を入れると、次の手を考え直す
- 写真だけではアームの強さや確率機かどうかは分からないので、「正解を出す」のではなく「作戦の提案」

## 使い方

公開ページ: https://kyosuke0306.github.io/CRANE_TACTICS/

1. 右上の設定ボタン（歯車）から Gemini APIキーを入力（[Google AI Studio](https://aistudio.google.com/apikey) で無料取得）
2. 台を撮る → 「作戦を立てる」
3. 手順をめくりながらプレイ → 結果を入れて「次の手を考える」

キーはそのブラウザの localStorage にだけ保存され、Google 以外には送られません。
APIを呼ばずに画面だけ試すには、URL の最後に `?demo=1` を付けます。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173/CRANE_TACTICS/
npm run build
```

| ファイル | 役割 |
| --- | --- |
| `src/tactics.ts` | **攻略ルール**。Gemini への指示文。ここを書き足すと答えが賢くなる |
| `src/gemini.ts` | Gemini 呼び出しと、返ってきた座標の整形 |
| `src/overlay.ts` | 写真の上に印・矢印を描画し、ドラッグで直す |
| `src/main.ts` | 画面の流れ（撮影 → 解析 → 手順 → 結果 → 次の手） |
| `worker/` | APIキーを隠すための中継サーバー（任意） |

## 公開（GitHub Pages）

`main` に push すると GitHub Actions がビルドして公開します。
初回だけ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にしてください。

## 他の人にも使ってもらう場合（任意）

各自がAPIキーを入れなくても使えるようにするには、Cloudflare Workers の中継サーバーを置きます（無料枠あり）。

```bash
cd worker
npx wrangler login
npx wrangler secret put GEMINI_API_KEY   # キーはここにだけ登録する
npx wrangler deploy                      # 表示された URL を控える
```

その URL を GitHub の **Settings → Secrets and variables → Actions → Variables** に
`PROXY_URL` として登録し、もう一度デプロイすると、アプリは中継サーバー経由で動きます。

注意: このとき全員の利用があなたの無料枠から消費されます。Gemini の無料枠では送った写真が
モデル改善に使われる場合があり、商用利用は対象外です。

## ⚠️ APIキーをコードに書かない

このリポジトリは公開されています。APIキーは絶対にコミットしないでください。

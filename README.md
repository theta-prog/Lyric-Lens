# Lyric Lens

TextAlive API とカメラ風ビューファインダー演出で、風景や人物に歌詞の瞬間を重ねて撮影できるリリックアプリです。

## Setup

```bash
npm install
```

TextAlive App Token は環境変数で渡せます。

```bash
cp .env.example .env
```

`.env` に TextAlive App Token を設定してください。

```bash
VITE_TEXTALIVE_TOKEN=your_token
```

設定後に開発サーバーを起動します。

```bash
npm run dev
```

## Scripts

```bash
npm run dev
npm run build
npm run preview
```

## Notes

- デフォルト曲 URL は `https://piapro.jp/t/PNpQ` です。
- 開発サーバーでは Songle 取得用の Vite proxy を使います。
- カメラを許可しない場合も、明るい仮想背景で撮影できます。
- 曲ごとの演出と TextAlive データの使い方は [`docs/visual-system.md`](docs/visual-system.md) にまとめています。

# shutter chance

TextAlive API とカメラ風ビューファインダー演出で「シャッターチャンス」を再生するリリックアプリです。

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

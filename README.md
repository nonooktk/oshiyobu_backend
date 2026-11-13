# oshiyobu_backend

OSHIYOBU（推しを地元に呼ぶ仕組み）のデモの、**計算・デモデータ・人物 15 通りのデータ・共有メーターの小さな API・そのテスト**を置くリポジトリです。

> **デモ用です。** 画面に出す人数・金額・日程・人物は、すべてデモ用の架空のものです。会場の名前とキャパは、公開されている情報を使っています。

名前は backend ですが、中身は小さなものです。共有メーターの API は、公演ごとの人数を返す・参加を 1 件足す・発表者が初めに戻す、の 3 つだけです。**預かるのは人数だけで、個人の情報は預かりません。** DB を使うかどうかと、配備先は、設計の確定後に追記します。

画面は、計算とデータを、版を固定して取り込みます。画面はサーバーにつながらなくても初期値で動く作りなので、API の応答の形を変えるときは、画面（frontend）とセットで進めます。

## 対になるリポジトリ

| リポジトリ | 中身 |
| --- | --- |
| [oshiyobu_frontend](https://github.com/nonooktk/oshiyobu_frontend) | 画面 |
| **oshiyobu_backend**（ここ） | 計算・デモデータ・人物 15 通りのデータ・共有メーターの小さな API・そのテスト |

## はじめ方

- 作業の決まりは [CLAUDE.md](CLAUDE.md) にあります。Claude Code はこのファイルを自動で読みます。
- Git・GitHub の認証・Claude Code の導入、リポジトリの取得、Claude Code の起動までの手順は、対になるリポジトリの [docs/はじめに.md](https://github.com/nonooktk/oshiyobu_frontend/blob/main/docs/%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB.md) と同じです。リポジトリの名前だけ、`oshiyobu_backend` に読み替えてください。
- 環境の作り方と、検査・テストの実行コマンドは、次の「環境とコマンド」のとおりです。

## 技術スタック

- TypeScript（strict）・Node 22 LTS・npm。テストは Vitest、整形は Prettier、lint は ESLint（型を見る規則）。
- 計算とデータ（`src/core/`）は、ブラウザでも Node でも動く純粋な TypeScript で、外部の依存を持ちません。frontend は、この `src/core/` を、ソースのまま固定したコミットで取り込みます。
- 共有メーターの API（`src/server/`。Hono）は、DB を使いません（メモリ + JSON の保存ファイル 1 つ）。API の実装と配備は、これから足します。配備先と手順は、決まりしだいここに追記します。

## 環境とコマンド

Node 22 以上を入れて、リポジトリのフォルダで実行します。

```bash
npm ci               # 依存を入れる（package-lock.json のとおり）
npm run verify       # lint → 整形の確認 → 型 → テスト → ビルドを順に実行（CI の job「verify」と同じ）
```

1 つずつ実行するときは、次のコマンドを使います。

| コマンド | 内容 |
| --- | --- |
| `npm run lint` | ESLint。`src/core/` には、外部への依存・Node だけの API・呼ぶたびに値が変わる関数を禁止する規則もある |
| `npm run format:check` / `npm run format` | Prettier の確認 / 整形 |
| `npm run typecheck` | 型の検査。`tsconfig.core.json`（`src/core/` だけ。lib は ES2022 のみ・types は空）と、全体（`tsconfig.json`）の 2 つ |
| `npm test` | Vitest（単体テスト・ゴールデンテスト） |
| `npm run build` | `src/core/` が外部に依存せず、ブラウザ向けに 1 つに束ねられることの確認（`dist/core.mjs`。Git 管理外） |

## 今の状態

骨組み（B-0）と、計算・データ・人物 15 通り・入力の検査・共有メーターの応答の検査（`src/core/`。B-1）まで入っています。共有メーターの API（`src/server/`）と、配備の仕組み・負荷の試験は、これから足します。

## 構成

```
.
├── CLAUDE.md             作業の決まり（Claude Code が読む）
├── README.md             このファイル
├── src/
│   └── core/             計算・デモデータ・人物 15 通り・入力の検査・API の応答の型（純粋な TypeScript。frontend が取り込む）
├── tests/                テスト（src/ と同じ並び）
├── scripts/              検査・ビルドのスクリプト（Node。OS に依存させない）
├── tsconfig*.json        型の設定（tsconfig.core.json は core 専用）
├── eslint.config.js      lint の設定
├── .claude/
│   └── settings.json     Claude Code に許さない操作の設定（frontend と同じ）
└── .github/              PR のひな形・レビュー担当・依存の更新設定・CI（workflows/ci.yml）
```

> [!NOTE]
> **Hecateq OpenAgent** — [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) の修正フォークです。
> 詳しくは英語の README の [Origin & Attribution](README.md#origin--attribution) をご覧ください。

> **互換性:** 旧プロジェクトとの後方互換性のために、`oh-my-opencode`、`oh-my-openagent` 互換性バイナリアクセスを提供しています。

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md)

</div>

---

> *この文書は簡略な翻訳です。完全なドキュメントは[英語の README](README.md) を参照してください。*

# Hecateq OpenAgent

**日本語** · [English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-cn.md) · [Русский](README.ru.md)

Hecateq OpenAgent — [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) の修正フォークで、Hecateq 拡張（オーケストレーション、メモリシステム、ハンドオフエンジン、カスタムエージェント優先ルーティング）を追加しています。

> **ステータス:** Beta。詳細は英語 README の [Status](README.md#status) を参照してください。

## 由来と帰属

Hecateq OpenAgent は YeonGyu Kim の [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) からフォークされました。このプロジェクトは元の oh-my-openagent プロジェクトと**提携していません**。詳細: [Origin & Attribution](README.md#origin--attribution)。

## クイックスタート

```bash
npm install -g @hecateq/hecateq-openagent@beta
```

`~/.config/opencode/opencode.json` に追加:

```json
{ "plugin": ["@hecateq/hecateq-openagent"] }
```

確認:

```bash
npx hecateq-openagent doctor
```

**互換性:** このパッケージは後方互換性のために `oh-my-openagent` および `oh-my-opencode` バイナリアクセスも提供します。設定ファイル `oh-my-openagent.json[c]` および `oh-my-opencode.json[c]` も移行中に認識されます。

## 設定

JSON Schema 自動補完 URL:

```json
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

設定ファイルは作業ディレクトリから `$HOME` まで上位ディレクトリを検索して読み込まれます。詳細: [Configuration](docs/reference/configuration.md)。

## CLI コマンド

| コマンド | 説明 |
|---------|------|
| `hecateq-openagent` | **プライマリ Hecateq バイナリ** |
| `oh-my-openagent` | 互換性エイリアス |
| `oh-my-opencode` | 互換性エイリアス |

基本コマンド: `install`, `run`, `doctor`, `mcp-oauth`, `get-local-version`, `boulder`, `refresh-model-capabilities`。

Hecateq コマンド (実験的): `hecateq plan`, `hecateq run`, `hecateq resume`, `hecateq status`, `hecateq doctor`。

## 主な機能

- **11 の専門エージェント** (Sisyphus, Hephaestus, Prometheus, Oracle, Librarian, Explore, Atlas, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
- **52+ ライフサイクルフック** (5 階層: Session, ToolGuard, Transform, Continuation, Skill)
- **20–39 ツール** (LSP, AST-grep, grep, glob, バックグラウンドタスク, 委任, スキル, hashline-edit)
- **3 階層 MCP システム**: ビルトイン MCP, Claude Code `.mcp.json`, スキル埋め込み MCP
- **Team Mode**: 並列マルチエージェント協調 (デフォルト OFF)
- **Hecateq オーケストレーション**: 計画、実行、品質ゲート、修復ループ

全機能一覧: [Features Reference](docs/reference/features.md)

## ドキュメント

| セクション | 説明 |
|-----------|------|
| [Overview](docs/guide/overview.md) | アーキテクチャ概要 |
| [Installation Guide](docs/guide/installation.md) | 完全なインストール手順 |
| [Orchestration Guide](docs/guide/orchestration.md) | エージェント連携の詳細 |
| [Configuration Reference](docs/reference/configuration.md) | 全設定オプション |
| [CLI Reference](docs/reference/cli.md) | CLI 完全リファレンス |
| [Features Reference](docs/reference/features.md) | 全機能カタログ |
| [Hecateq Docs](docs/hecateq/) | Hecateq 拡張ドキュメント |

## ライセンスと帰属

**ライセンス:** Sustainable Use License v1.0 (SUL-1.0) — [LICENSE.md](./LICENSE.md) 参照。

**帰属:** このプロジェクトは YeonGyu Kim の [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) からフォークされました。[NOTICE.md](./NOTICE.md) 参照。元のプロジェクトとは提携していません。

> [!NOTE]
> **Hecateq OpenAgent** — [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) の修正フォークです。
> 詳しくは英語の README の [Origin & Attribution](README.md#origin--attribution) をご覧ください。

> **互換性:** 旧プロジェクトとの後方互換性のために、`oh-my-opencode`、`oh-my-openagent` 互換性バイナリアクセスを提供しています。

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md)

</div>

---

> *この文書は翻訳です。最新の Hecateq フォーク情報については、[英語の README](README.md) を参照してください。*

## レビュー

> 「これのおかげで Cursor のサブスクリプションを解約しました。オープンソースコミュニティで信じられないことが起きています。」 - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> 「Claude Code が人間なら 3 ヶ月かかることを 7 日でやるとしたら、Sisyphus はそれを 1 時間でやってのけます。タスクが終わるまでひたすら働き続けます。まさに規律あるエージェントです。」 <br/>- B, Quant Researcher

> 「Oh My Opencode を使って、たった 1 日で 8000 個の eslint 警告を叩き潰しました。」 <br/>- [Jacob Ferrari](https://x.com/jacobferrari_/status/2003258761952289061)

> 「Ohmyopencode と ralph loop を使って、4 万 5 千行の tauri アプリを一晩で SaaS ウェブアプリに変換しました。インタビューモードから始めて、私のプロンプトに対して質問や推奨事項を尋ねました。勝手に作業していくのを見るのは楽しかったし、今朝起きたらウェブサイトがほぼ動いているのを見て驚愕しました！」 - [James Hargis](https://x.com/hargabyte/status/2007299688261882202)

> 「oh-my-opencode を使ってください。もう二度と元には戻れません。」 <br/>- [d0t3ch](https://x.com/d0t3ch/status/2001685618200580503)

> 「何がどうすごいのかまだ上手く言語化できないんですが、開発体験が完全に異次元に到達してしまいました。」 - [苔硯:こけすずり](https://x.com/kokesuzuri/status/2008532913961529372?s=20)

> 「週末にマインクラフト/ソウルライクな化け物を作ろうと、open code、oh my opencode、supermemory で実験中です。昼食後の散歩に行っている間に、しゃがむアニメーションを追加するように指示しておきました。[動画]」 - [MagiMetal](https://x.com/MagiMetal/status/2005374704178373023)

> 「これをコアに取り込んで彼を採用すべきだ。マジで。これ、本当に、本当に、本当に良い。」 <br/>- Henning Kilset

> 「彼を説得できるなら @yeon_gyu_kim を雇ってください。彼が opencode に革命を起こしました。」 <br/>- [mysticaltech](https://x.com/mysticaltech/status/2001858758608376079)

> 「Oh My OpenCode はマジでヤバい」 - [YouTube - Darren Builds AI](https://www.youtube.com/watch?v=G_Snfh2M41M)

---

# Hecateq OpenAgent

Hecateq OpenAgent — [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) のフォークで、Hecateq 拡張（オーケストレーション、メモリシステム、ハンドオフエンジン、カスタムエージェント優先ルーティング）を追加しています。

インストールして `ultrawork` と入力する。それで終わりです。


## インストール

```bash
npm install -g @hecateq/hecateq-openagent@beta
```

OpenCode 設定に追加:

```json
{ "plugin": ["@hecateq/hecateq-openagent"] }
```

詳しくは [インストールガイド](docs/guide/installation.md) を参照してください。

**互換性注記:** このパッケージは後方互換性のために `oh-my-openagent` および `oh-my-opencode` バイナリアクセスも提供します。設定ファイル `oh-my-openagent.json[c]` および `oh-my-opencode.json[c]` も移行中に認識されます。

匿名のテレメトリは、アクティブなインストール数(DAU/WAU/MAU)の集計のためにデフォルトで有効になっています。マシン1台につきUTC日あたり最大1回イベントが送信され、ハッシュ化されたインストール識別子を使用し、生のホスト名は使用せず、PostHog person profile も作成されません。無効化するには `OMO_SEND_ANONYMOUS_TELEMETRY=0` または `OMO_DISABLE_POSTHOG=1` を設定してください。[プライバシーポリシー](docs/legal/privacy-policy.md)と[利用規約](docs/legal/terms-of-service.md)をご覧ください。

---

## はじめに

`ultrawork` (または `ulw`) と入力するだけです。エージェントが全てを処理します。

```
Read this and tell me why it's not just another boilerplate: https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/refs/heads/dev/README.md
```


## ハイライト

### 🪄 `ultrawork`

本当にこれを全部読んでるんですか？信じられない。

インストールして、`ultrawork` (または `ulw`) とタイプする。完了です。

以下に出てくるすべての機能、すべての最適化、何も知る必要はありません。ただ勝手に動きます。

以下のサブスクリプションだけでも `ultrawork` は十分に機能します (このプロジェクトとは無関係であり、個人的な推奨にすぎません):
- [ChatGPT サブスクリプション ($20)](https://chatgpt.com/)
- [Kimi Code サブスクリプション ($19)](https://www.kimi.com/code)
- [GLM Coding プラン ($10)](https://z.ai/subscribe)
- 従量課金 (pay-per-token) の対象であれば、Kimi や Gemini モデルを使っても費用はそれほどかかりません。

|       | 機能                                                     | 何をするのか                                                                                                                                                                                                                   |
| :---: | :------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   🤖   | **規律あるエージェント (Discipline Agents)**             | Sisyphus が Hephaestus、Oracle、Librarian、Explore をオーケストレーションします。完全な AI 開発チームが並列で動きます。                                                                                                        |
|   👥   | **Team Mode** (v4.0, オプトイン)                          | リードエージェント + 最大 8 メンバーの並列実行、リアルタイム tmux 可視化、専用 `team_*` ツール群。`hyperplan`(5 人の敵対的批評家)と `security-research`(3 人のハンター + 2 人の PoC エンジニア)を駆動します。[ドキュメント →](docs/guide/team-mode.md) |
|   ⚡   | **`ultrawork` / `ulw`**                                  | 一言で OK。すべてのエージェントがアクティブになり、終わるまで止まりません。                                                                                                                                                    |
|   🚪   | **[IntentGate](https://factory.ai/news/terminal-bench)** | ユーザーの真の意図を分析してから分類・行動します。もう文字通りに誤解して的外れなことをすることはありません。                                                                                                                   |
|   🔗   | **ハッシュベースの編集ツール**                           | `LINE#ID` のコンテンツハッシュですべての変更を検証します。stale-line エラー 0%。[oh-my-pi](https://github.com/can1357/oh-my-pi) にインスパイアされています。[The Harness Problem →](https://blog.can.ac/2026/02/12/the-harness-problem/) |
|   🛠️   | **LSP + AST-Grep**                                       | ワークスペース単位のリネーム、ビルド前の診断、AST を考慮した書き換え。エージェントに IDE レベルの精度を提供します。                                                                                                            |
|   🧠   | **バックグラウンドエージェント**                         | 5 人以上の専門家を並列で投入します。コンテキストは軽く保ち、結果は準備ができ次第受け取ります。                                                                                                                                 |
|   📚   | **組み込み MCP**                                         | Exa (Web 検索)、Context7 (公式ドキュメント)、Grep.app (GitHub 検索)。常にオンです。                                                                                                                                            |
|   🔁   | **Ralph Loop / `/ulw-loop`**                             | 自己参照ループ。100% 完了するまで絶対に止まりません。                                                                                                                                                                          |
|   ✅   | **Todo Enforcer**                                        | エージェントがサボる？システムが首根っこを掴んで戻します。あなたのタスクは必ず終わります。                                                                                                                                     |
|   💬   | **コメントチェッカー**                                   | コメントから AI 臭い無駄話を排除します。シニアエンジニアが書いたようなコードになります。                                                                                                                                       |
|   🖥️   | **Tmux 統合**                                            | 完全なインタラクティブターミナル。REPL、デバッガー、TUI アプリがすべてリアルタイムで動きます。                                                                                                                                 |
|   🔌   | **Claude Code 互換性**                                   | 既存のフック、コマンド、スキル、MCP、プラグイン？すべてここでそのまま動きます。                                                                                                                                                |
|   🎯   | **スキル内蔵 MCP**                                       | スキルが独自の MCP サーバーを持ち歩きます。コンテキストが肥大化しません。                                                                                                                                                      |
|   📋   | **Prometheus プランナー**                                | インタビューモードで、実行前に戦略的な計画から立てます。                                                                                                                                                                        |
|   🔍   | **`/init-deep`**                                         | プロジェクト全体にわたって階層的な `AGENTS.md` ファイルを自動生成します。トークン効率とエージェントのパフォーマンスの両方を向上させます。                                                                                      |

### 規律あるエージェント (Discipline Agents)

<table><tr>
<td align="center"><img src=".github/assets/sisyphus.png" height="300" /></td>
<td align="center"><img src=".github/assets/hephaestus.png" height="300" /></td>
</tr></table>

**Sisyphus** (`claude-opus-4-7` / **`kimi-k2.6`** / **`glm-5.1`**) はあなたのメインオーケストレーターです。計画を立て、専門家に委任し、攻撃的な並列実行でタスクを完了まで推進します。途中で投げ出すことはありません。

**Hephaestus** (`gpt-5.5`) はあなたの自律的なディープワーカーです。レシピではなく、目標を与えてください。手取り足取り教えなくても、コードベースを探索し、パターンを調査し、エンドツーエンドで実行します。*正当なる職人 (The Legitimate Craftsman).*

**Prometheus** (`claude-opus-4-7` / **`kimi-k2.6`** / **`glm-5.1`**) はあなたの戦略プランナーです。インタビューモードで質問を投げ、スコープを特定し、コードに一行触れる前に詳細な計画を構築します。

すべてのエージェントは、それぞれのモデルの強みに合わせてチューニングされています。手動でモデルを切り替える必要はありません。[詳しくはこちら →](docs/guide/overview.md)

> Anthropic が [私たちのせいで OpenCode をブロックしました。](https://x.com/thdxr/status/2010149530486911014) だからこそ Hephaestus は「正当なる職人 (The Legitimate Craftsman)」と呼ばれているのです。皮肉を込めています。
>
> Opus で最もよく動きますが、Kimi K2.6 + GPT-5.5 の組み合わせだけでも、バニラの Claude Code を軽く凌駕します。設定は一切不要です。

### Team Mode (v4.0)

エージェント 1 体でも速い。調和したチームは*圧倒的*です。

**Team Mode** は oh-my-openagent を「サブエージェント付きの一体のエージェント」から、本物のマルチエージェントシステムへと変えます。リードエージェントがカテゴリ特化のメンバーチームを統括し、全員が**並列で**動き、専用ツール(`team_create`、`team_send_message`、`team_task_create`、`team_status`、…)で通信します。tmux レイアウトの focus + grid ウィンドウで、全メンバーの作業を同時に観察できます。

```jsonc
// .opencode/oh-my-openagent.jsonc
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,
    "tmux_visualization": true
  }
}
```

opencode を再起動すると `team_*` ツールファミリーが解放されます。すでに 2 つのスキルがその上に乗っています:

- **`hyperplan`** — 5 人の敵対的エージェントが、一行のコードが書かれる前に直交する角度から計画を引き裂きます。
- **`security-research`** — 3 人の脆弱性ハンター + 2 人の PoC エンジニアがコードベースを並列で監査。重大度は*実際の悪用可能性*で校正されます。

> **デフォルトは OFF。必要なときに ON。** [Team Mode ガイド全文 →](docs/guide/team-mode.md)

### エージェントのオーケストレーション

Sisyphus がサブエージェントにタスクを委任する際、モデルを直接選ぶことはありません。**カテゴリー** を選びます。カテゴリーは自動的に適切なモデルにマッピングされます:

| カテゴリー           | 用途                                 |
| :------------------- | :----------------------------------- |
| `visual-engineering` | フロントエンド、UI/UX、デザイン      |
| `deep`               | 自律的なリサーチと実行               |
| `quick`              | 単一ファイルの変更、タイポの修正     |
| `ultrabrain`         | ハードロジック、アーキテクチャの決定 |

エージェントは作業の種類を伝えるだけで、ハーネスが適切なモデルを選びます。`ultrabrain` はデフォルトで GPT-5.5 xhigh にルーティングされるようになりました。あなたが触るものは何もありません。

### Claude Code 互換性

Claude Code の設定を頑張りましたね。素晴らしい。

すべてのフック、コマンド、スキル、MCP、プラグインが、変更なしでここで動きます。プラグインも含めて完全互換です。

### エージェントのためのワールドクラスのツール

LSP、AST-Grep、Tmux、MCP が、ただテープで貼り付けただけでなく、本当に「統合」されています。

- **LSP**: `lsp_rename`、`lsp_goto_definition`、`lsp_find_references`、`lsp_diagnostics`。エージェントに IDE レベルの精度を提供。
- **AST-Grep**: 25 言語に対応したパターン認識コード検索と書き換え。
- **Tmux**: 完全なインタラクティブターミナル。REPL、デバッガー、TUI アプリ。エージェントがセッション内で動き続けます。
- **MCP**: Web 検索、公式ドキュメント、GitHub コード検索がすべて組み込まれています。

### スキル内蔵 MCP

MCP サーバーはあなたのコンテキスト予算を食いつぶします。私たちがそれを修正しました。

スキルが独自の MCP サーバーを持ち歩きます。必要なときだけ起動し、タスクのスコープ内だけで生き、終われば消えます。コンテキストウィンドウはきれいに保たれます。

### ハッシュベースの編集 (Codes Better. Hash-Anchored Edits)

ハーネス問題は深刻です。エージェントが失敗する原因の大半はモデルではなく、編集ツールにあります。

> *「どのツールも、モデルに変更したい行に対する安定して検証可能な識別子を提供していません... すべてのツールが、モデルがすでに見た内容を正確に再現することに依存しています。それができないとき、そして大抵はできないのですが、ユーザーはモデルのせいにします。」*
>
> <br/>- [Can Bölük, The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/)

[oh-my-pi](https://github.com/can1357/oh-my-pi) に触発され、**Hashline** を実装しました。エージェントが読むすべての行にコンテンツハッシュがタグ付けされて返ってきます:

```
11#VK| function hello() {
22#XJ|   return "world";
33#MB| }
```

エージェントはこのタグを参照して編集します。最後に読んだ後でファイルが変更されていた場合、ハッシュが一致せず、コードが壊れる前に編集が拒否されます。空白を正確に再現する必要もなく、stale-line エラーもありません。

Grok Code Fast 1 で、成功率が **6.7% → 68.3%** に上昇しました。編集ツールを 1 つ変えただけで、です。

### 深い初期化。`/init-deep`

`/init-deep` を実行してください。階層的な `AGENTS.md` ファイルを生成します:

```
project/
├── AGENTS.md              ← プロジェクト全体のコンテキスト
├── src/
│   ├── AGENTS.md          ← src 専用のコンテキスト
│   └── components/
│       └── AGENTS.md      ← コンポーネント専用のコンテキスト
```

エージェントが関連するコンテキストだけを自動で読み込みます。手動での管理はゼロです。

### プランニング。Prometheus

複雑なタスクですか？プロンプトを投げて祈るのはやめましょう。

`/start-work` で Prometheus が呼び出されます。**本物のエンジニアのようにあなたにインタビューし**、スコープと曖昧さを特定し、コードに触れる前に検証済みの計画を構築します。エージェントは作業を始める前に、自分が何を作るべきか正確に理解しています。

### スキル (Skills)

スキルは単なるプロンプトではありません。それぞれ以下をもたらします:

- ドメインに最適化されたシステム命令。
- 必要なときに起動する組み込み MCP サーバー。
- スコープ制限された権限。エージェントが境界を越えないようにする。

組み込み: `playwright` (ブラウザ自動化)、`git-master` (atomic コミット、rebase 手術)、`frontend-ui-ux` (デザイン重視の UI)。

独自に追加するには `.opencode/skills/*/SKILL.md` または `~/.config/opencode/skills/*/SKILL.md` に配置してください。

**全機能を知りたいですか？** エージェント、フック、ツール、MCP などの詳細は **[機能ドキュメント (Features)](docs/reference/features.md)** をご覧ください。

---

> **oh-my-openagent は初めてですか？** 手に入れるものの全体像は **[Overview](docs/guide/overview.md)** を、エージェント同士の協調については **[Orchestration Guide](docs/guide/orchestration.md)** をお読みください。

## アンインストール

oh-my-openagent を削除するには:

1. **OpenCode の設定からプラグインを削除する**

   `~/.config/opencode/opencode.json` (または `opencode.jsonc`) を編集し、`plugin` 配列から `"oh-my-openagent"` または従来の `"oh-my-opencode"` エントリを削除します:

   ```bash
   # jq を使用
   jq '.plugin = [.plugin[] | select(. != "oh-my-openagent" and . != "oh-my-opencode")]' \
       ~/.config/opencode/opencode.json > /tmp/oc.json && \
       mv /tmp/oc.json ~/.config/opencode/opencode.json
   ```

2. **設定ファイルを削除する (オプション)**

   ```bash
   # 互換期間中に認識されるプラグイン設定ファイルを削除
   rm -f ~/.config/opencode/oh-my-openagent.jsonc ~/.config/opencode/oh-my-openagent.json \
         ~/.config/opencode/oh-my-opencode.jsonc ~/.config/opencode/oh-my-opencode.json

   # プロジェクト設定を削除 (存在する場合)
   rm -f .opencode/oh-my-openagent.jsonc .opencode/oh-my-openagent.json \
         .opencode/oh-my-opencode.jsonc .opencode/oh-my-opencode.json
   ```

3. **削除の確認**

   ```bash
   opencode --version
   # プラグインがロードされなくなっているはずです
   ```

## Features

最初から存在していて当然だと感じる機能たち。一度使うと戻れなくなります。

全体は [Features Documentation](docs/reference/features.md) を参照してください。

**概要:**
- **エージェント**: Sisyphus (メインエージェント)、Prometheus (プランナー)、Oracle (アーキテクチャ・デバッグ)、Librarian (ドキュメント・コード検索)、Explore (高速な codebase grep)、Multimodal Looker
- **バックグラウンドエージェント**: 本物の開発チームのように複数エージェントを並列実行
- **LSP & AST ツール**: リファクタリング、リネーム、診断、AST 対応のコード検索
- **ハッシュベース編集ツール**: `LINE#ID` 参照で全ての変更前に内容を検証。外科的な編集、stale-line エラー 0
- **コンテキスト注入**: AGENTS.md、README.md、条件付きルールを自動注入
- **Claude Code 互換性**: 完全なフックシステム、コマンド、スキル、エージェント、MCP
- **組み込み MCP**: websearch (Exa)、context7 (ドキュメント)、grep_app (GitHub 検索)
- **セッションツール**: セッション履歴のリスト・閲覧・検索・分析
- **生産性機能**: Ralph Loop、Todo Enforcer、Comment Checker、Think Mode など
- **Doctor コマンド**: 組み込みの診断 (`bunx hecateq-openagent doctor`) でプラグイン登録、設定、モデル、環境を検証
- **モデルフォールバック**: `fallback_models` で単純なモデル文字列と per-fallback オブジェクト設定を同じ配列に混在可能
- **ファイルプロンプト**: エージェント設定で `file://` を使ってファイルからプロンプトを読み込み
- **セッション回復**: セッションエラー、コンテキストウィンドウ上限、API 障害からの自動回復
- **モデルセットアップ**: エージェントとモデルのマッチングは [インストールガイド](docs/guide/installation.md#step-5-understand-your-model-setup) に組み込み済み

## 設定

意見のあるデフォルト。それでも手を入れたければ調整可能です。

詳細は [Configuration Documentation](docs/reference/configuration.md) を参照してください。

**概要:**
- **設定ファイルの場所**: 互換性レイヤーは `oh-my-openagent.json[c]` と従来の `oh-my-opencode.json[c]` の両方のプラグイン設定ファイルを認識します。既存のインストールは依然として従来のファイル名を使っていることが多いです。
- **JSONC サポート**: コメントと末尾カンマをサポート
- **エージェント**: どのエージェントについてもモデル、temperature、プロンプト、権限をオーバーライド可能
- **組み込みスキル**: `playwright` (ブラウザ自動化)、`git-master` (atomic コミット)
- **Sisyphus エージェント**: Prometheus (プランナー) と Metis (プランコンサルタント) を伴うメインオーケストレーター
- **バックグラウンドタスク**: プロバイダー/モデル別の同時実行数を設定
- **カテゴリー**: ドメイン別のタスク委任 (`visual`、`business-logic`、カスタム)
- **フック**: 54 以上の組み込みライフサイクルフック（Team Mode 有効時は 61）。すべて `disabled_hooks` で制御可能
- **MCP**: 組み込み websearch (Exa)、context7 (ドキュメント)、grep_app (GitHub 検索)
- **LSP**: リファクタリングツールまで含む完全な LSP サポート
- **Experimental**: 積極的な truncation、自動 resume など


## 著者の言葉

**哲学が知りたいですか？** [Ultrawork Manifesto](docs/manifesto.md) をお読みください。

---

個人プロジェクトで LLM トークン代として 2 万 4 千ドル (約 360 万円) を使い果たしました。あらゆるツールを試し、設定をいじり倒しました。結果、OpenCode の勝ちでした。

私がぶつかったすべての問題とその解決策が、このプラグインに焼き込まれています。インストールして、ただ使ってください。

OpenCode が Debian/Arch だとすれば、oh-my-openagent は Ubuntu/[Omarchy](https://omarchy.org/) です。

[AmpCode](https://ampcode.com) と [Claude Code](https://code.claude.com/docs/overview) から多大な影響を受けています。機能を移植し、多くは改善しました。今もまだ構築中です。これは **Open**Code ですから。

他のハーネスもマルチモデルのオーケストレーションを約束しています。しかし、私たちはそれを「実際に」出荷しています。安定性も備えて。そして実際に動く機能として。

私がこのプロジェクトの最も強迫的なヘビーユーザーです:
- どのモデルのロジックが最も鋭いか？
- デバッグの神は誰か？
- 最も優れた文章を書くのは誰か？
- フロントエンドのエコシステムを支配しているのは誰か？
- バックエンドの覇者は誰か？
- 日常使いで最も速いのはどれか？
- 競合他社は今何を出荷しているか？

このプラグインは、それらの問いに対する蒸留物 (Distillation) です。最高のものをそのまま使ってください。改善点が見つかりましたか？PR はいつでも歓迎します。

**どのハーネスを使うかで悩むのはもうやめましょう。**
**私が自らリサーチし、最高のものを盗んできて、ここに詰め込みます。**

傲慢に聞こえますか？もっと良い方法があるならコントリビュートしてください。大歓迎です。

言及されたどのプロジェクトやモデルとも提携関係はありません。単なる個人的な実験の結果です。

このプロジェクトの 99% は OpenCode で構築されました。私は実は TypeScript をよく知りません。**しかし、このドキュメントは私が自らレビューし、大部分を書き直しました。**

## 導入実績

- [Indent](https://indentcorp.com)
  - インフルエンサーマーケティングソリューション Spray、クロスボーダーコマースプラットフォーム vovushop、AI コマースレビューマーケティングソリューション vreview の開発元。
- [Google](https://google.com)
- [Microsoft](https://microsoft.com)
- [Vercel](https://vercel.com)
- [ELESTYLE](https://elestyle.jp)
  - マルチモバイル決済ゲートウェイ elepay、キャッシュレスソリューション向けモバイルアプリケーション SaaS OneQR の開発元。
- [Deepgram](https://deepgram.com)

*素晴らしいヒーロー画像を提供してくれた [@junhoyeo](https://github.com/junhoyeo) 氏に特別な感謝を。*

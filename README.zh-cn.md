> [!NOTE]
> **Hecateq OpenAgent** — 是 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 的修改版分支。
> 详情请参阅英文 README 的 [Origin & Attribution](README.md#origin--attribution) 部分。

> **兼容性:** 提供 `oh-my-opencode`、`oh-my-openagent` 兼容性二进制别名，以保持与原始项目的向后兼容性。

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md)

</div>

---

> *本文档为简略翻译版本。完整文档请参阅[英文 README](README.md)。*

# Hecateq OpenAgent

**简体中文** · [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md)

Hecateq OpenAgent — 是 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) 的修改版分支，增加了 Hecateq 扩展（编排系统、记忆系统、交接引擎、自定义代理优先路由）。

> **状态:** Beta。详见英文 README 的 [Status](README.md#status)。

## 来源与归属

Hecateq OpenAgent 衍生自 YeonGyu Kim 的 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)。本项目**不隶属于**原始 oh-my-openagent 项目。详情: [Origin & Attribution](README.md#origin--attribution)。

## 快速开始

```bash
npm install -g @hecateq/hecateq-openagent@beta
```

添加到 `~/.config/opencode/opencode.json`：

```json
{ "plugin": ["@hecateq/hecateq-openagent"] }
```

验证：

```bash
npx hecateq-openagent doctor
```

**兼容性：** 该软件包还提供 `oh-my-openagent` 和 `oh-my-opencode` 二进制别名以保持向后兼容性。配置文件 `oh-my-openagent.json[c]` 和 `oh-my-opencode.json[c]` 在迁移期间也会被识别。

## 配置

JSON Schema 自动补全 URL：

```json
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

配置文件从工作目录向上搜索至 `$HOME`。详情: [Configuration](docs/reference/configuration.md)。

## CLI 命令

| 命令 | 说明 |
|------|------|
| `hecateq-openagent` | **主要 Hecateq 二进制** |
| `oh-my-openagent` | 兼容性别名 |
| `oh-my-opencode` | 兼容性别名 |

基本命令: `install`, `run`, `doctor`, `mcp-oauth`, `get-local-version`, `boulder`, `refresh-model-capabilities`。

Hecateq 命令 (实验性): `hecateq plan`, `hecateq run`, `hecateq resume`, `hecateq status`, `hecateq doctor`。

## 核心功能

- **11 个专业代理** (Sisyphus, Hephaestus, Prometheus, Oracle, Librarian, Explore, Atlas, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
- **52+ 生命周期钩子** (5 层: Session, ToolGuard, Transform, Continuation, Skill)
- **20–39 个工具** (LSP, AST-grep, grep, glob, 后台任务, 委派, 技能, hashline-edit)
- **3 层 MCP 系统**: 内置 MCP, Claude Code `.mcp.json`, 技能嵌入式 MCP
- **Team Mode**: 并行多代理协作 (默认关闭)
- **Hecateq 编排**: 计划、执行、质量门、修复循环

完整列表: [Features Reference](docs/reference/features.md)

## 文档

| 章节 | 说明 |
|------|------|
| [Overview](docs/guide/overview.md) | 架构概览 |
| [Installation Guide](docs/guide/installation.md) | 完整安装指南 |
| [Orchestration Guide](docs/guide/orchestration.md) | 代理协作方式 |
| [Configuration Reference](docs/reference/configuration.md) | 所有配置选项 |
| [CLI Reference](docs/reference/cli.md) | 完整 CLI 参考 |
| [Features Reference](docs/reference/features.md) | 完整功能目录 |
| [Hecateq Docs](docs/hecateq/) | Hecateq 扩展文档 |

## 许可证与归属

**许可证:** Sustainable Use License v1.0 (SUL-1.0) — 参见 [LICENSE.md](./LICENSE.md)。

**归属:** 本项目衍生自 YeonGyu Kim 的 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)。参见 [NOTICE.md](./NOTICE.md)。与原始项目无关联。

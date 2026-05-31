> [!NOTE]
> **Hecateq OpenAgent** — модифицированный форк [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent).
> См. [Origin & Attribution](README.md#origin--attribution) в английском README.

> **Совместимость:** Поставляется с бинарными алиасами совместимости (`oh-my-opencode`, `oh-my-openagent`) для обратной совместимости с исходным проектом.

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md) | [Русский](README.ru.md)

</div>

---

> *Этот документ является кратким переводом. Полная документация — на [английском README](README.md).*

# Hecateq OpenAgent

**Русский** · [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-cn.md)

Hecateq OpenAgent — это модифицированный форк [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) с расширениями Hecateq: оркестрация, система памяти, handoff-движок, маршрутизация через пользовательских агентов.

> **Статус:** Beta. См. [статус и ограничения](README.md#status) в английском README.

## Происхождение и атрибуция

Hecateq OpenAgent — модифицированный форк [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) YeonGyu Kim. Проект **не аффилирован** с оригинальным проектом oh-my-openagent. См. [Origin & Attribution](README.md#origin--attribution).

## Быстрый старт

```bash
npm install -g @hecateq/hecateq-openagent@beta
```

Добавьте в `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["@hecateq/hecateq-openagent"] }
```

Проверьте:

```bash
npx hecateq-openagent doctor
```

**Совместимость:** Пакет также предоставляет бинарные алиасы `oh-my-openagent` и `oh-my-opencode` для обратной совместимости с оригинальным проектом. Файлы конфигурации `oh-my-openagent.json[c]` и legacy `oh-my-opencode.json[c]` также распознаются.

## Конфигурация

Схема JSON Schema для автодополнения:

```json
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

Конфигурационные файлы загружаются с ближайшей директории до `$HOME`. См. [Configuration](docs/reference/configuration.md).

## Команды CLI

| Команда | Описание |
|---------|----------|
| `hecateq-openagent` | **Основной бинарный файл Hecateq** |
| `oh-my-openagent` | Алиас совместимости |
| `oh-my-opencode` | Алиас совместимости |

Базовые команды: `install`, `run`, `doctor`, `mcp-oauth`, `get-local-version`, `boulder`, `refresh-model-capabilities`.

Команды Hecateq (экспериментальные): `hecateq plan`, `hecateq run`, `hecateq resume`, `hecateq status`, `hecateq doctor`.

## Основные возможности

- **11 специализированных агентов** (Sisyphus, Hephaestus, Prometheus, Oracle, Librarian, Explore, Atlas, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
- **52+ хуков жизненного цикла** (5 уровней: Session, ToolGuard, Transform, Continuation, Skill)
- **20–39 инструментов** (LSP, AST-grep, grep, glob, фоновые задачи, делегирование, skills, hashline-edit)
- **3-уровневая MCP система**: встроенные MCP, `.mcp.json` Claude Code, MCP встроенные в skills
- **Team Mode**: параллельная многопользовательская координация (отключен по умолчанию)
- **Оркестрация Hecateq**: планирование, выполнение, контроль качества, цикл восстановления

Полный список: [Features Reference](docs/reference/features.md)

## Документация

| Раздел | Описание |
|--------|----------|
| [Overview](docs/guide/overview.md) | Обзор архитектуры |
| [Installation Guide](docs/guide/installation.md) | Полная установка |
| [Orchestration Guide](docs/guide/orchestration.md) | Как агенты взаимодействуют |
| [Configuration Reference](docs/reference/configuration.md) | Все опции конфигурации |
| [CLI Reference](docs/reference/cli.md) | Полная справка по CLI |
| [Features Reference](docs/reference/features.md) | Полный каталог функций |
| [Hecateq Docs](docs/hecateq/) | Документация расширений Hecateq |

## Лицензия и атрибуция

**Лицензия:** Sustainable Use License v1.0 (SUL-1.0) — см. [LICENSE.md](./LICENSE.md).

**Атрибуция:** Этот проект — модифицированный форк [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) YeonGyu Kim. См. [NOTICE.md](./NOTICE.md). Проект не аффилирован с оригинальным проектом.

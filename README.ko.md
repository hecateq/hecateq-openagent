> [!NOTE]
> **Hecateq OpenAgent** — [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)의 수정된 포크입니다.
> 자세한 내용은 영어 README의 [Origin & Attribution](README.md#origin--attribution)을 참조하세요.

> **호환성:** 이전 프로젝트와의 역호환성을 위해 `oh-my-opencode`, `oh-my-openagent` 호환성 바이너리 앨리어스를 제공합니다.

<div align="center">

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md)

</div>

---

> *이 문서는 간략한 번역본입니다. 전체 문서는 [영문 README](README.md)를 참조하세요.*

# Hecateq OpenAgent

**한국어** · [English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-cn.md) · [Русский](README.ru.md)

Hecateq OpenAgent — [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)의 수정된 포크로, Hecateq 확장(오케스트레이션, 메모리 시스템, 핸드오프 엔진, 커스텀 에이전트 우선 라우팅)을 추가했습니다.

> **상태:** Beta. 자세한 내용은 영문 README의 [Status](README.md#status)를 참조하세요.

## 기원 및 저작자 표시

Hecateq OpenAgent는 YeonGyu Kim의 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)에서 포크되었습니다. 이 프로젝트는 원본 oh-my-openagent 프로젝트와 **제휴 관계가 아닙니다**. 자세한 내용: [Origin & Attribution](README.md#origin--attribution).

## 빠른 시작

```bash
npm install -g @hecateq/hecateq-openagent@beta
```

`~/.config/opencode/opencode.json`에 추가:

```json
{ "plugin": ["@hecateq/hecateq-openagent"] }
```

확인:

```bash
npx hecateq-openagent doctor
```

**호환성:** 이 패키지는 역호환성을 위해 `oh-my-openagent` 및 `oh-my-opencode` 바이너리 앨리어스도 제공합니다. 설정 파일 `oh-my-openagent.json[c]` 및 `oh-my-opencode.json[c]`도 마이그레이션 중에 인식됩니다.

## 설정

JSON Schema 자동완성 URL:

```json
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

설정 파일은 작업 디렉토리에서 `$HOME`까지 상위 디렉토리에서 로드됩니다. 자세한 내용: [Configuration](docs/reference/configuration.md).

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `hecateq-openagent` | **기본 Hecateq 바이너리** |
| `oh-my-openagent` | 호환성 앨리어스 |
| `oh-my-opencode` | 호환성 앨리어스 |

기본 명령어: `install`, `run`, `doctor`, `mcp-oauth`, `get-local-version`, `boulder`, `refresh-model-capabilities`.

Hecateq 명령어 (실험적): `hecateq plan`, `hecateq run`, `hecateq resume`, `hecateq status`, `hecateq doctor`.

## 핵심 기능

- **11개 전문화된 에이전트** (Sisyphus, Hephaestus, Prometheus, Oracle, Librarian, Explore, Atlas, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
- **52+ 라이프사이클 훅** (5개 계층: Session, ToolGuard, Transform, Continuation, Skill)
- **20–39개 도구** (LSP, AST-grep, grep, glob, 백그라운드 작업, 위임, 스킬, hashline-edit)
- **3계층 MCP 시스템**: 내장 MCP, Claude Code `.mcp.json`, 스킬 내장 MCP
- **Team Mode**: 병렬 멀티 에이전트 협업 (기본 OFF)
- **Hecateq 오케스트레이션**: 계획, 실행, 품질 게이트, 복구 루프

전체 목록: [Features Reference](docs/reference/features.md)

## 문서

| 섹션 | 설명 |
|------|------|
| [Overview](docs/guide/overview.md) | 아키텍처 개요 |
| [Installation Guide](docs/guide/installation.md) | 전체 설치 가이드 |
| [Orchestration Guide](docs/guide/orchestration.md) | 에이전트 협업 방식 |
| [Configuration Reference](docs/reference/configuration.md) | 모든 설정 옵션 |
| [CLI Reference](docs/reference/cli.md) | 전체 CLI 참조 |
| [Features Reference](docs/reference/features.md) | 전체 기능 카탈로그 |
| [Hecateq Docs](docs/hecateq/) | Hecateq 확장 문서 |

## 라이선스 및 저작자 표시

**라이선스:** Sustainable Use License v1.0 (SUL-1.0) — [LICENSE.md](./LICENSE.md) 참조.

**저작자 표시:** 이 프로젝트는 YeonGyu Kim의 [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)에서 포크되었습니다. [NOTICE.md](./NOTICE.md) 참조. 원본 프로젝트와 제휴 관계가 아닙니다.

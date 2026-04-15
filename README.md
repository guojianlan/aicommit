# aicommit

AI 驱动的 commit message 生成器。比 aicommits / opencommit 多做了三件事：

1. **读项目自身规范** —— 自动加载 `commitlint` 配置（拿到允许的 type/scope、长度上限）+ `CLAUDE.md` / `AGENTS.md` / `.cursorrules` 等约定文档
2. **生成 → commitlint 自检 → 失败重试** —— 不通过校验的 message 永远不会落到你手上
3. **基于 AI SDK** —— 一份代码同时支持 OpenAI 兼容（DeepSeek/Qwen/Moonshot/Groq/Azure/ollama 等）和 Anthropic 原生 API，切换只改配置

## 安装

```bash
cd scripts/aicommit
pnpm install
pnpm link --global   # 暴露 `aicommit` 命令到全局
```

> 这是一个独立 package，不会进入 funhub 的 pnpm workspace，不污染主项目依赖。

## 配置

第一次使用必须配置 provider / baseUrl / apiKey / model。配置存在 `~/.aicommitrc.json`（自动设为 `0600`）。

### OpenAI 兼容（DeepSeek 示例）

```bash
aicommit config set provider openai
aicommit config set baseUrl https://api.deepseek.com/v1
aicommit config set apiKey  sk-xxxxxxxx
aicommit config set model   deepseek-chat
```

### OpenAI 官方

```bash
aicommit config set provider openai
aicommit config set baseUrl https://api.openai.com/v1
aicommit config set apiKey  sk-xxxxxxxx
aicommit config set model   gpt-4o-mini
```

### Anthropic 原生

```bash
aicommit config set provider anthropic
aicommit config set apiKey   sk-ant-xxxx
aicommit config set model    claude-3-5-sonnet-latest
```

### 其他可选项

```bash
aicommit config set language     zh        # 'zh' | 'en'，默认 zh
aicommit config set maxDiffChars 12000     # 超长 diff 的截断阈值
aicommit config show                        # 查看（apiKey 已遮蔽）
aicommit config path                        # 打印配置文件路径
```

## 使用

```bash
# 1. 暂存改动
git add -p

# 2. 生成 commit message（默认只打印不提交）
aicommit

# 3. 直接生成并提交
aicommit -y

# 4. 生成后进编辑器再改
aicommit -e

# 临时切换模型 / provider
aicommit --model gpt-4o
aicommit --provider anthropic --model claude-3-5-sonnet-latest

# 关闭 commitlint 自检
aicommit --no-lint
```

## 工作原理

```
git diff --cached  ┐
git diff --stat    │
git log -n 15      ├─→  prompt（system 含规则/约定/示例，user 含本次 diff）
CLAUDE.md          │                   │
AGENTS.md          │                   ▼
commitlint config  ┘            AI SDK generateText
                                      │
                                      ▼
                            commitlint 自检
                                      │
                          ┌───────────┴───────────┐
                       valid                    invalid
                          │                       │
                          ▼               把错误回喂模型重试 (≤2 次)
                  打印 / 提交
```

## 项目结构

```
src/
├── cli.ts        # commander 入口
├── config.ts     # ~/.aicommitrc.json 读写
├── git.ts        # git 命令封装
├── context.ts    # 读 CLAUDE.md / AGENTS.md / commitlint
├── prompt.ts     # system + user prompt 拼装（含 ticket 提取、diff 智能裁剪）
├── llm.ts        # AI SDK 调用
└── lint.ts       # @commitlint/lint 自检
```

## 隐私说明

- 只发送已 `git add` 的 diff，不会读未暂存内容
- diff 与项目约定文档会发送到你配置的 `baseUrl`，请确保该端点符合你/团队的合规要求
- `apiKey` 存在 `~/.aicommitrc.json` 并设为 `0600`

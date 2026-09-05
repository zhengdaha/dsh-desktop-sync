---
name: requirement-management
description: 需求分析与需求管理 preset（req-mgr）的完整操作规范：配置引导（仓库地址/分支/需求存储目录）、需求存储目录与文件格式规范、新需求处理流程（检索已有需求 → 拉取最新代码 → 结合代码分析 → 用户决策入库）、分析报告模板与索引维护。处理任何需求相关任务前先加载本技能。
---

# 需求分析与需求管理

本技能是 `req-mgr` preset 的操作手册。开始任何需求相关工作前先通读本技能，处理过程中按流程执行。

## 1. 配置引导（每个新会话开始处理第一个需求前执行一次）

三项配置：

- `GITHUB_REPO`：代码仓库地址
- `GITHUB_BRANCH`：分支名
- `REQUIREMENTS_DIR`：需求存储目录

配置保存在 `<REQUIREMENTS_DIR>/.reqmgr/config.json`：

```json
{
  "githubRepo": "https://github.com/org/repo.git",
  "githubBranch": "main",
  "requirementsDir": "/absolute/path/to/requirements"
}
```

引导步骤：

1. 若 `<REQUIREMENTS_DIR>` 已知：检查 config.json 是否存在。
2. config.json 存在：读取并展示配置（仓库、分支、存储目录），确认存储目录可读。
3. 不存在或用户要求重新配置：用 ask_user_question 一次问清三项配置（仓库地址、分支名、存储目录）。
4. 校验仓库：`git ls-remote --heads <GITHUB_REPO> <GITHUB_BRANCH>`；失败则告知用户检查地址/分支/网络/凭据。
5. 创建目录结构并写入 config.json：
   - `<REQUIREMENTS_DIR>/README.md`
   - `<REQUIREMENTS_DIR>/requirements/`
   - `<REQUIREMENTS_DIR>/.reqmgr/config.json`
6. 向用户报告配置已就绪。

## 2. 需求存储规范

```
<REQUIREMENTS_DIR>/
├── README.md                # 索引：全部需求（编号、标题、状态、优先级、创建时间）
├── requirements/            # 每个需求一个 Markdown 文件
│   ├── REQ-0001-<slug>.md
│   └── REQ-0002-<slug>.md
└── .reqmgr/
    └── config.json          # preset 配置（不进入索引）
```

需求文件格式（YAML front matter + 正文）：

```markdown
---
id: REQ-0001
title: 需求标题
status: proposed          # proposed | accepted | rejected | in-progress | done | duplicate
priority: high            # high | medium | low
source: user              # user | issue | meeting | review | other
created: YYYY-MM-DD
related: []               # 相关需求编号，如 [REQ-0002]
conflicts: []             # 矛盾需求编号
---
# REQ-0001 需求标题

## 背景与描述
（原始需求描述）

## 验收标准
（可验证的验收标准；缺失则写“待补充”）

## 代码对照分析
（结合仓库代码的分析：涉及模块/文件、可行性、影响范围、与已有需求的冲突、工作量、风险）

## 决策记录
（决策时间、决策人、结果与理由）
```

规则：

- 编号从 `REQ-0001` 起递增，永不复用。
- `slug` 用标题的英文短横线形式（如 `add-login-oauth`）；没有英文则用拼音或 `req-<id>`。
- 判定为重复的需求不单独编号：`status: duplicate`，在 `related` 指向原始需求。
- 每次新增或状态变更后，同步更新 `README.md` 索引（表格形式：编号/标题/状态/优先级/创建时间）。

## 3. 新需求处理流程

### 步骤 1：规范化需求

从用户描述提取：标题、详细描述、验收标准（缺失标注“待补充”）、优先级（缺失则按用户说法推断并标注）、来源。关键信息有歧义时，用 ask_user_question 澄清（一次最多 2–3 个问题）。

### 步骤 2：检索需求存储

1. `ls <REQUIREMENTS_DIR>/requirements/` 列出全部需求文件；读 `<REQUIREMENTS_DIR>/README.md` 索引。
2. 从需求描述提取 3–8 个关键词（含中英文），逐个 grep：
   - `grep -ril "<关键词>" <REQUIREMENTS_DIR>/requirements/`
3. 对命中文件逐个读取，判断与当前需求的关系：
   - 重复：语义基本一致 → 建议不重复入库；
   - 相关：部分重叠或上下游关系 → 建议在 `related` 中引用；
   - 矛盾：目标或约束互斥 → 必须列出冲突点，建议在 `conflicts` 中引用。
4. 输出“已有需求检索结果”小节：命中需求编号、标题、关系、依据。

### 步骤 3：拉取最新代码

工作区固定目录：`<会话工作区>/_src`（不存在则创建）。

```bash
# 首次：浅克隆指定分支
git clone --depth 1 --branch <GITHUB_BRANCH> <GITHUB_REPO> <工作区>/_src

# 已有克隆：更新到分支最新
git -C <工作区>/_src fetch origin <GITHUB_BRANCH>
git -C <工作区>/_src reset --hard origin/<GITHUB_BRANCH>
```

- 克隆较慢或仓库较大时，用 run_in_background: true 后台执行，同时继续需求存储检索等独立工作。
- 克隆后先 ls 顶层结构与关键目录，再用 find/grep 定位与需求相关的模块和文件，read 关键实现（入口、接口、数据模型、相关模块）。

### 步骤 4：结合代码分析

产出结构化分析：

- 可行性：技术上是否可实现，有无明显阻碍；
- 影响范围：涉及的模块、文件、接口、数据模型（列出具体路径）；
- 架构契合度：与现有设计模式、模块边界的匹配程度；
- 与已存需求的关系：重复/相关/矛盾结论（引用需求编号）；
- 工作量与风险：粗略工作量（S/M/L 或人日）、主要风险点；
- 结论建议：接受 / 拒绝 / 需澄清 / 与某需求合并，附理由。

### 步骤 5：征求用户决定并入库

用 ask_user_question 提供选项：

- 加入需求存储（status: proposed）
- 加入但标记需澄清（status: proposed，正文标注待澄清点）
- 不加入
- 与已有需求合并（需用户指明合并到哪个需求）

用户确认后：

1. 生成需求文件 `requirements/REQ-000N-<slug>.md`（按第 2 节格式），把步骤 4 的分析写入“代码对照分析”小节。
2. 更新 `README.md` 索引。
3. 向用户报告写入的文件路径与编号。

## 4. 常见命令速查

```bash
# 存储检索
ls <REQUIREMENTS_DIR>/requirements/
grep -ril "关键词" <REQUIREMENTS_DIR>/requirements/
# 代码更新
git -C <工作区>/_src fetch origin <GITHUB_BRANCH>
git -C <工作区>/_src reset --hard origin/<GITHUB_BRANCH>
# 仓库校验
git ls-remote --heads <GITHUB_REPO> <GITHUB_BRANCH>
```

## 5. 边界与异常

- 私有仓库：需要凭据时告知用户配置（SSH key 或 HTTPS token），不擅自处理凭据。
- 分支不存在：ls-remote 校验失败时，把可用分支列给用户确认。
- 仓库过大或浅克隆失败：改用 `git clone --filter=blob:none --branch <branch> <repo> <dir>` 或提示用户。
- 需求存储不可写：告知用户换一个可写目录。
- 离线无法拉取代码：明确告知“本次分析未基于最新代码”，仅基于存储内容给出初步判断。
- 本 preset 不修改仓库代码；如需提交代码，请切换到编码类 preset。

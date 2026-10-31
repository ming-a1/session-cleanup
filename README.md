# 会话清理 (session-cleanup)

给 DeepSeek Harness 的侧栏加一个「会话清理」面板：按工作区管理会话——归档、删除到回收站、恢复、查看对话记录。

## 能做什么

- **置顶同步**：置顶的会话在各组内置顶（按置顶时间排序），并带「置顶」标记
- **按工作区分组**；子代理自动挂到父会话下（缩进、默认折叠，点父行展开/收起，同一时间只展开一组）
- **勾选级联**：勾父会话会连同整棵子代理子树一起勾选；父/子都没勾选时点父行的删除按钮，默认删除父 + 全部子代理；删子代理不会动父代理
- **查看对话记录**：每行「查看」打开会话详情——工作目录、对话轮次、用户消息、工具调用、文件大小、创建时间；下方按轮次折叠的提问记录
  - 手风琴：一次只展开一轮，展开后显示助手回复与工具名
  - 提问与回复用不同底色/角色标签区分；时间统一 `YYYY-MM-DD HH:mm:ss`
  - 最多返回最近 200 轮 / 20 万字符，超出在底部提示（统计数字仍按完整日志计数）
- **归档 / 恢复**：走 Harness 原生 workspace 归档，文件保留、可恢复
- **删除 = 移到回收站**：整个会话目录移出存储根，默认保留 7 天，期间可恢复
  - 删除前预检：可删几个、总大小、每个会话的名称、哪些删不了及原因
  - 运行中的会话会被拒绝；空闲但已加载在内存里的会话可以删，删除时自动归档隐藏残留行
- **回收站**：列表显示标题、删除时间、剩余天数、大小；支持恢复、永久删除（二次确认）
  - 保留天数可在回收站里改成 1–365 天，改完对已有条目也生效
  - 过期自动清理：打开回收站时 + Host 每小时扫描一次
  - 回收站位于会话存储根同级的 `.session-cleanup-trash/`，不在存储根里，所以不会被会话列表扫到
- **刷新**：手动重新拉取会话列表并扫描「内存里还有、磁盘已无存储」的残留会话，这类行在面板里直接隐藏（即使开着「显示已归档」）
- 会话 ID 完整显示（等宽字体、自动换行），不再截成 `session-`
- **备份 / 恢复**：
  - 单会话备份：每行「备份」直接下载
  - 全会话备份：工具栏「备份」→ 导出全部会话
  - 格式为 `.tar.gz`：`manifest.json` + 各会话目录（原样日志），可导入到其他 DSH
  - 导入不覆盖已存在会话，会校验路径与日志头；导入后自动刷新列表
- 侧栏会话「···」菜单里也有「删除会话」（与面板同一套回收站逻辑，不开面板也能用）
- 附带 agent 工具 `session_cleanup`（`preview` / `delete`，`delete` 同样是移到回收站）

## 安全设计

- 没有官方「删除会话」API，本插件按 JSONL 后端的磁盘布局定位目录，删前依次校验：
  1. 目录名必须是会话 ID 的精确路径编码，且能反解回同一 ID
  2. 目录必须位于存储根的项目目录下，内容只允许会话日志代际和 `session.lock`
  3. 日志头能读到时会话 ID 必须一致
- 任一项不符合就中止并报「不安全」，不会盲目 `rm`
- 移动失败（跨盘复制出错等）会回滚已做的归档并清理半成品条目
- 回收站元数据与设置用临时文件 + rename 原子写

## 安装

1. 解包到任意目录，例如 `~/plugins/session-cleanup`
2. 在目标 profile 里安装这个 bundle：
   - 用 Harness 的 Plugin Manager / `plugin_manager` 工具的 `install_bundle`，目标指向解包后的目录
   - 或把目录加入 profile 的 `package.json` 依赖与 `dsh.profile.bundles`
3. 左侧栏出现「会话清理」图标

Host 端注册了删除接口，**更新已安装副本后需要重启 `dsh web`**（只改客户端面板时刷新页面即可）。

## 发布到 Git / 插件广场（Discover）

Harness 没有官方插件索引，插件广场只搜索**用户自己添加的索引源**。两步：把包放到 Git 上，再提供一个符合 format 1 的索引 JSON，让对方添加这个索引 URL。

1. 推到 GitHub / Gitee（包目录就是仓库根目录）：

```bash
git init && git add . && git commit -m "session-cleanup 1.5.0"
git branch -M main
git remote add origin git@github.com:<your-name>/session-cleanup.git
git push -u origin main
```

2. 生成索引（`<commit>` 用 `git rev-parse HEAD`）：

```bash
node scripts/make-market-index.mjs \
  --repo https://github.com/<your-name>/session-cleanup \
  --commit <commit> \
  --author "<your-name>" \
  --out plugin-market.json
git add plugin-market.json && git commit -m "add market index" && git push
```

3. 索引要用**不重定向**的 https 地址（market 拒绝 3xx）：
   `https://raw.githubusercontent.com/<your-name>/session-cleanup/main/plugin-market.json`

4. Harness：Plugins 页 → Experimental plugins 开启 **Custom plugin markets** → **Discover** → 添加索引 URL → 搜「会话清理」。

注意：
- 索引里 `name` 必须等于包的 npm 名。改包名时要同步改 `package.json`、`cordis.patch.yml` 的行 `name`、`client.js` 的 `__ModuleLoader__.load({ id })`，再重新生成索引
- 索引里的版本按 commit 锁定（`git+<repo>.git#<sha>`）；每次发版都要重新生成索引并更新 commit
- 想用 npm 源发布，先去掉 `private: true`、把 `@local/...` 换成自己的 npm scope，并把索引里该版本的 `source` 改成 `{ "type": "npm" }`
- 想让所有人搜到，需要一个公共索引（社区维护或自建），把你的条目 PR 进去；本地添加索引只对自己生效

## 已知限制

- 仅适配 HTML/JSONL 会话后端；换存储或改路径编码时删除会安全失败而不是误删
- 运行中的会话不能删，等这一轮结束
- 会话被删除时若其 Agent 还在 Host 内存里，原生侧边栏的「已归档」仍能看到这条残留；插件面板已隐藏它，重启 `dsh web` 后彻底消失
- 对话记录会先把整份日志读入 Host 再截断，超大会话有一定内存开销
- 备份导出的运行中会话可能缺最后几条事件；导入文件上限 64 MB（页面），备份不含回收站和归档/置顶状态，导入后按 cwd 重新归组；原工作目录在目标机器不存在时，会自动改写到该 DSH 的默认目录
- 删除只作用于本地存储；额外的备份/同步不在范围内

## 开发

```bash
node --test test/core.test.mjs test/transcript.test.mjs test/trash.test.mjs test/backup.test.mjs
```

覆盖：文件级删除校验、对话折叠/截断、回收站移动/恢复/冲突/过期/设置有 29 个用例。

# 会话清理 (session-cleanup)

给 DeepSeek Harness 的侧栏加一个「会话清理」面板：按工作区列出所有会话，可以**归档/恢复**，也可以**永久删除**磁盘上的会话日志。

![icon](icon.svg)

## 能做什么

- 按工作区分组；子代理自动挂到父会话下面（缩进、默认折叠，点父行展开/收起）
- 勾选父会话会连同整棵子代理子树一起勾选；点父行的删除按钮、且父/子都没勾选时，默认删除父 + 全部子代理
- 删除子代理不会连带删除父代理
- **归档 / 恢复**：走 Harness 原生的 workspace 归档，文件保留、可恢复
- **永久删除**：直接删掉 JSONL 后端为会话建的整个目录（日志 + 锁文件），没有回收站
  - 删除前会预检：可删几个、总大小、每个会话的名称、哪些删不了及原因
  - 正在运行的会话会被拒绝（日志还在写）；空闲但已加载在内存里的会话可以删，删除时会自动归档以隐藏内存里的残留行，重启 `dsh web` 后彻底消失
  - 目录名、目录内容、日志头三层校验都过了才会 `rm`，不符合预期一律中止
- 附带 agent 工具 `session_cleanup`（`preview` / `delete`，与 UI 同一套实现）

## 安装

1. 解包到任意目录，例如 `~/plugins/session-cleanup`
2. 在目标 profile 里安装这个 bundle（二选一）：
   - 用 Harness 的 Plugin Manager / `plugin_manager` 工具的 `install_bundle`，目标指向解包后的目录
   - 或者把目录加入 profile 的 `package.json` 依赖与 `dsh.profile.bundles` 列表
3. 重启或让 `dsh web` 重新组合后，左侧栏会出现「会话清理」图标

Host 端新增了删除接口，**更新已安装的副本后需要重启 `dsh web`**（客户端面板刷新页面即可）。


## 发布到 Git / 插件广场（Discover）

Harness 没有官方插件索引，插件广场只搜索**用户自己添加的索引源**。要让别人（或你自己）在 Discover 里搜到，需要两步：把包放到 Git 上，再提供一个符合 format 1 的索引 JSON，让对方添加这个索引 URL。

1. 推到 GitHub / Gitee（包目录就是仓库根目录）：

```bash
git init && git add . && git commit -m "session-cleanup 1.0.0"
git branch -M main
git remote add origin git@github.com:ming-a1/session-cleanup.git
git push -u origin main
```

2. 生成索引（把 `<commit>` 换成 `git rev-parse HEAD` 的输出）：

```bash
node scripts/make-market-index.mjs \
  --repo https://github.com/ming-a1/session-cleanup \
  --commit <commit> \
  --author "ming-a1" \
  --out plugin-market.json
git add plugin-market.json && git commit -m "add market index" && git push
```

3. 索引要用**不重定向**的 https 地址（market 拒绝 3xx）：
   `https://raw.githubusercontent.com/ming-a1/session-cleanup/main/plugin-market.json`

4. 在 Harness 里：Plugins 页 → Experimental plugins 里开启 **Custom plugin markets** → 打开 **Discover** → 添加上面的索引 URL → 搜「会话清理」。

注意：
- 索引里 `name` 必须等于包的 npm 名。改包名时要同步改 `package.json`、`cordis.patch.yml` 的行 `name`、`client.js` 的 `__ModuleLoader__.load({ id })`，再重新生成索引。
- 索引里的版本是**按 commit 锁定**的 Git 源（`git+<repo>.git#<sha>`）；每次发版都要重新生成索引并更新 commit。
- 想用 npm 源发布，先去掉 `private: true`、把 `@local/...` 换成你自己的 npm scope，并把索引里该版本的 `source` 改成 `{ "type": "npm" }`。
- 想让「所有人」都能搜到，需要一个公共索引（社区维护或自建），然后把你的条目 PR 进去；本地添加索引只对自己生效。

## 说明与限制

- Harness 没有公开的「删除会话」API，本插件按 JSONL 后端的磁盘布局定位目录；后端换存储或改路径编码时删除会以「目录不匹配」安全失败，不会误删
- 运行中的会话不能删，等这一轮结束
- 删除只作用于本地存储；若你还配置了别的备份/同步，不在范围内

## 开发

```bash
node --test test/core.test.mjs   # 文件级删除核心的单元测试
```

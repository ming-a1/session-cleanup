/**
 * Client half of the session-cleanup bundle.
 *
 * Registers one `main` page and its `sidebar.panellist` icon. The page lists
 * every Session grouped by Workspace and offers two distinct operations:
 *
 * - archive/restore through the composed `uiWorkspace` service (reversible,
 *   keeps the stored log), and
 * - permanent deletion through this bundle's authenticated Host route, which
 *   removes the stored session directory from disk.
 *
 * All Host access stays behind one implementation: the route is the browser
 * caller, and the bundle's `session_cleanup` tool calls the same code.
 */
window.__ModuleLoader__.load({
  id: '@local/session-cleanup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'sessionCleanup';
    const PANEL_ID = 'session-cleanup';
    const DELETE_ROUTE = '/session-cleanup/delete';

    const CSS = [
      '.wsc-page{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}',
      '.wsc-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}',
      '.wsc-content{box-sizing:border-box;max-width:880px;margin:0 auto;padding:28px clamp(24px,4vw,48px) 40px}',
      '.wsc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}',
      '.wsc-head h1{margin:0;font-size:20px;font-weight:500;line-height:28px}',
      '.wsc-sub{margin:6px 0 0;max-width:54ch;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.wsc-stats{flex:none;text-align:right;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-stats b{font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.wsc-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}',
      '.wsc-search{display:flex;align-items:center;flex:1 1 220px;min-width:170px;height:36px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;gap:8px;color:var(--dsw-alias-label-secondary)}',
      '.wsc-search:focus-within{border-color:var(--dsw-alias-brand-primary)}',
      '.wsc-search svg{flex:none}',
      '.wsc-search input{flex:1;min-width:0;height:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}',
      '.wsc-search input::placeholder{color:var(--dsw-alias-label-secondary)}',
      '.wsc-select{height:36px;max-width:220px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:13px}',
      '.wsc-toggle{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 10px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer}',
      '.wsc-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.wsc-toggle input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.wsc-spacer{flex:1 1 auto}',
      '.wsc-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:transparent;color:inherit;font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}',
      '.wsc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.wsc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.wsc-btn-small{height:26px;padding:0 10px;border-radius:13px;font-size:12px}',
      '.wsc-btn-refresh{min-width:86px;justify-content:center}',
      '.wsc-link{padding:2px 6px;border:0;border-radius:8px;background:none;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}',
      '.wsc-link:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-group{margin:0 0 16px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}',
      '.wsc-group-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.wsc-caret{display:flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.wsc-caret:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-caret svg{transition:transform .12s ease}',
      '.wsc-caret-open svg{transform:rotate(90deg)}',
      '.wsc-group-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}',
      '.wsc-group-path{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-group-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);transition:background-color .12s ease,box-shadow .12s ease}',
      '.wsc-row:last-child{border-bottom:0}',
      '.wsc-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-row-selected{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      '.wsc-row-selected:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 17%,transparent)}',
      '.wsc-row-selected .wsc-row-title-text{color:var(--dsw-alias-brand-primary)}',
      '.wsc-row-archived .wsc-row-title-text{color:var(--dsw-alias-label-secondary)}',
      '.wsc-check{flex:none;width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.wsc-row-running .wsc-check{cursor:not-allowed;opacity:.4}',
      '.wsc-row-running .wsc-row-title{color:var(--dsw-alias-label-secondary)}',
      '.wsc-row-body{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.wsc-row-title{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px}',
      '.wsc-row-caret{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary);transform:rotate(0deg);transition:transform .12s ease}',
      '.wsc-row-caret-open{transform:rotate(90deg)}',
      '.wsc-row-title-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wsc-row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-row-id{flex:1 0 100%;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45}',
      '.wsc-row-meta-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wsc-badge{display:inline-flex;align-items:center;gap:4px;flex:none;height:17px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1}',
      '.wsc-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}',
      '.wsc-row-actions{display:flex;align-items:center;gap:6px;flex:none}',
      '.wsc-empty{margin:0;padding:32px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.wsc-footer{flex:none;display:flex;align-items:center;padding:10px clamp(24px,4vw,48px);border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      '.wsc-footer-inner{display:flex;flex-wrap:wrap;align-items:center;gap:8px;box-sizing:border-box;width:100%;max-width:880px;margin:0 auto}',
      '.wsc-footer-info{margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-notice{position:fixed;left:50%;bottom:24px;z-index:70;transform:translateX(-50%);padding:8px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.wsc-overlay{position:fixed;inset:0;z-index:80;pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 42%,transparent)}',
      '.wsc-mi-wrap{position:relative}',
      '.wsc-mi-sep{height:.5px;margin:3px 2px;background:var(--dsw-alias-border-l2)}',
      '.wsc-mi{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:8px;background:transparent;cursor:pointer;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:left}',
      '.wsc-mi:hover,.wsc-mi:focus-visible{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-bg-layer-2));outline:none}',
      '.wsc-mi-icon{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:none;color:var(--dsw-alias-state-error-primary)}',
      '.wsc-mi-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary)}',
      '.wsc-dialog{width:min(460px,100%);max-height:calc(100dvh - 48px);overflow:auto;padding:20px;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:0 16px 48px color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent)}',
      '.wsc-dialog h2{margin:0 0 10px;font-size:15px;font-weight:500;line-height:22px}',
      '.wsc-dialog p{margin:0 0 10px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
      '.wsc-dialog-warn{margin:0 0 10px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary)}',
      '.wsc-summary{margin:0 0 10px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px}',
      '.wsc-failures{max-height:180px;margin:0 0 10px;padding:0;overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;list-style:none}',
      '.wsc-failures li{padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}',
      '.wsc-failures li:last-child{border-bottom:0}',
      '.wsc-titles{max-height:190px;margin:0 0 10px;padding:0;overflow:auto;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;list-style:none}',
      '.wsc-titles li{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.wsc-titles li:last-child{border-bottom:0}',
      '.wsc-title-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12.5px}',
      '.wsc-title-size{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.wsc-failure-id{color:var(--dsw-alias-label-primary);font-size:12px;font-family:var(--dsw-font-mono,monospace)}',
      '.wsc-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}',
      '.wsc-progress{margin-right:auto;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-transcript{display:flex;flex-direction:column;width:min(760px,100%);max-height:calc(100dvh - 48px);overflow:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:0 16px 48px color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent)}',
      '.wsc-transcript-head{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.wsc-back{flex:none;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}',
      '.wsc-back:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-transcript-titles{flex:1;min-width:0}',
      '.wsc-transcript-titles h2{margin:0;font-size:15px;font-weight:600;line-height:22px}',
      '.wsc-transcript-sub{margin:1px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-transcript-close{flex:none;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;cursor:pointer}',
      '.wsc-transcript-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.wsc-transcript-body{overflow:auto;padding:14px 16px 18px}',
      '.wsc-kv{display:flex;flex-direction:column;gap:5px;margin:0 0 16px}',
      '.wsc-kv-row{display:flex;gap:12px;font-size:12.5px;line-height:1.5}',
      '.wsc-kv-key{flex:none;width:84px;color:var(--dsw-alias-label-secondary)}',
      '.wsc-kv-val{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}',
      '.wsc-section-title{margin:0 0 8px;font-size:13px;font-weight:600}',
      '.wsc-turn{margin:0 0 8px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}',
      '.wsc-turn-head{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.wsc-turn-head:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-turn-badge{display:inline-flex;align-items:center;flex:none;height:18px;padding:0 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font-size:11px}',
      '.wsc-turn-time{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.wsc-turn-tools{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.wsc-turn-caret{display:inline-flex;flex:none;margin-left:auto;color:var(--dsw-alias-label-secondary);transition:transform .12s ease}',
      '.wsc-turn-caret-open{transform:rotate(90deg)}',
      '.wsc-turn-question{margin:0 10px 9px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);color:var(--dsw-alias-brand-primary);font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.wsc-turn-role-user{margin-right:6px;font-size:11px;font-weight:600;opacity:.85}',
      '.wsc-turn-answer{border-top:.5px solid var(--dsw-alias-border-l1);padding:9px 10px 10px;background:var(--dsw-alias-bg-layer-2)}',
      '.wsc-turn-role-assistant{display:block;margin-bottom:4px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600}',
      '.wsc-turn-text{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.55}',
      '.wsc-turn-muted{color:var(--dsw-alias-label-secondary)}',
      '.wsc-turn-toollist{margin-top:6px;color:var(--dsw-alias-label-secondary);font-size:11px;overflow-wrap:anywhere}',
      '.wsc-transcript-note{margin:0 0 10px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.wsc-backup-section{margin:0 0 20px}',
      '.wsc-backup-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px}',
      '.wsc-backup-file{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wsc-trash-settings{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;color:var(--dsw-alias-label-secondary);font-size:12.5px}',
      '.wsc-trash-settings input{width:64px;height:28px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.wsc-trash-row{display:flex;align-items:center;gap:10px;margin:0 0 8px;padding:10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px}',
      '.wsc-trash-main{flex:1;min-width:0}',
      '.wsc-trash-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.wsc-trash-meta{margin-top:2px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11.5px}',
      '.wsc-trash-actions{display:flex;flex:none;gap:6px}',
      '.wsc-confirm{margin:0 0 12px;padding:10px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}',
      '.wsc-confirm-title{font-size:13px;font-weight:600;color:var(--dsw-alias-state-error-primary)}',
      '.wsc-confirm p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}',
      '.wsc-page :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '@media (max-width:640px){.wsc-group-path{display:none}.wsc-content{padding:20px 16px 32px}.wsc-footer{padding:8px 16px}.wsc-footer-info{flex:1 0 100%;margin:0 0 2px}.wsc-footer-inner{gap:6px}.wsc-footer-inner .wsc-btn{flex:none}}',
    ].join('');

    const zh = {
      panel: '会话清理',
      title: '会话清理',
      subtitle: '按工作区分组管理会话。归档可恢复；永久删除会从磁盘移除会话日志，无法恢复。',
      searchPlaceholder: '搜索标题、目录或会话 ID',
      allWorkspaces: '全部工作区',
      ungrouped: '未归入工作区',
      showArchived: '显示已归档',
      selectAll: '全选当前结果',
      clearAll: '取消全选',
      archiveSelected: '归档所选（{n}）',
      purgeSelected: '删除（{n}）',
      restoreSelected: '恢复所选（{n}）',
      selectedSummary: '已选择 {n} 个会话',
      noSelection: '勾选会话后可以归档、恢复或永久删除。',
      totalSessions: '个会话',
      archivedSessions: '个已归档',
      empty: '这里还没有会话。',
      noMatches: '没有匹配的会话。',
      loading: '正在加载会话…',
      unnamed: '未命名会话',
      running: '运行中',
      archived: '已归档',
      pinned: '置顶',
      subagent: '子代理',
      openBadge: '打开中',
      archive: '归档',
      restore: '恢复',
      deletePermanently: '删除',
      menuDelete: '删除会话',
      viewRecord: '查看',
      transcriptTitle: '对话记录',
      transcriptLoading: '正在读取对话…',
      transcriptError: '读取失败：{message}',
      transcriptMissing: '会话不存在或已被删除。',
      transcriptEmpty: '没有可显示的对话内容。',
      transcriptTruncated: '仅显示最近的 {n} 轮对话。',
      transcriptBack: '返回',
      transcriptCwd: '工作目录',
      transcriptTurns: '对话轮次',
      transcriptUserMessages: '用户消息',
      transcriptToolCalls: '工具调用',
      transcriptSize: '大小',
      transcriptCreated: '创建于',
      transcriptQuestions: '提问记录（共 {n} 条）',
      transcriptTurn: '第 {n} 轮',
      transcriptTools: '工具 {n} 次',
      transcriptNoReply: '（无回复）',
      transcriptUnknown: '未知',
      trashOpen: '回收站',
      backup: '备份',
      backupTitle: '备份 / 恢复',
      backupExportAll: '导出全部会话',
      backupExportHint: '导出一个 .tar.gz，包含会话日志与元数据；运行中的会话可能缺少最后几条。',
      backupExporting: '正在导出…',
      backupExported: '已导出 {n} 个会话。',
      backupImportHint: '选择由本插件导出的 .tar.gz 导入；已存在的会话不会覆盖。',
      backupChooseFile: '选择备份文件',
      backupImport: '导入',
      backupImporting: '正在导入…',
      backupImported: '已导入 {n} 个会话。',
      backupResult: '成功 {ok} · 冲突 {conflict} · 无效 {invalid} · 失败 {failed}',
      backupNoFile: '还没有选择文件。',
      backupFileTooLarge: '备份文件过大（上限 64 MB）。',
      backupStatusImported: '已导入',
      backupStatusConflict: '已存在',
      backupStatusInvalid: '无效',
      backupStatusFailed: '失败',
      backupDownloadFailed: '导出失败：{message}',
      backupImportFailed: '导入失败：{message}',
      backupRow: '备份',
      runningLocked: '运行中，不能选择',
      deleteRunningBlocked: '会话正在运行中，不可删除；等这一轮结束再试。',
      backupSelected: '备份已选中（{n}）',
      backupCwdNote: '{n} 个会话的原工作目录不存在，已改写到 {path}。',
      refresh: '刷新',
      refreshing: '刷新中…',
      refreshFailed: '刷新失败：{message}',
      trashTitle: '回收站',
      trashLoading: '正在读取回收站…',
      trashError: '读取失败：{message}',
      trashEmpty: '回收站是空的。',
      trashRetention: '保留天数',
      trashSave: '保存',
      trashSaved: '已保存',
      trashDeletedAt: '删除于',
      trashExpiresIn: '剩余 {n} 天',
      trashRestore: '恢复',
      trashPurge: '永久删除',
      trashConfirmTitle: '永久删除这条记录？',
      trashConfirmBody: '「{title}」将从磁盘彻底删除，无法恢复。',
      trashConfirm: '确认永久删除',
      trashCancel: '取消',
      trashRestored: '已恢复 {n} 个会话。',
      trashPurged: '已永久删除 {n} 条记录。',
      trashFailed: '操作失败：{message}',
      trashSize: '大小',
      trashEmptyAll: '清空回收站（{n}）',
      trashEmptyConfirmTitle: '清空回收站？',
      trashEmptyConfirmBody: '回收站里的 {n} 条记录将被永久删除，无法恢复。',
      trashEmptyConfirm: '确认清空',
      trashEmptied: '已清空回收站（{n} 条）。',
      trashPartial: '已删除 {ok} 条，{failed} 条失败。',
      transcriptUser: '我',
      transcriptAssistant: '助手',
      archiveConfirmTitle: '归档会话',
      archiveConfirmBody: '将把 {n} 个会话从工作区移除（归档）。会话文件保留，可在「显示已归档」中恢复。',
      archiveRunning: '其中 {n} 个会话正在运行。确认后会先停止这些会话的运行，再归档。',
      archiveNotice: '已归档 {n} 个会话。',
      failureSummary: '{ok} 个成功，{failed} 个失败。',
      partialRestore: '恢复完成：{ok} 个成功，{failed} 个失败。',
      restored: '已恢复 {n} 个会话。',
      activeRefused: '会话仍在运行，未能归档。',
      unknownError: '未知错误。',
      cancel: '取消',
      close: '关闭',
      working: '处理中…',
      purgeTitle: '删除会话',
      purgeBody: '将把 {n} 个会话移到回收站。保留期默认 7 天、以回收站里的设置为准，期间可恢复；到期后自动永久删除。',
      purgeChecking: '正在检查 {n} 个会话…',
      purgeCheckFailed: '检查失败：{message}',
      purgeHostUnavailable: 'Host 端删除接口尚未加载，请重启 dsh web 后重试。',
      purgeRetry: '重试',
      purgeRunFailed: '删除请求失败：{message}',
      purgeSummary: '将移入回收站 {n} 个，共 {size}。',
      purgeNothingDeletable: '所选会话都无法删除。',
      purgeIrreversible: '删除只是移入回收站，可随时恢复；要彻底删除请到回收站里操作。',
      purgeBlockedTitle: '{n} 个无法删除：',
      purgeNamesAria: '将要永久删除的会话',
      purgeReasonRunning: '会话正在运行（或还有后台任务在跑），等这一轮结束后再删除。',
      purgeLiveNote: '其中 {n} 个会话仍加载在内存中。文件会移到回收站并自动归档隐藏，重启 dsh web 后才会从列表里彻底消失。',
      purgeReasonMissing: '磁盘上找不到该会话的日志目录，可能已被删除。',
      purgeReasonUnsafe: '目录内容不符合会话日志结构，出于安全已中止。',
      purgeReasonUnsafeDetail: '目录内容不符合会话日志结构，已中止：{detail}',
      purgeReasonFailed: '删除失败。',
      purgeReasonFailedDetail: '删除失败：{detail}',
      purgeReasonUnknown: '无法删除。',
      purgeConfirm: '移到回收站',
      purgeRunning: '正在永久删除 {n} 个会话…',
      processing: '正在处理 {done}/{total}…',
      purgeDone: '已移入回收站 {n} 个会话。',
      purgeDoneNotice: '已移入回收站 {n} 个会话。',
      groupCount: '{n} 个',
      childCount: '{n} 个子代理',
      selectGroup: '全选本组',
      clearGroup: '取消本组',
      collapse: '收起',
      expand: '展开',
    };

    const en = {
      panel: 'Session cleanup',
      title: 'Session cleanup',
      subtitle: 'Manage sessions by workspace. Archive is reversible; permanent delete removes the stored session log from disk and cannot be undone.',
      searchPlaceholder: 'Search title, directory, or session ID',
      allWorkspaces: 'All workspaces',
      ungrouped: 'Not in a workspace',
      showArchived: 'Show archived',
      selectAll: 'Select all results',
      clearAll: 'Clear selection',
      archiveSelected: 'Archive selected ({n})',
      purgeSelected: 'Delete ({n})',
      restoreSelected: 'Restore selected ({n})',
      selectedSummary: '{n} selected',
      noSelection: 'Select sessions to archive, restore, or delete permanently.',
      totalSessions: 'sessions',
      archivedSessions: 'archived',
      empty: 'There are no sessions yet.',
      noMatches: 'No sessions match the current filters.',
      loading: 'Loading sessions…',
      unnamed: 'Untitled session',
      running: 'Running',
      archived: 'Archived',
      pinned: 'Pinned',
      subagent: 'Subagent',
      openBadge: 'Open',
      archive: 'Archive',
      restore: 'Restore',
      deletePermanently: 'Delete',
      menuDelete: 'Delete session',
      viewRecord: 'View',
      transcriptTitle: 'Conversation',
      transcriptLoading: 'Loading conversation…',
      transcriptError: 'Failed to load: {message}',
      transcriptMissing: 'The session no longer exists.',
      transcriptEmpty: 'No messages to show.',
      transcriptTruncated: 'Showing only the last {n} turns.',
      transcriptBack: 'Back',
      transcriptCwd: 'Directory',
      transcriptTurns: 'Turns',
      transcriptUserMessages: 'User messages',
      transcriptToolCalls: 'Tool calls',
      transcriptSize: 'Size',
      transcriptCreated: 'Created',
      transcriptQuestions: 'Questions ({n})',
      transcriptTurn: 'Turn {n}',
      transcriptTools: '{n} tool calls',
      transcriptNoReply: '(no reply)',
      transcriptUnknown: 'Unknown',
      trashOpen: 'Recycle bin',
      backup: 'Backup',
      backupTitle: 'Backup / restore',
      backupExportAll: 'Export all sessions',
      backupExportHint: 'Downloads one .tar.gz with session logs and metadata; a running session may miss its last few events.',
      backupExporting: 'Exporting…',
      backupExported: 'Exported {n} sessions.',
      backupImportHint: 'Pick a .tar.gz exported by this plugin; existing sessions are never overwritten.',
      backupChooseFile: 'Choose backup file',
      backupImport: 'Import',
      backupImporting: 'Importing…',
      backupImported: 'Imported {n} sessions.',
      backupResult: '{ok} imported · {conflict} existing · {invalid} invalid · {failed} failed',
      backupNoFile: 'No file chosen yet.',
      backupFileTooLarge: 'The backup file is too large (64 MB limit).',
      backupStatusImported: 'Imported',
      backupStatusConflict: 'Exists',
      backupStatusInvalid: 'Invalid',
      backupStatusFailed: 'Failed',
      backupDownloadFailed: 'Export failed: {message}',
      backupImportFailed: 'Import failed: {message}',
      backupRow: 'Backup',
      runningLocked: 'Running; cannot be selected',
      deleteRunningBlocked: 'This session is running and cannot be deleted; wait for the turn to finish.',
      backupSelected: 'Back up selected ({n})',
      backupCwdNote: '{n} sessions pointed at a directory that does not exist here; rewritten to {path}.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      refreshFailed: 'Refresh failed: {message}',
      trashTitle: 'Recycle bin',
      trashLoading: 'Loading the recycle bin…',
      trashError: 'Failed to load: {message}',
      trashEmpty: 'The recycle bin is empty.',
      trashRetention: 'Keep for (days)',
      trashSave: 'Save',
      trashSaved: 'Saved',
      trashDeletedAt: 'Deleted',
      trashExpiresIn: '{n} days left',
      trashRestore: 'Restore',
      trashPurge: 'Delete permanently',
      trashConfirmTitle: 'Delete this entry permanently?',
      trashConfirmBody: '“{title}” will be removed from disk for good.',
      trashConfirm: 'Delete permanently',
      trashCancel: 'Cancel',
      trashRestored: 'Restored {n} sessions.',
      trashPurged: 'Permanently deleted {n} entries.',
      trashFailed: 'Failed: {message}',
      trashSize: 'Size',
      trashEmptyAll: 'Empty the bin ({n})',
      trashEmptyConfirmTitle: 'Empty the recycle bin?',
      trashEmptyConfirmBody: 'All {n} entries will be deleted permanently.',
      trashEmptyConfirm: 'Empty it',
      trashEmptied: 'Emptied the recycle bin ({n} entries).',
      trashPartial: 'Deleted {ok} entries; {failed} failed.',
      transcriptUser: 'You',
      transcriptAssistant: 'Assistant',
      archiveConfirmTitle: 'Archive sessions',
      archiveConfirmBody: 'This removes {n} sessions from their workspaces (archives them). The stored logs are kept and can be restored with “Show archived”.',
      archiveRunning: '{n} of them are running. Confirming stops their running work first, then archives them.',
      archiveNotice: 'Archived {n} sessions.',
      failureSummary: '{ok} succeeded, {failed} failed.',
      partialRestore: 'Restore finished: {ok} succeeded, {failed} failed.',
      restored: 'Restored {n} sessions.',
      activeRefused: 'The session is still running, so it was not archived.',
      unknownError: 'Unknown error.',
      cancel: 'Cancel',
      close: 'Close',
      working: 'Working…',
      purgeTitle: 'Delete sessions',
      purgeBody: 'This moves {n} sessions to the recycle bin. They are kept for 7 days by default (adjustable in the bin) and can be restored until then; expired entries are deleted permanently.',
      purgeChecking: 'Checking {n} sessions…',
      purgeCheckFailed: 'Check failed: {message}',
      purgeHostUnavailable: 'The Host deletion endpoint is not loaded yet. Restart dsh web and try again.',
      purgeRetry: 'Retry',
      purgeRunFailed: 'The delete request failed: {message}',
      purgeSummary: '{n} will move to the recycle bin, {size} in total.',
      purgeNothingDeletable: 'None of the selected sessions can be deleted.',
      purgeIrreversible: 'Deleting only moves sessions to the recycle bin; permanent deletion happens there.',
      purgeBlockedTitle: '{n} cannot be deleted:',
      purgeNamesAria: 'Sessions to delete permanently',
      purgeReasonRunning: 'The session is running (or still owns background work); wait for the turn to finish, then delete it.',
      purgeLiveNote: '{n} of them are still loaded in memory. Their files move to the recycle bin and the rows are archived to hide them, but they disappear from the list only after dsh web restarts.',
      purgeReasonMissing: 'No stored log directory was found; it may already be deleted.',
      purgeReasonUnsafe: 'The directory does not look like a session log, so deletion was aborted.',
      purgeReasonUnsafeDetail: 'The directory does not look like a session log, so deletion was aborted: {detail}',
      purgeReasonFailed: 'Deletion failed.',
      purgeReasonFailedDetail: 'Deletion failed: {detail}',
      purgeReasonUnknown: 'Cannot delete.',
      purgeConfirm: 'Move to recycle bin',
      purgeRunning: 'Deleting {n} sessions permanently…',
      processing: 'Working {done}/{total}…',
      purgeDone: 'Moved {n} sessions to the recycle bin.',
      purgeDoneNotice: 'Moved {n} sessions to the recycle bin.',
      groupCount: '{n}',
      childCount: '{n} subagents',
      selectGroup: 'Select group',
      clearGroup: 'Clear group',
      collapse: 'Collapse',
      expand: 'Expand',
    };

    function basename(path) {
      if (!path) return '';
      const parts = String(path).split(/[\\/]+/).filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : String(path);
    }

    /** Local `YYYY-MM-DD HH:mm:ss` spelling. */
    function formatDateTime(ms) {
      if (!Number.isFinite(ms)) return '';
      const date = new Date(ms);
      const pad = (value) => String(value).padStart(2, '0');
      return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes()) +
        ':' +
        pad(date.getSeconds())
      );
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      const digits = value >= 10 || unit === 0 ? 0 : 1;
      return value.toFixed(digits) + ' ' + units[unit];
    }

    function failureMessage(error, t) {
      if (error && error.rpcError) {
        if (error.rpcError.code === 'workspace/session-active') return t('activeRefused');
        if (error.rpcError.message) return String(error.rpcError.message);
      }
      if (error && error.message) return String(error.message);
      return t('unknownError');
    }

    function blockedText(item, t) {
      const detail = typeof item.reason === 'string' && item.reason.length > 0 ? item.reason : undefined;
      switch (item.status) {
        case 'running':
          return t('purgeReasonRunning');
        case 'missing':
          return t('purgeReasonMissing');
        case 'unsafe':
          return detail !== undefined ? t('purgeReasonUnsafeDetail', { detail }) : t('purgeReasonUnsafe');
        case 'failed':
          return detail !== undefined ? t('purgeReasonFailedDetail', { detail }) : t('purgeReasonFailed');
        default:
          return detail ?? t('purgeReasonUnknown');
      }
    }

    /**
     * Call this bundle's authenticated Host route.
     * @param action - 'preview' or 'delete'.
     * @param sessionIds - ids to inspect or delete.
     * @returns the batch report.
     */
    async function callCleanup(action, sessionIds) {
      let response;
      try {
        response = await fetch(DELETE_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, sessionIds }),
        });
      } catch (error) {
        const failure = new Error(error instanceof Error ? error.message : String(error));
        failure.status = 0;
        throw failure;
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const failure = new Error(body !== null && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status);
        failure.status = response.status;
        throw failure;
      }
      if (body === null || !Array.isArray(body.items)) throw new Error('unexpected cleanup response');
      return body;
    }

    // The sidebar menu and the cleanup page are different slots; one small
    // request bus lets the menu open the same confirmation dialog, which is
    // hosted in `shell.overlay` so it works while the panel is not mounted.
    const purgeBus = (() => {
      let current = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) listener(current);
      };
      return {
        open(request) {
          current = request;
          emit();
        },
        close() {
          current = null;
          emit();
        },
        get() {
          return current;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    })();

    /** Collect a session and its descendants with display labels. */
    function collectSubtree(state, rootId, rootLabel) {
      const byId = state !== null && state !== undefined && state.byId !== undefined ? state.byId : {};
      const ids = [rootId];
      const labels = Object.create(null);
      const labelOf = (id) => {
        const row = byId[id];
        return row !== undefined ? row.displayTitle || row.title || '' : '';
      };
      labels[rootId] = rootLabel || labelOf(rootId);
      const walk = (id) => {
        for (const key of Object.keys(byId)) {
          if (ids.includes(key)) continue;
          if (byId[key].parentId !== id) continue;
          ids.push(key);
          labels[key] = labelOf(key);
          walk(key);
        }
      };
      walk(rootId);
      return { ids, labels };
    }

    function TrashIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 4.5h10' }),
        h('path', { d: 'M6 4.5V3.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.3' }),
        h('path', { d: 'M4.2 4.5l.6 8.1c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.1' }),
        h('path', { d: 'M6.7 7v4M9.3 7v4' }),
      );
    }

    /** Row in a Session's "..." menu: permanently delete this session. */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useSessions, useMenuOpenState, t }) {
      const [, setMenuOpen] = useMenuOpenState();
      const sessionState = useSessions((state) => state);
      const onSelect = () => {
        setMenuOpen(false);
        const running = sessionState.byId[sessionId]?.running === true;
        purgeBus.open(running ? { ids: [], labels: {} } : collectSubtree(sessionState, sessionId, displayTitle));
      };
      return h(
        'div',
        { className: 'wsc-mi-wrap' },
        h('div', { className: 'wsc-mi-sep', role: 'separator' }),
        h(
          'button',
          { type: 'button', role: 'menuitem', className: 'wsc-mi', onClick: onSelect },
          h('span', { className: 'wsc-mi-icon' }, h(TrashIcon)),
          h('span', { className: 'wsc-mi-label' }, t('menuDelete')),
        ),
      );
    }

    /** Root overlay: hosts the permanent-delete dialog for menu callers. */
    function PurgeOverlayHost({ refreshSessions, t }) {
      const [request, setRequest] = useState(() => purgeBus.get());
      useEffect(() => purgeBus.subscribe(setRequest), []);
      const finished = useCallback(() => {
        if (typeof refreshSessions === 'function') refreshSessions().catch(() => {});
        purgeBus.close();
      }, [refreshSessions]);
      return h(
        React.Fragment,
        null,
        h('style', null, CSS),
        request === null
          ? null
          : h(PurgeDialog, {
              ids: request.ids,
              labels: request.labels,
              t,
              onClose: () => purgeBus.close(),
              onFinished: finished,
            }),
      );
    }

    /** Read one session's transcript through the bundle's Host route. */
    async function callTranscript(sessionId) {
      const response = await fetch(DELETE_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'transcript', sessionId }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) throw new Error(body !== null && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status);
      if (body === null || body.item === undefined) throw new Error('unexpected transcript response');
      return body.item;
    }

    /** Download one backup archive through the Host route. */
    async function downloadBackup(sessionIds) {
      const payload = sessionIds === undefined ? { action: 'backup-export' } : { action: 'backup-export', sessionIds };
      const response = await fetch(DELETE_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let message = 'HTTP ' + response.status;
        try {
          const body = await response.json();
          if (body !== null && typeof body.error === 'string') message = body.error;
        } catch {
          // HTML error page.
        }
        throw new Error(message);
      }
      const disposition = response.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match !== null ? match[1] : 'dsh-sessions-backup.tar.gz';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { filename, count: Number(response.headers.get('x-session-count') || '0') };
    }

    /** Upload one backup archive to the Host import route. */
    async function uploadBackup(file) {
      if (file.size > 64 * 1024 * 1024) throw new Error('backup file exceeds the 64 MB limit');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      const response = await fetch('/session-cleanup/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: btoa(binary) }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) throw new Error(body !== null && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status);
      if (body === null || !Array.isArray(body.items)) throw new Error('unexpected import response');
      return body;
    }

    /** Call one recycle-bin action through the bundle's Host route. */
    async function callTrash(action, payload = {}) {
      const response = await fetch(DELETE_ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) throw new Error(body !== null && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status);
      if (body === null) throw new Error('unexpected trash response');
      return body;
    }

    /** Sidebar glyph: a session list with a delete cross. */
    function CleanupIcon({ size = 18, active = false }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 1.9 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', { d: 'M4 6h11M4 11h8M4 16h6' }),
        h('path', { d: 'M15 14.5l4.5 4.5M19.5 14.5L15 19' }),
      );
    }

    function SearchIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
        },
        h('circle', { cx: 7, cy: 7, r: 4.5 }),
        h('path', { d: 'M10.5 10.5L14 14' }),
      );
    }

    function CaretIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M6 3.5L10.5 8L6 12.5' }),
      );
    }

    function Badge({ children, dot }) {
      return h('span', { className: 'wsc-badge' }, dot ? h('span', { className: 'wsc-dot' }) : null, children);
    }

    function SessionRow({ row, depth, childCount, expanded, archived, pinned, selected, running, open, t, onToggleSelection, onToggleExpand, onArchive, onRestore, onDelete, onView, onBackup }) {
      const display = row.displayTitle || row.title || '';
      const title = display !== '' && display !== String(row.id) ? display : t('unnamed');
      const badges = [];
      if (row.running) badges.push(h(Badge, { key: 'running', dot: true }, t('running')));
      if (open) badges.push(h(Badge, { key: 'open' }, t('openBadge')));
      if (pinned) badges.push(h(Badge, { key: 'pinned' }, t('pinned')));
      if (row.origin === 'subagent') badges.push(h(Badge, { key: 'subagent' }, t('subagent')));
      if (archived) badges.push(h(Badge, { key: 'archived' }, t('archived')));
      const meta = [formatDateTime(row.updatedAt)];
      if (row.cwd) meta.push(basename(row.cwd));
      return h(
        'div',
        {
          className: 'wsc-row' + (selected ? ' wsc-row-selected' : '') + (archived ? ' wsc-row-archived' : '') + (running ? ' wsc-row-running' : ''),
          style: depth > 0 ? { paddingLeft: 12 + depth * 18 } : undefined,
        },
        h('input', {
          type: 'checkbox',
          className: 'wsc-check',
          checked: selected,
          disabled: running,
          title: running ? t('runningLocked') : undefined,
          onChange: () => onToggleSelection(row.id),
          'aria-label': title,
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'wsc-row-body',
            'aria-expanded': childCount > 0 ? expanded : undefined,
            onClick: () => {
              if (childCount > 0) onToggleExpand(row.id);
              else if (!running) onToggleSelection(row.id);
            },
          },
          h(
            'span',
            { className: 'wsc-row-title' },
            childCount > 0
              ? h('span', { className: 'wsc-row-caret' + (expanded ? ' wsc-row-caret-open' : ''), 'aria-hidden': true }, h(CaretIcon))
              : null,
            h('span', { className: 'wsc-row-title-text', title }, title),
            badges,
            childCount > 0 ? h(Badge, { key: 'children' }, t('childCount', { n: childCount })) : null,
          ),
          h(
            'span',
            { className: 'wsc-row-meta' },
            meta.filter(Boolean).length > 0 ? h('span', { className: 'wsc-row-meta-text' }, meta.filter(Boolean).join(' · ')) : null,
            h('span', { className: 'wsc-row-id', title: String(row.id) }, String(row.id)),
          ),
        ),
        h(
          'div',
          { className: 'wsc-row-actions' },
          h('button', { type: 'button', className: 'wsc-btn wsc-btn-small', onClick: () => onBackup(row.id) }, t('backupRow')),
          h('button', { type: 'button', className: 'wsc-btn wsc-btn-small', onClick: () => onView(row.id) }, t('viewRecord')),
          archived
            ? h('button', { type: 'button', className: 'wsc-btn wsc-btn-small', onClick: () => onRestore(row.id) }, t('restore'))
            : h('button', { type: 'button', className: 'wsc-btn wsc-btn-small', onClick: () => onArchive(row.id) }, t('archive')),
          h(
            'button',
            { type: 'button', className: 'wsc-btn wsc-btn-small wsc-btn-danger', onClick: () => onDelete(row.id) },
            t('deletePermanently'),
          ),
        ),
      );
    }

    function TranscriptDialog({ id, t, onClose }) {
      const dialogRef = useRef(null);
      const backRef = useRef(null);
      const [phase, setPhase] = useState('loading');
      const [item, setItem] = useState(null);
      const [error, setError] = useState(null);
      const [openTurn, setOpenTurn] = useState(null);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;

      useEffect(() => {
        let cancelled = false;
        void (async () => {
          try {
            const value = await callTranscript(id);
            if (cancelled) return;
            setItem(value);
            setPhase(value.status === 'ok' ? 'ready' : 'missing');
          } catch (failure) {
            if (cancelled) return;
            setError(failure);
            setPhase('error');
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [id]);

      useEffect(() => {
        if (backRef.current !== null) backRef.current.focus();
      }, [phase]);

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          closeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const root = dialogRef.current;
        if (root === null) return;
        const nodes = root.querySelectorAll('button, input, select, a[href]');
        const focusables = [];
        for (let index = 0; index < nodes.length; index += 1) {
          if (!nodes[index].disabled) focusables.push(nodes[index]);
        }
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const toggleTurn = (index) => {
        setOpenTurn((previous) => (previous === index ? null : index));
      };

      const title = item !== null && typeof item.title === 'string' && item.title.length > 0 ? item.title : String(id);
      const turns = item !== null && Array.isArray(item.turns) ? item.turns : [];
      const stats = item !== null && item.stats !== undefined ? item.stats : { turns: 0, userMessages: 0, toolCalls: 0 };

      const rows = [];
      if (item !== null && item.status === 'ok') {
        rows.push(['transcriptCwd', item.cwd !== undefined ? item.cwd : t('transcriptUnknown')]);
        rows.push(['transcriptTurns', String(stats.turns)]);
        rows.push(['transcriptUserMessages', String(stats.userMessages)]);
        rows.push(['transcriptToolCalls', String(stats.toolCalls)]);
        rows.push(['transcriptSize', Number.isFinite(item.sizeBytes) ? formatBytes(item.sizeBytes) : t('transcriptUnknown')]);
        rows.push(['transcriptCreated', Number.isFinite(item.createdAt) ? formatDateTime(item.createdAt) : t('transcriptUnknown')]);
      }

      return h(
        'div',
        {
          className: 'wsc-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose();
          },
          onKeyDown: handleKeyDown,
        },
        h(
          'div',
          { className: 'wsc-transcript', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wsc-transcript-title', ref: dialogRef, tabIndex: -1 },
          h(
            'div',
            { className: 'wsc-transcript-head' },
            h('button', { type: 'button', className: 'wsc-back', ref: backRef, onClick: onClose }, '← ' + t('transcriptBack')),
            h(
              'div',
              { className: 'wsc-transcript-titles' },
              h('h2', { id: 'wsc-transcript-title' }, t('transcriptTitle')),
              h('p', { className: 'wsc-transcript-sub', title }, title),
            ),
            h('button', { type: 'button', className: 'wsc-transcript-close', 'aria-label': t('close'), onClick: onClose }, '×'),
          ),
          h(
            'div',
            { className: 'wsc-transcript-body' },
            phase === 'loading' ? h('p', null, t('transcriptLoading')) : null,
            phase === 'error'
              ? h('p', { className: 'wsc-dialog-warn' }, t('transcriptError', { message: error !== null && error !== undefined && error.message ? error.message : String(error) }))
              : null,
            phase === 'missing' ? h('p', { className: 'wsc-dialog-warn' }, t('transcriptMissing')) : null,
            phase === 'ready'
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'wsc-kv' },
                    rows.map(([key, value]) =>
                      h(
                        'div',
                        { key, className: 'wsc-kv-row' },
                        h('span', { className: 'wsc-kv-key' }, t(key)),
                        h('span', { className: 'wsc-kv-val' }, String(value)),
                      ),
                    ),
                  ),
                  h('h3', { className: 'wsc-section-title' }, t('transcriptQuestions', { n: stats.userMessages })),
                  turns.length === 0 ? h('p', { className: 'wsc-empty' }, t('transcriptEmpty')) : null,
                  turns.map((turn) => {
                    const open = openTurn === turn.index;
                    return h(
                      'div',
                      { className: 'wsc-turn', key: String(turn.index) + '-' + String(turn.time) },
                      h(
                        'button',
                        { type: 'button', className: 'wsc-turn-head', 'aria-expanded': open, onClick: () => toggleTurn(turn.index) },
                        h('span', { className: 'wsc-turn-badge' }, t('transcriptTurn', { n: turn.index })),
                        h('span', { className: 'wsc-turn-time' }, Number.isFinite(turn.time) ? formatDateTime(turn.time) : ''),
                        h('span', { className: 'wsc-turn-tools' }, t('transcriptTools', { n: Array.isArray(turn.tools) ? turn.tools.length : 0 })),
                        h('span', { className: 'wsc-turn-caret' + (open ? ' wsc-turn-caret-open' : ''), 'aria-hidden': 'true' }, h(CaretIcon)),
                      ),
                      h(
                        'div',
                        { className: 'wsc-turn-question' },
                        turn.userText.length > 0 ? h('span', { className: 'wsc-turn-role-user' }, t('transcriptUser')) : null,
                        turn.userText.length > 0 ? turn.userText : t('transcriptUnknown'),
                      ),
                      open
                        ? h(
                            'div',
                            { className: 'wsc-turn-answer' },
                            h('span', { className: 'wsc-turn-role-assistant' }, t('transcriptAssistant')),
                            turn.assistantText.length > 0
                              ? h('div', { className: 'wsc-turn-text' }, turn.assistantText)
                              : h('div', { className: 'wsc-turn-text wsc-turn-muted' }, t('transcriptNoReply')),
                            Array.isArray(turn.tools) && turn.tools.length > 0 ? h('div', { className: 'wsc-turn-toollist' }, turn.tools.join(' · ')) : null,
                          )
                        : null,
                    );
                  }),
                  item !== null && item.truncated === true ? h('p', { className: 'wsc-transcript-note' }, t('transcriptTruncated', { n: item.total })) : null,
                )
              : null,
          ),
        ),
      );
    }

    function BackupDialog({ t, onClose, onImported }) {
      const dialogRef = useRef(null);
      const backRef = useRef(null);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;
      const inputRef = useRef(null);
      const [busy, setBusy] = useState(null);
      const [file, setFile] = useState(null);
      const [notice, setNotice] = useState(null);
      const [result, setResult] = useState(null);

      const messageOf = (failure) => (failure !== null && failure !== undefined && failure.message ? failure.message : String(failure));

      useEffect(() => {
        if (backRef.current !== null) backRef.current.focus();
      }, []);

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (busy === null) closeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const root = dialogRef.current;
        if (root === null) return;
        const nodes = root.querySelectorAll('button, input, select, a[href]');
        const focusables = [];
        for (let index = 0; index < nodes.length; index += 1) {
          if (!nodes[index].disabled) focusables.push(nodes[index]);
        }
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const exportAll = async () => {
        if (busy !== null) return;
        setBusy('export');
        setNotice(null);
        try {
          const outcome = await downloadBackup();
          setNotice(t('backupExported', { n: outcome.count }));
        } catch (failure) {
          setNotice(t('backupDownloadFailed', { message: messageOf(failure) }));
        } finally {
          setBusy(null);
        }
      };

      const importFile = async () => {
        if (busy !== null || file === null) return;
        if (file.size > 64 * 1024 * 1024) {
          setNotice(t('backupFileTooLarge'));
          return;
        }
        setBusy('import');
        setNotice(null);
        setResult(null);
        try {
          const body = await uploadBackup(file);
          setResult(body);
          const imported = body.items.filter((item) => item.status === 'imported').length;
          if (imported > 0) onImported();
          const rewritten = Number(body.rewritten || 0);
          const note = t('backupImported', { n: imported }) + (rewritten > 0 ? ' ' + t('backupCwdNote', { n: rewritten, path: body.targetCwd }) : '');
          setNotice(note);
          if (inputRef.current !== null) inputRef.current.value = '';
        } catch (failure) {
          setNotice(t('backupImportFailed', { message: messageOf(failure) }));
        } finally {
          setBusy(null);
        }
      };

      const statusText = (status) => {
        if (status === 'imported') return t('backupStatusImported');
        if (status === 'conflict') return t('backupStatusConflict');
        if (status === 'invalid') return t('backupStatusInvalid');
        return t('backupStatusFailed');
      };

      const counts = { imported: 0, conflict: 0, invalid: 0, failed: 0 };
      if (result !== null) {
        for (const item of result.items) {
          if (counts[item.status] !== undefined) counts[item.status] += 1;
        }
      }

      return h(
        'div',
        {
          className: 'wsc-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && busy === null) onClose();
          },
          onKeyDown: handleKeyDown,
        },
        h(
          'div',
          { className: 'wsc-transcript', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wsc-backup-title', ref: dialogRef, tabIndex: -1 },
          h(
            'div',
            { className: 'wsc-transcript-head' },
            h('button', { type: 'button', className: 'wsc-back', ref: backRef, onClick: onClose }, '← ' + t('transcriptBack')),
            h('div', { className: 'wsc-transcript-titles' }, h('h2', { id: 'wsc-backup-title' }, t('backupTitle'))),
            h('button', { type: 'button', className: 'wsc-transcript-close', 'aria-label': t('close'), onClick: onClose }, '×'),
          ),
          h(
            'div',
            { className: 'wsc-transcript-body' },
            h(
              'div',
              { className: 'wsc-backup-section' },
              h('h3', { className: 'wsc-section-title' }, t('backupExportAll')),
              h('p', { className: 'wsc-transcript-note' }, t('backupExportHint')),
              h(
                'div',
                { className: 'wsc-backup-actions' },
                h('button', { type: 'button', className: 'wsc-btn', disabled: busy !== null, onClick: () => void exportAll() }, busy === 'export' ? t('backupExporting') : t('backupExportAll')),
              ),
            ),
            h(
              'div',
              { className: 'wsc-backup-section' },
              h('h3', { className: 'wsc-section-title' }, t('backupImport')),
              h('p', { className: 'wsc-transcript-note' }, t('backupImportHint')),
              h('input', {
                type: 'file',
                accept: '.tar.gz,application/gzip,application/x-gzip',
                style: { display: 'none' },
                ref: inputRef,
                onChange: (event) => {
                  const picked = event.target.files !== null && event.target.files.length > 0 ? event.target.files[0] : null;
                  setFile(picked);
                  setResult(null);
                  setNotice(null);
                },
              }),
              h(
                'div',
                { className: 'wsc-backup-actions' },
                h('button', { type: 'button', className: 'wsc-btn', disabled: busy !== null, onClick: () => inputRef.current?.click() }, t('backupChooseFile')),
                h('span', { className: 'wsc-backup-file' }, file !== null ? file.name : t('backupNoFile')),
                h('button', { type: 'button', className: 'wsc-btn', disabled: busy !== null || file === null, onClick: () => void importFile() }, busy === 'import' ? t('backupImporting') : t('backupImport')),
              ),
            ),
            notice !== null ? h('p', { className: 'wsc-dialog-warn' }, notice) : null,
            result !== null
              ? h(
                  React.Fragment,
                  null,
                  h('p', { className: 'wsc-summary' }, t('backupResult', counts)),
                  result.items.filter((item) => item.status !== 'imported').length > 0
                    ? h(
                        'ul',
                        { className: 'wsc-failures' },
                        result.items
                          .filter((item) => item.status !== 'imported')
                          .map((item) =>
                            h(
                              'li',
                              { key: item.id },
                              h('div', { className: 'wsc-failure-id' }, String(item.id)),
                              h('div', null, statusText(item.status) + (item.reason ? '：' + item.reason : '')),
                            ),
                          ),
                      )
                    : null,
                )
              : null,
          ),
        ),
      );
    }

    function TrashDialog({ t, onClose, onChanged }) {
      const dialogRef = useRef(null);
      const backRef = useRef(null);
      const [phase, setPhase] = useState('loading');
      const [items, setItems] = useState([]);
      const [retentionInput, setRetentionInput] = useState('7');
      const [error, setError] = useState(null);
      const [pending, setPending] = useState(null);
      const [confirmEmpty, setConfirmEmpty] = useState(false);
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;

      const messageOf = (failure) => (failure !== null && failure !== undefined && failure.message ? failure.message : String(failure));

      const load = useCallback(async () => {
        setPhase('loading');
        setError(null);
        try {
          const body = await callTrash('trash-list');
          setItems(Array.isArray(body.items) ? body.items : []);
          setRetentionInput(String(body.retentionDays));
          setPhase('ready');
        } catch (failure) {
          setError(failure);
          setPhase('error');
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      useEffect(() => {
        if (backRef.current !== null) backRef.current.focus();
      }, [phase]);

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!busy) closeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const root = dialogRef.current;
        if (root === null) return;
        const nodes = root.querySelectorAll('button, input, select, a[href]');
        const focusables = [];
        for (let index = 0; index < nodes.length; index += 1) {
          if (!nodes[index].disabled) focusables.push(nodes[index]);
        }
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const restore = async (entry) => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
          await callTrash('trash-restore', { entryIds: [entry.entryId] });
          await load();
          setNotice(t('trashRestored', { n: 1 }));
          if (typeof onChanged === 'function') onChanged();
        } catch (failure) {
          setNotice(t('trashFailed', { message: messageOf(failure) }));
        } finally {
          setBusy(false);
        }
      };

      const purge = async (entry) => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
          await callTrash('trash-purge', { entryIds: [entry.entryId] });
          setPending(null);
          await load();
          setNotice(t('trashPurged', { n: 1 }));
          if (typeof onChanged === 'function') onChanged();
        } catch (failure) {
          setNotice(t('trashFailed', { message: messageOf(failure) }));
        } finally {
          setBusy(false);
        }
      };

      const purgeAll = async () => {
        if (busy) return;
        const targets = items.map((entry) => entry.entryId);
        if (targets.length === 0) return;
        setBusy(true);
        setNotice(null);
        try {
          const body = await callTrash('trash-purge', { entryIds: targets });
          const purged = body.items.filter((item) => item.status === 'purged').length;
          const failed = body.items.length - purged;
          setConfirmEmpty(false);
          await load();
          setNotice(failed > 0 ? t('trashPartial', { ok: purged, failed }) : t('trashEmptied', { n: purged }));
          if (typeof onChanged === 'function') onChanged();
        } catch (failure) {
          setNotice(t('trashFailed', { message: messageOf(failure) }));
        } finally {
          setBusy(false);
        }
      };

      const saveRetention = async () => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
          const body = await callTrash('trash-settings', { retentionDays: Number(retentionInput) });
          setRetentionInput(String(body.retentionDays));
          await load();
          setNotice(t('trashSaved'));
        } catch (failure) {
          setNotice(t('trashFailed', { message: messageOf(failure) }));
        } finally {
          setBusy(false);
        }
      };

      const titleOf = (entry) => (typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : entry.id);

      return h(
        'div',
        {
          className: 'wsc-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          },
          onKeyDown: handleKeyDown,
        },
        h(
          'div',
          { className: 'wsc-transcript', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wsc-trash-title', ref: dialogRef, tabIndex: -1 },
          h(
            'div',
            { className: 'wsc-transcript-head' },
            h('button', { type: 'button', className: 'wsc-back', ref: backRef, onClick: onClose }, '← ' + t('transcriptBack')),
            h('div', { className: 'wsc-transcript-titles' }, h('h2', { id: 'wsc-trash-title' }, t('trashTitle'))),
            h('button', { type: 'button', className: 'wsc-transcript-close', 'aria-label': t('close'), onClick: onClose }, '×'),
          ),
          h(
            'div',
            { className: 'wsc-transcript-body' },
            h(
              'div',
              { className: 'wsc-trash-settings' },
              h('span', null, t('trashRetention')),
              h('input', {
                type: 'number',
                min: 1,
                max: 365,
                value: retentionInput,
                'aria-label': t('trashRetention'),
                onChange: (event) => setRetentionInput(event.target.value),
              }),
              h('button', { type: 'button', className: 'wsc-btn wsc-btn-small', disabled: busy, onClick: saveRetention }, t('trashSave')),
              h('span', { className: 'wsc-spacer' }),
              h(
                'button',
                { type: 'button', className: 'wsc-btn wsc-btn-small wsc-btn-danger', disabled: busy || items.length === 0, onClick: () => setConfirmEmpty(true) },
                t('trashEmptyAll', { n: items.length }),
              ),
            ),
            notice !== null ? h('p', { className: 'wsc-transcript-note' }, notice) : null,
            phase === 'loading' ? h('p', null, t('trashLoading')) : null,
            phase === 'error' ? h('p', { className: 'wsc-dialog-warn' }, t('trashError', { message: messageOf(error) })) : null,
            phase === 'ready' && items.length === 0 ? h('p', { className: 'wsc-empty' }, t('trashEmpty')) : null,
            confirmEmpty
              ? h(
                  'div',
                  { className: 'wsc-confirm' },
                  h('div', { className: 'wsc-confirm-title' }, t('trashEmptyConfirmTitle')),
                  h('p', null, t('trashEmptyConfirmBody', { n: items.length })),
                  h(
                    'div',
                    { className: 'wsc-dialog-actions' },
                    h('button', { type: 'button', className: 'wsc-btn', disabled: busy, onClick: () => setConfirmEmpty(false) }, t('trashCancel')),
                    h('button', { type: 'button', className: 'wsc-btn wsc-btn-danger', disabled: busy, onClick: () => void purgeAll() }, t('trashEmptyConfirm')),
                  ),
                )
              : null,
            pending !== null
              ? h(
                  'div',
                  { className: 'wsc-confirm' },
                  h('div', { className: 'wsc-confirm-title' }, t('trashConfirmTitle')),
                  h('p', null, t('trashConfirmBody', { title: titleOf(pending) })),
                  h(
                    'div',
                    { className: 'wsc-dialog-actions' },
                    h('button', { type: 'button', className: 'wsc-btn', disabled: busy, onClick: () => setPending(null) }, t('trashCancel')),
                    h('button', { type: 'button', className: 'wsc-btn wsc-btn-danger', disabled: busy, onClick: () => void purge(pending) }, t('trashConfirm')),
                  ),
                )
              : null,
            phase === 'ready'
              ? items.map((entry) =>
                  h(
                    'div',
                    { className: 'wsc-trash-row', key: entry.entryId },
                    h(
                      'div',
                      { className: 'wsc-trash-main' },
                      h('div', { className: 'wsc-trash-title', title: titleOf(entry) }, titleOf(entry)),
                      h(
                        'div',
                        { className: 'wsc-trash-meta' },
                        t('trashDeletedAt') +
                          ' ' +
                          formatDateTime(entry.deletedAt) +
                          ' · ' +
                          t('trashExpiresIn', { n: entry.expiresInDays }) +
                          (Number.isFinite(entry.bytes) ? ' · ' + t('trashSize') + ' ' + formatBytes(entry.bytes) : ''),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'wsc-trash-actions' },
                      h('button', { type: 'button', className: 'wsc-btn wsc-btn-small', disabled: busy, onClick: () => void restore(entry) }, t('trashRestore')),
                      h('button', { type: 'button', className: 'wsc-btn wsc-btn-small wsc-btn-danger', disabled: busy, onClick: () => setPending(entry) }, t('trashPurge')),
                    ),
                  ),
                )
              : null,
          ),
        ),
      );
    }

    function ArchiveDialog({ request, t, archiveSession, onSettled, onClose }) {
      const dialogRef = useRef(null);
      const primaryRef = useRef(null);
      const [busy, setBusy] = useState(null);
      const [failures, setFailures] = useState([]);
      const busyRef = useRef(false);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;

      useEffect(() => {
        if (primaryRef.current !== null) primaryRef.current.focus();
      }, []);

      useEffect(() => {
        busyRef.current = busy !== null;
      }, [busy]);

      useEffect(() => {
        if (failures.length > 0 && primaryRef.current !== null) primaryRef.current.focus();
      }, [failures.length]);

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (!busyRef.current) closeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const root = dialogRef.current;
        if (root === null) return;
        const nodes = root.querySelectorAll('button, input, select, a[href]');
        const focusables = [];
        for (let index = 0; index < nodes.length; index += 1) {
          if (!nodes[index].disabled) focusables.push(nodes[index]);
        }
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const run = async () => {
        if (busyRef.current) return;
        const ids = request.ids;
        setFailures([]);
        setBusy({ done: 0, total: ids.length });
        let ok = 0;
        const failed = [];
        for (let index = 0; index < ids.length; index += 1) {
          const id = ids[index];
          try {
            await archiveSession(id, request.running > 0 ? { stopActivity: true } : undefined);
            ok += 1;
          } catch (error) {
            failed.push({ id, message: failureMessage(error, t) });
          }
          setBusy({ done: index + 1, total: ids.length });
        }
        setBusy(null);
        onSettled(ok, failed.map((entry) => entry.id));
        if (failed.length === 0) {
          onClose();
        } else {
          setFailures(failed);
        }
      };

      const total = request.ids.length;
      const settled = failures.length > 0;
      return h(
        'div',
        {
          className: 'wsc-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !busyRef.current) onClose();
          },
          onKeyDown: handleKeyDown,
        },
        h(
          'div',
          { className: 'wsc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wsc-archive-title', ref: dialogRef, tabIndex: -1 },
          h('h2', { id: 'wsc-archive-title' }, t('archiveConfirmTitle')),
          h('p', null, t('archiveConfirmBody', { n: total })),
          request.running > 0 ? h('p', { className: 'wsc-dialog-warn' }, t('archiveRunning', { n: request.running })) : null,
          settled
            ? h(
                'div',
                null,
                h('p', null, t('failureSummary', { ok: total - failures.length, failed: failures.length })),
                h(
                  'ul',
                  { className: 'wsc-failures' },
                  failures.map((entry) =>
                    h(
                      'li',
                      { key: entry.id },
                      h('div', { className: 'wsc-failure-id' }, String(entry.id)),
                      h('div', null, entry.message),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { className: 'wsc-dialog-actions' },
            busy !== null ? h('span', { className: 'wsc-progress' }, t('processing', { done: busy.done, total: busy.total })) : null,
            settled
              ? h('button', { type: 'button', className: 'wsc-btn', ref: primaryRef, onClick: onClose }, t('close'))
              : [
                  h('button', { key: 'cancel', type: 'button', className: 'wsc-btn', disabled: busy !== null, onClick: onClose }, t('cancel')),
                  h(
                    'button',
                    { key: 'confirm', type: 'button', className: 'wsc-btn', ref: primaryRef, disabled: busy !== null, onClick: run },
                    busy !== null ? t('working') : t('archive'),
                  ),
                ],
          ),
        ),
      );
    }

    function PurgeDialog({ ids, labels, t, onClose, onFinished }) {
      const dialogRef = useRef(null);
      const primaryRef = useRef(null);
      const [phase, setPhase] = useState(ids.length === 0 ? 'blocked' : 'checking');
      const [previewItems, setPreviewItems] = useState([]);
      const [result, setResult] = useState(null);
      const [error, setError] = useState(null);
      const phaseRef = useRef(phase);
      phaseRef.current = phase;
      const closeRef = useRef(onClose);
      closeRef.current = onClose;

      const nameOf = (id) => {
        const label = labels !== undefined && labels !== null ? labels[id] : undefined;
        return typeof label === 'string' && label.length > 0 ? label : String(id);
      };
      const deletable = previewItems.filter((item) => item.status === 'deletable');
      const blocked = previewItems.filter((item) => item.status !== 'deletable');
      const totalBytes = deletable.reduce((sum, item) => sum + (item.bytes ?? 0), 0);

      useEffect(() => {
        if (phase !== 'confirm' && phase !== 'error' && phase !== 'done' && phase !== 'blocked') return;
        if (primaryRef.current !== null) primaryRef.current.focus();
      }, [phase]);

      const check = useCallback(async () => {
        if (ids.length === 0) {
          setPhase('blocked');
          return;
        }
        setPhase('checking');
        setError(null);
        setPreviewItems([]);
        setResult(null);
        try {
          const report = await callCleanup('preview', ids);
          setPreviewItems(report.items);
          setPhase('confirm');
        } catch (failure) {
          setError({ kind: 'check', failure });
          setPhase('error');
        }
      }, [ids]);

      useEffect(() => {
        if (ids.length === 0) return;
        void check();
      }, [check, ids.length]);

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (phaseRef.current !== 'running') closeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const root = dialogRef.current;
        if (root === null) return;
        const nodes = root.querySelectorAll('button, input, select, a[href]');
        const focusables = [];
        for (let index = 0; index < nodes.length; index += 1) {
          if (!nodes[index].disabled) focusables.push(nodes[index]);
        }
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      const run = async () => {
        if (phase !== 'confirm' || deletable.length === 0) return;
        const targetIds = deletable.map((item) => item.id);
        setPhase('running');
        setError(null);
        try {
          const report = await callCleanup('delete', targetIds);
          const deleted = report.items.filter((item) => item.status === 'deleted').map((item) => item.id);
          const failed = report.items.filter((item) => item.status !== 'deleted');
          setResult({ deleted, failed });
          setPhase('done');
          onFinished(deleted, failed.map((item) => item.id));
          if (failed.length === 0) closeRef.current();
        } catch (failure) {
          setError({ kind: 'run', failure });
          setPhase('error');
        }
      };

      const errorText = (entry) => {
        const failure = entry !== null && entry !== undefined ? entry.failure : undefined;
        if (failure !== null && failure !== undefined && failure.status === 404) return t('purgeHostUnavailable');
        const message = failure !== null && failure !== undefined && failure.message ? failure.message : String(failure);
        return entry !== null && entry !== undefined && entry.kind === 'run'
          ? t('purgeRunFailed', { message })
          : t('purgeCheckFailed', { message });
      };

      const body = [];
      if (phase === 'blocked') {
        body.push(h('p', { key: 'blocked', className: 'wsc-dialog-warn' }, t('deleteRunningBlocked')));
        body.push(
          h(
            'div',
            { key: 'blocked-actions', className: 'wsc-dialog-actions' },
            h('button', { type: 'button', className: 'wsc-btn', ref: primaryRef, onClick: onClose }, t('close')),
          ),
        );
      } else if (phase === 'error') {
        body.push(h('p', { key: 'error', className: 'wsc-dialog-warn' }, errorText(error)));
      } else if (phase === 'checking') {
        body.push(h('p', { key: 'checking' }, t('purgeChecking', { n: ids.length })));
      } else if (phase === 'running') {
        body.push(h('p', { key: 'running' }, t('purgeRunning', { n: deletable.length })));
      } else if (phase === 'done') {
        const deletedCount = result !== null ? result.deleted.length : 0;
        const failedItems = result !== null ? result.failed : [];
        body.push(h('p', { key: 'done' }, t('purgeDone', { n: deletedCount })));
        if (failedItems.length > 0) {
          body.push(
            h(
              'ul',
              { key: 'failures', className: 'wsc-failures' },
              failedItems.map((item) =>
                h(
                  'li',
                  { key: item.id },
                  h('div', { className: 'wsc-failure-id' }, nameOf(item.id)),
                  h('div', null, blockedText(item, t)),
                ),
              ),
            ),
          );
        }
      } else if (deletable.length === 0) {
        body.push(h('div', { key: 'nothing', className: 'wsc-dialog-warn' }, t('purgeNothingDeletable')));
        if (blocked.length > 0) {
          body.push(
            h(
              'ul',
              { key: 'blocked', className: 'wsc-failures' },
              blocked.map((item) =>
                h(
                  'li',
                  { key: item.id },
                  h('div', { className: 'wsc-failure-id' }, nameOf(item.id)),
                  h('div', null, blockedText(item, t)),
                ),
              ),
            ),
          );
        }
      } else {
        body.push(h('p', { key: 'intro' }, t('purgeBody', { n: deletable.length })));
        body.push(h('div', { key: 'summary', className: 'wsc-summary' }, t('purgeSummary', { n: deletable.length, size: formatBytes(totalBytes) })));
        body.push(
          h(
            'ul',
            { key: 'titles', className: 'wsc-titles', 'aria-label': t('purgeNamesAria') },
            deletable.map((item) =>
              h(
                'li',
                { key: item.id },
                h('span', { className: 'wsc-title-name', title: nameOf(item.id) }, nameOf(item.id)),
                Number.isFinite(item.bytes) ? h('span', { className: 'wsc-title-size' }, formatBytes(item.bytes)) : null,
              ),
            ),
          ),
        );
        const liveCount = deletable.filter((item) => item.live === true).length;
        if (liveCount > 0) body.push(h('p', { key: 'live-note', className: 'wsc-dialog-warn' }, t('purgeLiveNote', { n: liveCount })));
        body.push(h('p', { key: 'irreversible', className: 'wsc-dialog-warn' }, t('purgeIrreversible')));
        if (blocked.length > 0) {
          body.push(h('p', { key: 'blocked-title' }, t('purgeBlockedTitle', { n: blocked.length })));
          body.push(
            h(
              'ul',
              { key: 'blocked', className: 'wsc-failures' },
              blocked.map((item) =>
                h(
                  'li',
                  { key: item.id },
                  h('div', { className: 'wsc-failure-id' }, nameOf(item.id)),
                  h('div', null, blockedText(item, t)),
                ),
              ),
            ),
          );
        }
      }

      const actions = [];
      if (phase === 'error') {
        actions.push(
          h('button', { key: 'retry', type: 'button', className: 'wsc-btn', onClick: () => void check() }, t('purgeRetry')),
          h('button', { key: 'close', type: 'button', className: 'wsc-btn', ref: primaryRef, onClick: onClose }, t('close')),
        );
      } else if (phase === 'done' || (phase === 'confirm' && deletable.length === 0)) {
        actions.push(h('button', { key: 'close', type: 'button', className: 'wsc-btn', ref: primaryRef, onClick: onClose }, t('close')));
      } else if (phase === 'confirm') {
        actions.push(
          h('button', { key: 'cancel', type: 'button', className: 'wsc-btn', onClick: onClose }, t('cancel')),
          h(
            'button',
            { key: 'confirm', type: 'button', className: 'wsc-btn wsc-btn-danger', ref: primaryRef, onClick: run },
            t('purgeConfirm'),
          ),
        );
      }

      return h(
        'div',
        {
          className: 'wsc-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && phaseRef.current !== 'running') onClose();
          },
          onKeyDown: handleKeyDown,
        },
        h(
          'div',
          { className: 'wsc-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wsc-purge-title', ref: dialogRef, tabIndex: -1 },
          h('h2', { id: 'wsc-purge-title' }, t('purgeTitle')),
          body,
          actions.length > 0 ? h('div', { className: 'wsc-dialog-actions' }, actions) : null,
        ),
      );
    }

    function SessionCleanupPage(props) {
      const { archiveSession, unarchiveSession, refreshSessions, useSessions, useWorkspaces, t } = props;
      const workspaceState = useWorkspaces((state) => state);
      const sessionState = useSessions((state) => state);

      const workspaces = workspaceState.items || [];
      const ids = sessionState.ids || [];
      const byId = sessionState.byId || {};
      const archivedIds = workspaceState.archivedSessionIds || [];
      const pinnedIds = workspaceState.pinnedSessionIds || [];

      const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds]);
      const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
      const pinRank = useMemo(() => {
        const ranks = new Map();
        pinnedIds.forEach((id, index) => ranks.set(id, index));
        return ranks;
      }, [pinnedIds]);

      const [search, setSearch] = useState('');
      const [scope, setScope] = useState('all');
      const [showArchived, setShowArchived] = useState(false);
      const [collapsed, setCollapsed] = useState(() => new Set());
      const [expanded, setExpanded] = useState(() => new Set());
      const [selected, setSelected] = useState(() => new Set());
      const [archiveRequest, setArchiveRequest] = useState(null);
      const [transcriptId, setTranscriptId] = useState(null);
      const [trashOpen, setTrashOpen] = useState(false);
      const [backupOpen, setBackupOpen] = useState(false);
      const [refreshing, setRefreshing] = useState(false);
      const [orphans, setOrphans] = useState(() => new Set());

      // A session deleted while its Agent was still loaded stays in the Host's
      // in-memory list with no storage left. It cannot be detached from here,
      // so hide those rows: they are gone, not broken.
      const refreshAll = useCallback(async () => {
        setRefreshing(true);
        try {
          if (typeof refreshSessions === 'function') await refreshSessions();
          const body = await callTrash('orphans');
          setOrphans(new Set(Array.isArray(body.ids) ? body.ids : []));
        } catch (failure) {
          setNotice(t('refreshFailed', { message: failure !== null && failure !== undefined && failure.message ? failure.message : String(failure) }));
        } finally {
          setRefreshing(false);
        }
      }, [refreshSessions, t]);

      useEffect(() => {
        void refreshAll();
      }, [refreshAll]);

      const backupSingle = useCallback(
        async (id) => {
          try {
            const outcome = await downloadBackup([id]);
            setNotice(t('backupExported', { n: outcome.count }));
          } catch (failure) {
            setNotice(t('backupDownloadFailed', { message: failure !== null && failure !== undefined && failure.message ? failure.message : String(failure) }));
          }
        },
        [t],
      );
      const [purgeIds, setPurgeIds] = useState(null);
      const [restoring, setRestoring] = useState(false);
      const [notice, setNotice] = useState(null);

      useEffect(() => {
        if (notice === null) return undefined;
        const timer = window.setTimeout(() => setNotice(null), 5000);
        return () => window.clearTimeout(timer);
      }, [notice]);

      const groups = useMemo(() => {
        const memberOf = new Map();
        for (const workspace of workspaces) {
          for (const id of workspace.sessionIds || []) if (!memberOf.has(id)) memberOf.set(id, workspace.workspaceId);
        }
        // "Who created it owns it": a Session belongs to its nearest ancestor's
        // Workspace. Subagent children therefore stay under the parent that
        // spawned them even when their own header does not list membership.
        const resolved = new Map();
        const resolveGroup = (id) => {
          const trail = [];
          let current = id;
          while (!resolved.has(current)) {
            if (trail.includes(current)) {
              for (const visited of trail) resolved.set(visited, '');
              return '';
            }
            trail.push(current);
            if (memberOf.has(current)) {
              const key = memberOf.get(current);
              for (const visited of trail) resolved.set(visited, key);
              return key;
            }
            const row = byId[current];
            if (!row || !row.parentId) {
              for (const visited of trail) resolved.set(visited, '');
              return '';
            }
            current = row.parentId;
          }
          const key = resolved.get(current);
          for (const visited of trail) resolved.set(visited, key);
          return key;
        };
        const buckets = new Map(workspaces.map((workspace) => [workspace.workspaceId, []]));
        const ungrouped = [];
        for (const id of ids) {
          const row = byId[id];
          if (!row || row.blank) continue;
          const key = resolveGroup(id);
          if (key !== '' && buckets.has(key)) buckets.get(key).push(row);
          else ungrouped.push(row);
        }
        const result = [];
        for (const workspace of workspaces) {
          result.push({
            key: workspace.workspaceId,
            title: workspace.title || basename(workspace.path) || String(workspace.workspaceId),
            path: workspace.path,
            sessions: buckets.get(workspace.workspaceId),
          });
        }
        if (ungrouped.length > 0) result.push({ key: '', title: t('ungrouped'), path: undefined, sessions: ungrouped });
        return result;
      }, [workspaces, byId, ids, t]);

      const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        const out = [];
        for (const group of groups) {
          if (scope !== 'all' && group.key !== scope) continue;
          const rows = [];
          for (const row of group.sessions) {
            if (row.blank) continue;
            if (orphans.has(row.id)) continue;
            const archived = archivedSet.has(row.id);
            if (archived && !showArchived) continue;
            if (query) {
              const haystack = ((row.title || '') + ' ' + row.displayTitle + ' ' + (row.cwd || '') + ' ' + row.id).toLowerCase();
              if (haystack.indexOf(query) < 0) continue;
            }
            rows.push(row);
          }
          if (rows.length === 0) continue;
          const byRowId = new Map(rows.map((row) => [row.id, row]));
          const children = new Map();
          const roots = [];
          for (const row of rows) {
            const parent = row.parentId === undefined ? undefined : byRowId.get(row.parentId);
            if (parent !== undefined && parent.id !== row.id) {
              const list = children.get(parent.id);
              if (list === undefined) children.set(parent.id, [row]);
              else list.push(row);
            } else {
              roots.push(row);
            }
          }
          const compare = (left, right) => {
            const leftArchived = archivedSet.has(left.id) ? 1 : 0;
            const rightArchived = archivedSet.has(right.id) ? 1 : 0;
            if (leftArchived !== rightArchived) return leftArchived - rightArchived;
            const leftPin = pinRank.get(left.id);
            const rightPin = pinRank.get(right.id);
            if (leftPin !== undefined || rightPin !== undefined) {
              if (leftPin === undefined) return 1;
              if (rightPin === undefined) return -1;
              return leftPin - rightPin;
            }
            return (right.updatedAt || 0) - (left.updatedAt || 0);
          };
          roots.sort(compare);
          for (const list of children.values()) list.sort(compare);
          out.push({ key: group.key, title: group.title, path: group.path, rows, children, roots });
        }
        return out;
      }, [groups, scope, archivedSet, showArchived, search, pinRank]);

      // Collapsed is the default: every parent starts folded. A search query
      // unfolds matches so a matching child is never hidden behind its parent.
      const visible = useMemo(() => {
        const searching = search.trim() !== '';
        return filtered.map((group) => {
          const flat = [];
          const walk = (row, depth) => {
            const kids = group.children.get(row.id) ?? [];
            flat.push({ row, depth, childCount: kids.length });
            if (searching || expanded.has(row.id)) for (const child of kids) walk(child, depth + 1);
          };
          for (const root of group.roots) walk(root, 0);
          return { key: group.key, title: group.title, path: group.path, rows: flat, ids: group.rows.map((row) => row.id), count: group.rows.length };
        });
      }, [filtered, expanded, search]);

      const filteredIds = useMemo(() => {
        const set = new Set();
        for (const group of filtered) for (const row of group.rows) set.add(row.id);
        return set;
      }, [filtered]);

      const selectableIds = useMemo(() => {
        const set = new Set();
        for (const group of filtered) for (const row of group.rows) if (row.running !== true) set.add(row.id);
        return set;
      }, [filtered]);

      // Selecting a parent selects the whole subtree; collapsing only hides
      // rows, so hidden children stay selected.
      const descendants = useMemo(() => {
        const map = new Map();
        for (const group of filtered) {
          const collect = (row, acc) => {
            for (const child of group.children.get(row.id) ?? []) {
              acc.push(child.id);
              collect(child, acc);
            }
            return acc;
          };
          for (const row of group.rows) map.set(row.id, collect(row, []));
        }
        return map;
      }, [filtered]);

      useEffect(() => {
        setSelected((previous) => {
          let changed = false;
          const next = new Set();
          previous.forEach((id) => {
            if (selectableIds.has(id)) next.add(id);
            else changed = true;
          });
          return changed ? next : previous;
        });
      }, [selectableIds]);

      const toggleSession = useCallback(
        (id) => {
          setSelected((previous) => {
            const next = new Set(previous);
            const list = [id, ...(descendants.get(id) ?? [])];
            if (next.has(id)) {
              for (const member of list) next.delete(member);
            } else {
              for (const member of list) if (selectableIds.has(member)) next.add(member);
            }
            return next;
          });
        },
        [descendants, selectableIds],
      );

      const toggleExpanded = useCallback((id) => {
        setExpanded((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }, []);

      // A row's delete button: explicit checks inside the row's subtree win;
      // otherwise a parent row takes its whole subtree, while a child row
      // never reaches up to its parent.
      const requestDeleteRow = useCallback(
        (id) => {
          if (byId[id]?.running === true) {
            setPurgeIds([]);
            return;
          }
          const subtree = [id, ...(descendants.get(id) ?? [])].filter((member) => byId[member]?.running !== true);
          if (subtree.length === 0) {
            setPurgeIds([]);
            return;
          }
          const checked = subtree.filter((member) => selected.has(member));
          setPurgeIds(checked.length > 0 ? checked : subtree);
        },
        [descendants, selected, byId, t],
      );

      const setMany = useCallback((list, on) => {
        setSelected((previous) => {
          const next = new Set(previous);
          for (const id of list) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      }, []);

      const toggleGroupCollapse = useCallback((key) => {
        setCollapsed((previous) => {
          const next = new Set(previous);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      }, []);

      const allSelected = selectableIds.size > 0 && Array.from(selectableIds).every((id) => selected.has(id));

      const toggleAllVisible = () => {
        setMany(Array.from(selectableIds), !allSelected);
      };

      const requestArchive = useCallback(
        (list) => {
          if (list.length === 0) return;
          let running = 0;
          for (const id of list) {
            const row = byId[id];
            if (row && row.running) running += 1;
          }
          setArchiveRequest({ ids: list.slice(), running });
        },
        [byId],
      );

      const settleArchive = useCallback(
        (done, ok, failedIds) => {
          const failedSet = new Set(failedIds);
          setSelected((previous) => {
            const next = new Set(previous);
            for (const id of done.ids) if (!failedSet.has(id)) next.delete(id);
            return next;
          });
          if (failedIds.length === 0) setNotice(t('archiveNotice', { n: ok }));
        },
        [t],
      );

      const restoreIds = useCallback(
        async (list) => {
          if (restoring || list.length === 0) return;
          setRestoring(true);
          let ok = 0;
          let failed = 0;
          for (const id of list) {
            try {
              await unarchiveSession(id);
              ok += 1;
            } catch (error) {
              failed += 1;
            }
          }
          setRestoring(false);
          setSelected((previous) => {
            const next = new Set(previous);
            for (const id of list) next.delete(id);
            return next;
          });
          setNotice(failed > 0 ? t('partialRestore', { ok, failed }) : t('restored', { n: ok }));
        },
        [restoring, t, unarchiveSession],
      );

      const settlePurge = useCallback(
        (deleted, failed) => {
          const removed = new Set(deleted);
          setSelected((previous) => {
            const next = new Set(previous);
            for (const id of removed) next.delete(id);
            return next;
          });
          if (deleted.length > 0) {
            setNotice(t('purgeDoneNotice', { n: deleted.length }));
            void refreshAll();
          }
        },
        [refreshAll, t],
      );

      const labels = useMemo(() => {
        const map = Object.create(null);
        for (const id of ids) {
          const row = byId[id];
          if (row !== undefined) map[id] = row.displayTitle || row.title || '';
        }
        return map;
      }, [ids, byId]);

      const selectedIds = useMemo(
        () => Array.from(selected).filter((id) => filteredIds.has(id) && byId[id]?.running !== true),
        [selected, filteredIds, byId],
      );
      const selectedArchived = selectedIds.filter((id) => archivedSet.has(id));
      const selectedActive = selectedIds.filter((id) => !archivedSet.has(id));

      const backupSelected = async () => {
        try {
          const outcome = await downloadBackup([...selectedIds]);
          setNotice(t('backupExported', { n: outcome.count }));
        } catch (failure) {
          setNotice(t('backupDownloadFailed', { message: failure !== null && failure !== undefined && failure.message ? failure.message : String(failure) }));
        }
      };


      const totalCount = ids.filter((id) => byId[id] && !byId[id].blank && !orphans.has(id)).length;
      const archivedCount = ids.filter((id) => archivedSet.has(id) && !orphans.has(id)).length;
      const loading =
        (workspaces.length === 0 && workspaceState.phase !== 'ready') || (ids.length === 0 && sessionState.phase !== 'ready');

      return h(
        'section',
        { className: 'wsc-page', 'aria-label': t('title'), 'data-testid': 'session-cleanup-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'wsc-scroll' },
          h(
            'div',
            { className: 'wsc-content' },
            h(
              'div',
              { className: 'wsc-head' },
              h('div', null, h('h1', null, t('title')), h('p', { className: 'wsc-sub' }, t('subtitle'))),
              h(
                'div',
                { className: 'wsc-stats' },
                h('div', null, h('b', null, String(totalCount)), ' ', t('totalSessions')),
                h('div', null, h('b', null, String(archivedCount)), ' ', t('archivedSessions')),
              ),
            ),
            h(
              'div',
              { className: 'wsc-toolbar' },
              h(
                'label',
                { className: 'wsc-search' },
                h(SearchIcon),
                h('input', {
                  type: 'search',
                  value: search,
                  placeholder: t('searchPlaceholder'),
                  'aria-label': t('searchPlaceholder'),
                  onChange: (event) => setSearch(event.target.value),
                }),
              ),
              h(
                'select',
                { className: 'wsc-select', value: scope, 'aria-label': t('allWorkspaces'), onChange: (event) => setScope(event.target.value) },
                h('option', { value: 'all' }, t('allWorkspaces')),
                groups.map((group) =>
                  h('option', { key: group.key || '__ungrouped', value: group.key }, group.title + ' (' + group.sessions.length + ')'),
                ),
              ),
              h(
                'label',
                { className: 'wsc-toggle' },
                h('input', { type: 'checkbox', checked: showArchived, onChange: (event) => setShowArchived(event.target.checked) }),
                t('showArchived'),
              ),
              h('button', { type: 'button', className: 'wsc-btn', onClick: () => setBackupOpen(true) }, t('backup')),
              h('button', { type: 'button', className: 'wsc-btn wsc-btn-refresh', disabled: refreshing, onClick: () => void refreshAll() }, refreshing ? t('refreshing') : t('refresh')),
              h('button', { type: 'button', className: 'wsc-btn', onClick: () => setTrashOpen(true) }, t('trashOpen')),
              h('span', { className: 'wsc-spacer' }),
            ),
            visible.length === 0
              ? h('p', { className: 'wsc-empty' }, loading ? t('loading') : groups.length === 0 ? t('empty') : t('noMatches'))
              : visible.map((group) => {
                  const open = !collapsed.has(group.key);
                  const groupIds = group.ids.filter((id) => byId[id]?.running !== true);
                  const groupAll = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
                  return h(
                    'div',
                    { className: 'wsc-group', key: group.key || '__ungrouped' },
                    h(
                      'div',
                      { className: 'wsc-group-head' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'wsc-caret' + (open ? ' wsc-caret-open' : ''),
                          'aria-label': open ? t('collapse') : t('expand'),
                          'aria-expanded': open,
                          onClick: () => toggleGroupCollapse(group.key),
                        },
                        h(CaretIcon),
                      ),
                      h('span', { className: 'wsc-group-title' }, group.title),
                      group.path ? h('span', { className: 'wsc-group-path', title: group.path }, group.path) : null,
                      h('span', { className: 'wsc-group-count' }, t('groupCount', { n: group.count })),
                      h('button', { type: 'button', className: 'wsc-link', onClick: () => setMany(groupIds, !groupAll) }, groupAll ? t('clearGroup') : t('selectGroup')),
                    ),
                    open
                      ? group.rows.map(({ row, depth, childCount }) => {
                          const retained = row.retainedBy !== undefined && row.retainedBy !== null && Object.values(row.retainedBy).some((count) => (count ?? 0) > 0);
                          return h(SessionRow, {
                            key: row.id,
                            row,
                            depth,
                            childCount,
                            expanded: expanded.has(row.id),
                            archived: archivedSet.has(row.id),
                            pinned: pinnedSet.has(row.id),
                            selected: selected.has(row.id),
                            running: row.running === true,
                            open: retained,
                            t,
                            onToggleSelection: toggleSession,
                            onToggleExpand: toggleExpanded,
                            onArchive: (id) => requestArchive([id]),
                            onRestore: (id) => restoreIds([id]),
                            onView: (id) => setTranscriptId(id),
                            onBackup: (id) => void backupSingle(id),
                            onDelete: (id) => requestDeleteRow(id),
                          });
                        })
                      : null,
                  );
                }),
          ),
        ),
        h(
          'div',
          { className: 'wsc-footer' },
          h(
            'div',
            { className: 'wsc-footer-inner' },
            h('span', { className: 'wsc-footer-info' }, selectedIds.length > 0 ? t('selectedSummary', { n: selectedIds.length }) : t('noSelection')),
            selectedIds.length > 0 && !allSelected
              ? h('button', { type: 'button', className: 'wsc-btn', onClick: toggleAllVisible }, t('selectAll'))
              : null,
            selectedIds.length > 0
              ? h('button', { type: 'button', className: 'wsc-btn', onClick: () => setSelected(new Set()) }, t('clearAll'))
              : null,
            selectedIds.length > 0
              ? h('button', { type: 'button', className: 'wsc-btn', onClick: () => void backupSelected() }, t('backupSelected', { n: selectedIds.length }))
              : null,
            selectedArchived.length > 0
              ? h(
                  'button',
                  { type: 'button', className: 'wsc-btn', disabled: restoring, onClick: () => restoreIds(selectedArchived) },
                  t('restoreSelected', { n: selectedArchived.length }),
                )
              : null,
            selectedActive.length > 0
              ? h(
                  'button',
                  { type: 'button', className: 'wsc-btn', onClick: () => requestArchive(selectedActive) },
                  t('archiveSelected', { n: selectedActive.length }),
                )
              : null,
            selectedIds.length > 0
              ? h(
                  'button',
                  { type: 'button', className: 'wsc-btn wsc-btn-danger', onClick: () => setPurgeIds(selectedIds) },
                  t('purgeSelected', { n: selectedIds.length }),
                )
              : null,
          ),
        ),
        notice !== null ? h('div', { className: 'wsc-notice', role: 'status', 'aria-live': 'polite' }, notice) : null,
        transcriptId !== null ? h(TranscriptDialog, { id: transcriptId, t, onClose: () => setTranscriptId(null) }) : null,
        backupOpen
          ? h(BackupDialog, {
              t,
              onClose: () => setBackupOpen(false),
              onImported: () => {
                void refreshAll();
              },
            })
          : null,
        trashOpen
          ? h(TrashDialog, {
              t,
              onClose: () => setTrashOpen(false),
              onChanged: () => {
                void refreshAll();
              },
            })
          : null,
        archiveRequest !== null
          ? h(ArchiveDialog, {
              request: archiveRequest,
              t,
              archiveSession,
              onSettled: (ok, failedIds) => settleArchive(archiveRequest, ok, failedIds),
              onClose: () => setArchiveRequest(null),
            })
          : null,
        purgeIds !== null
          ? h(PurgeDialog, {
              ids: purgeIds,
              labels,
              t,
              onClose: () => setPurgeIds(null),
              onFinished: settlePurge,
            })
          : null,
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-cleanup: dictionaries');
      const t = ctx.locale.bind(NS);
      const archiveSession = (id, options) => ctx.uiWorkspace.archiveSession(id, options);
      const unarchiveSession = (id) => ctx.uiWorkspace.unarchiveSession(id);
      const refreshSessions = () => ctx.sessions.refresh();

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ archiveSession, unarchiveSession, refreshSessions }),
          },
          SessionCleanupPage,
        ),
      );

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'session-cleanup.purge', locale: NS, inject: () => ({ refreshSessions }) },
          PurgeOverlayHost,
        ),
      );

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'session-cleanup.delete', order: 500, locale: NS },
          DeleteSessionMenuItem,
        ),
      );

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            locale: NS,
            label: () => t('panel'),
          },
          CleanupIcon,
        ),
      );
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'sessions'],
      apply,
    };
  },
});

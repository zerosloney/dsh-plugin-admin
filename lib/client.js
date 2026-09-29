window.__ModuleLoader__.load({ id: 'dsh-plugin-admin', factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  loadPanels: () => loadPanels
});
module.exports = __toCommonJS(index_exports);

// src/client/impl.js
var import_react = __toESM(require("react"), 1);

// src/client/i18n.js
var I18N_LANG = (function() {
  try {
    var saved = window.localStorage && window.localStorage.getItem("dsh-admin-lang");
    if (saved === "en" || saved === "zh") return saved;
  } catch (e) {
  }
  return /^en\b/i.test(String(typeof navigator !== "undefined" && navigator.language || "")) ? "en" : "zh";
})();
var I18N_EN = {
  "\uFF08\u65E0\u5DE5\u4F5C\u76EE\u5F55\uFF09": "(no working directory)",
  // Separators and brackets used to be bare literals at their call sites, so the
  // English UI leaked Chinese punctuation ("3 个失败：…，2 个不兼容"). They are
  // dictionary keys now, which is also what verify-i18n can see.
  "\uFF0C": ", ",
  "\u3001": ", ",
  "\uFF08": " (",
  "\u91CD\u8BD5": "Retry",
  "\u5DF2\u5B58\u7684 header \u53EA\u56DE\u952E\u540D\uFF08\u503C\u4E0D\u56DE\u4F20\u6D4F\u89C8\u5668\uFF09\uFF1A\u7559\u7A7A\u5373\u6CBF\u7528\u5DF2\u5B58\u7684\u503C\uFF0C\u5220\u6389\u6574\u884C\u624D\u4F1A\u79FB\u9664\u8BE5\u952E\u3002": "Stored headers come back as key names only (values never cross to the browser): leave a value empty to keep the stored one, and delete the whole line to remove the key.",
  "\u5DF2\u5B58\u7684\u73AF\u5883\u53D8\u91CF\u53EA\u56DE\u952E\u540D\uFF08\u503C\u4E0D\u56DE\u4F20\u6D4F\u89C8\u5668\uFF09\uFF1A\u7559\u7A7A\u5373\u6CBF\u7528\u5DF2\u5B58\u7684\u503C\uFF0C\u5220\u6389\u6574\u884C\u624D\u4F1A\u79FB\u9664\u8BE5\u53D8\u91CF\u3002": "Stored environment variables come back as key names only (values never cross to the browser): leave a value empty to keep the stored one, and delete the whole line to remove the variable.",
  "\u{1F4CB} \u4F1A\u8BDD ID \u5DF2\u590D\u5236": "\u{1F4CB} Session ID copied",
  "\u274C \u590D\u5236\u5931\u8D25\uFF1A": "\u274C Copy failed: ",
  "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u6587\u4EF6\u4E0B\u8F7D": "File download is not supported in this environment",
  "\u6280\u80FD": "Skills",
  "MCP\u670D\u52A1\u5668": "MCP Servers",
  "\u5B50\u667A\u80FD\u4F53": "Subagents",
  "\u7528\u91CF\u4EEA\u8868\u76D8": "Usage Dashboard",
  "\u81EA\u52A8\u5316": "Automation",
  "Webhook": "Webhook",
  "\u5B9A\u65F6\u4EFB\u52A1": "Scheduled Tasks",
  "Webhook \u89E6\u53D1": "Webhook Triggers",
  "Web \u4E0E\u4F1A\u8BDD": "Web & Sessions",
  "Web \u641C\u7D22": "Web Search",
  "\u274C \u65E0\u6CD5\u52A0\u8F7D\u4F1A\u8BDD\u5217\u8868": "\u274C Failed to load the session list",
  "\u274C \u672A\u627E\u5230\u5339\u914D\u7684\u4F1A\u8BDD": "\u274C No matching session found",
  "\u274C \u5B58\u5728 ": "\u274C Found ",
  " \u4E2A\u540C\u540D\u4F1A\u8BDD\uFF0C\u65E0\u6CD5\u786E\u5B9A\u8981\u5220\u9664\u7684\u76EE\u6807\uFF1B\u8BF7\u5728 \u8BBE\u7F6E \u2192 \u5386\u53F2\u4F1A\u8BDD \u4E2D\u6309\u4F1A\u8BDD ID \u5220\u9664": " sessions with the same name \u2014 target is ambiguous; delete by session ID under Settings \u2192 Session history",
  "\u590D\u5236\u4F1A\u8BDD ID": "Copy session ID",
  "\u5220\u9664\u4F1A\u8BDD": "Delete session",
  "\u{1F5D1}\uFE0F \u4F1A\u8BDD\u5DF2\u5220\u9664": "\u{1F5D1}\uFE0F Session deleted",
  "\u274C \u5220\u9664\u4F1A\u8BDD\u5931\u8D25\uFF1A": "\u274C Failed to delete the session: ",
  "\u26A0\uFE0F \u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u5220\u9664\uFF08\u5728\u7EBF\u4F1A\u8BDD\u5C06\u5148\u5173\u505C\uFF09": "\u26A0\uFE0F Click again to confirm deletion (live sessions are closed first)",
  "\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u6253\u5F00": "Open in file manager",
  "\u274C \u6253\u5F00\u5931\u8D25\uFF1A\u672A\u627E\u5230\u5DE5\u4F5C\u533A\u8DEF\u5F84": "\u274C Open failed: no workspace path found",
  "\u274C \u6253\u5F00\u5931\u8D25\uFF1A": "\u274C Open failed: ",
  "\u274C \u6253\u5F00\u5931\u8D25\uFF1A\u65E0\u6CD5\u52A0\u8F7D\u5DE5\u4F5C\u533A\u5217\u8868": "\u274C Open failed: could not load the workspace list",
  "\u52A0\u8F7D\u63D2\u4EF6\u5931\u8D25\uFF1A": "Failed to load plugins: ",
  "\u8C03\u7528\u5931\u8D25\uFF1A": "Call failed: ",
  "\u68C0\u67E5\u66F4\u65B0\u5931\u8D25\uFF1A": "Update check failed: ",
  "\u68C0\u67E5\u66F4\u65B0\u8C03\u7528\u5931\u8D25\uFF1A": "Update-check call failed: ",
  "\u2705 \u6279\u91CF\u66F4\u65B0\u5B8C\u6210\uFF1A": "\u2705 Bulk update finished: ",
  " \u4E2A\u5DF2\u66F4\u65B0": " updated",
  " \u4E2A\u5931\u8D25\uFF1A": " failed: ",
  "\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548": ". Changes take effect after dsh restarts",
  "\u5DF2\u66F4\u65B0 ": "Updated ",
  "\u66F4\u65B0\u5931\u8D25\uFF1A": "Update failed: ",
  "\u5B89\u88C5\u5B8C\u6210\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548": "Installed. Changes take effect after dsh restarts",
  "dsh \u517C\u5BB9\u6027\uFF1A": "dsh compatibility: ",
  " \u4E0E\u5F53\u524D dsh ": " is incompatible with the running dsh ",
  " \u4E0D\u517C\u5BB9\uFF1A": ": ",
  "\uFF1B": "; ",
  "\u5BBF\u4E3B\u91CD\u542F\u65F6\u5C06\u8DF3\u8FC7\u52A0\u8F7D\u3002": "The host will skip loading it at the next start. ",
  "\u5982\u9700\u5F3A\u884C\u63A5\u53D7\uFF1A": "To accept explicitly: ",
  " \u4E2A\u4E0E\u5F53\u524D dsh \u4E0D\u517C\u5BB9\uFF08\u91CD\u542F\u5C06\u88AB\u8DF3\u8FC7\uFF09": " updated but incompatible with the running dsh (they will be skipped at the next start)",
  "\u5B89\u88C5\u5931\u8D25\uFF1A": "Install failed: ",
  "\u5378\u8F7D\u5B8C\u6210\u3002\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548": "Uninstalled. Changes take effect after dsh restarts",
  "\u5378\u8F7D\u5931\u8D25\uFF1A": "Uninstall failed: ",
  "\u8BE5\u63D2\u4EF6\u5DF2\u5904\u4E8E\u505C\u7528\u72B6\u6001": "This plugin is already disabled",
  "\u8BE5\u63D2\u4EF6\u5DF2\u5904\u4E8E\u542F\u7528\u72B6\u6001": "This plugin is already enabled",
  "\u5DF2\u5199\u5165 ": "Wrote ",
  " \u884C\u505C\u7528\u6807\u8BB0 \u2014 \u91CD\u542F dsh \u540E\u8BE5\u63D2\u4EF6\u4E0D\u518D\u6302\u8F7D\uFF1B\u70B9\u300C\u542F\u7528\u300D\u53EF\u6062\u590D": " disable marker(s) \u2014 the plugin will no longer mount after dsh restarts; click Enable to revert",
  "\u5DF2\u79FB\u9664\u505C\u7528\u6807\u8BB0 \u2014 \u91CD\u542F dsh \u540E\u63D2\u4EF6\u6062\u590D\u6302\u8F7D": "Disable markers removed \u2014 the plugin mounts again after dsh restarts",
  "\u505C\u7528": "Disable",
  "\u542F\u7528": "Enable",
  "\u5931\u8D25\uFF1A": "failed: ",
  "\u672A\u547D\u540D": "Untitled",
  "\u6279\u91CF\u5220\u9664\u5B8C\u6210\uFF0C": "Bulk deletion finished; ",
  " \u4E2A\u4F1A\u8BDD\u5220\u9664\u5931\u8D25\uFF08\u8BE6\u89C1\u4EA4\u4ED8\u5386\u53F2/\u5BBF\u4E3B\u65E5\u5FD7\uFF09": " session(s) failed to delete (see delivery history / host logs)",
  "\u52A0\u8F7D\u4F1A\u8BDD\u5931\u8D25\uFF1A": "Failed to load sessions: ",
  "\u64CD\u4F5C\u5931\u8D25\uFF1A": "Operation failed: ",
  "\u5168\u6587\u68C0\u7D22\u5931\u8D25\uFF1A": "Full-text search failed: ",
  "\u542F\u7528\u5168\u6587\u68C0\u7D22\u5931\u8D25\uFF1A": "Failed to enable full-text search: ",
  "\u26A0\uFE0F \u5DF2\u5BFC\u51FA\uFF08\u4F1A\u8BDD\u4E8B\u4EF6\u8D85\u51FA\u4E0A\u9650\uFF0C\u6587\u4EF6\u5DF2\u622A\u65AD\uFF09": "\u26A0\uFE0F Exported (session events exceeded the cap; file truncated)",
  "\u2705 \u5DF2\u5BFC\u51FA ": "\u2705 Exported ",
  " \u6761\u6D88\u606F": " message(s)",
  "\u274C \u5BFC\u51FA\u5931\u8D25\uFF1A": "\u274C Export failed: ",
  "\u53D1\u73B0 ": "Found ",
  " \u4E2A\u63D2\u4EF6\u6709\u65B0\u7248\u672C": " plugin(s) with new versions",
  "\u5DF2\u68C0\u67E5 ": "Checked ",
  " \u4E2A\u63D2\u4EF6\uFF08": " plugin(s) (",
  " \u4E2A\u67E5\u8BE2\u5931\u8D25\uFF09": " lookup(s) failed)",
  "\uFF0C\u5176\u4F59\u5747\u4E3A\u6700\u65B0\u7248\u672C": "; the rest are up to date",
  " \u4E2A\u63D2\u4EF6\uFF0C\u5747\u4E3A\u6700\u65B0\u7248\u672C": " plugin(s); all up to date",
  " \u6B63\u5728\u6267\u884C\u5DE5\u5177\uFF08\u6700\u957F 60 \u79D2\uFF09\u2026": " is running a tool (up to 60s)\u2026",
  "\u6CA1\u6709\u8FD4\u56DE\u7ED3\u679C": "No result returned",
  "\u26A0\uFE0F \u5DE5\u5177\u62A5\u544A\u9519\u8BEF": "\u26A0\uFE0F The tool reported an error",
  "\u2705 \u6267\u884C\u6210\u529F": "\u2705 Succeeded",
  "\uFF08\u7ED3\u679C\u8FC7\u957F\u5DF2\u622A\u65AD\uFF09": "(result truncated \u2014 too long)",
  "\uFF08\u7A7A\u7ED3\u679C\uFF09": "(empty result)",
  "\u{1F9EA} \u5DE5\u5177\u8BD5\u8C03\u7528 \xB7 ": "\u{1F9EA} Tool Playground \xB7 ",
  "\u5173\u95ED": "Close",
  "\u5148\u5BF9\u8BE5\u670D\u52A1\u5668\u8DD1\u4E00\u6B21\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u4EE5\u83B7\u53D6\u5DE5\u5177\u5217\u8868\u3002": "Run \u{1F50C} Test on this server first to fetch its tool list.",
  "\u5DE5\u5177\u53C2\u6570\uFF08JSON \u5BF9\u8C61\uFF0C\u952E\u540D\u4EE5\u8BE5\u5DE5\u5177\u7684 inputSchema \u4E3A\u51C6\uFF09": "Tool arguments (JSON object; keys follow the tool's inputSchema)",
  "\u5FC5\u586B\u53C2\u6570: ": "Required: ",
  ' \u2014\u2014 \u4F8B\u5982 { "': ' \u2014 e.g. { "',
  "\u26A0\uFE0F \u8BD5\u8C03\u7528\u4F1A\u771F\u5B9E\u6267\u884C\u8BE5\u5DE5\u5177\uFF08\u53EF\u80FD\u5199\u6587\u4EF6\u3001\u53D1\u8BF7\u6C42\uFF09\uFF0C\u8BF7\u786E\u8BA4\u53C2\u6570\u540E\u518D\u6267\u884C\u3002": "\u26A0\uFE0F The playground REALLY executes this tool (it may write files, send requests) \u2014 double-check the arguments before running.",
  "\u53C2\u6570\u4E0D\u662F\u5408\u6CD5 JSON\uFF1A": "Arguments are not valid JSON: ",
  "\u53C2\u6570\u5FC5\u987B\u662F JSON \u5BF9\u8C61\uFF08\u952E\u503C\u5BF9\uFF09": "Arguments must be a JSON object (key/value pairs)",
  "\u6267\u884C\u4E2D\u2026": "Running\u2026",
  "\u25B6 \u6267\u884C\u5DE5\u5177": "\u25B6 Run tool",
  "\u7ED3\u679C\u89C1\u4E0B\u65B9": "Result below",
  "\u8FD8\u6CA1\u6709\u5DE5\u5177\u5217\u8868 \u2014\u2014 \u5148\u70B9\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u83B7\u53D6\u8BE5\u670D\u52A1\u5668\u63D0\u4F9B\u7684\u5DE5\u5177\uFF0C\u518D\u8BD5\u8C03\u7528\u3002": "No tool list yet \u2014 run \u{1F50C} Test first to fetch this server's tools, then try the playground.",
  "\u52A0\u8F7D MCP \u914D\u7F6E\u5931\u8D25\uFF1A": "Failed to load MCP config: ",
  "\u8BE5 MCP \u914D\u7F6E\u65E0\u6CD5\u5B89\u5168\u89E3\u6790\uFF0C\u5DF2\u7981\u6B62\u5728\u6B64\u8986\u76D6\uFF1B\u8BF7\u5728 cordis.patch.yml \u4E2D\u624B\u52A8\u7F16\u8F91\u3002": "This MCP config cannot be parsed safely and is locked from editing here; edit cordis.patch.yml by hand.",
  "' \u5DF2\u88AB\u5176\u4ED6 MCP \u6761\u76EE\u5360\u7528\uFF0C\u8BF7\u6362\u4E00\u4E2A\u518D\u4FDD\u5B58\u3002": "' is already used by another MCP entry \u2014 pick another one before saving.",
  "\u2705 \u5DF2\u4FDD\u5B58\u5E76\u70ED\u5E94\u7528\u81F3\u8FD0\u884C\u4E2D\u7684 server\uFF08\u65E0\u9700\u91CD\u542F\uFF09": "\u2705 Saved and hot-applied to the running server (no restart needed)",
  "\u2705 \u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548 \u2014 ": "\u2705 Saved; takes effect after dsh restarts \u2014 ",
  "\u2705 \u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548": "\u2705 Saved; takes effect after dsh restarts",
  "\u4FDD\u5B58 MCP \u914D\u7F6E\u5931\u8D25\uFF1A": "Failed to save the MCP config: ",
  "\u79FB\u9664 MCP \u914D\u7F6E\u5931\u8D25\uFF1A": "Failed to remove the MCP config: ",
  "\u641C\u7D22\u63D2\u4EF6\uFF08\u540D\u79F0/\u7248\u672C/\u8DEF\u5F84\uFF09...": "Search plugins (name/version/path)...",
  "\u6E05\u7A7A\u641C\u7D22": "Clear search",
  "\u5B89\u88C5\u5305\u540D/\u8DEF\u5F84...": "Package name / path to install...",
  "\u5B89\u88C5": "Install",
  "\u5F3A\u5236\u7ED5\u8FC7 5 \u5206\u949F\u7F13\u5B58\uFF0C\u91CD\u65B0\u67E5\u8BE2 registry \u5E76\u5237\u65B0\u7F13\u5B58": "Bypass the 5-minute cache, re-query the registry and refresh it",
  "\u68C0\u67E5\u4E2D...": "Checking...",
  "\u2B06\uFE0F \u68C0\u67E5\u66F4\u65B0": "\u2B06\uFE0F Check updates",
  "\u4E32\u884C\u5347\u7EA7\u5168\u90E8\u6709\u65B0\u7248\u672C\u7684\u63D2\u4EF6\uFF08": "Upgrade every plugin with a new version, one by one (",
  " \u4E2A\uFF09\uFF0C\u5355\u4E2A\u5931\u8D25\u4E0D\u963B\u585E\u5176\u4F59": " in total); a single failure does not block the rest",
  "\u6CA1\u6709\u5F85\u66F4\u65B0\u7684\u63D2\u4EF6\uFF08\u5148\u300C\u68C0\u67E5\u66F4\u65B0\u300D\uFF09": "Nothing to update (run Check updates first)",
  "\u66F4\u65B0\u4E2D ": "Updating ",
  " \u5931\u8D25\uFF09": " failed)",
  "\u2B06\u2B06 \u5168\u90E8\u66F4\u65B0": "\u2B06\u2B06 Update all",
  "\u5168\u90E8 (": "All (",
  "\u6269\u5C55\u63D2\u4EF6 (": "Extensions (",
  "\u7CFB\u7EDF\u5185\u7F6E (": "Built-in (",
  "\u6B63\u5728\u6267\u884C pnpm \u64CD\u4F5C\uFF08\u53EF\u80FD\u9700\u8981\u6570\u79D2\u81F3\u6570\u5206\u949F\uFF0C\u8BF7\u52FF\u5173\u95ED\u7A97\u53E3\uFF09...": "Running pnpm (may take seconds to minutes; keep this window open)...",
  "\u6B63\u5728\u68C0\u67E5\u63D2\u4EF6\u7248\u672C\u66F4\u65B0\u2026": "Checking plugin versions\u2026",
  "\u2B06\uFE0F \u53D1\u73B0 ": "\u2B06\uFE0F Found ",
  " \u4E2A\u63D2\u4EF6\u6709\u65B0\u7248\u672C\uFF0C\u53EF\u70B9\u51FB\u5361\u7247\u4E0A\u7684\u300C\u66F4\u65B0\u300D\u5347\u7EA7": " plugin(s) with new versions \u2014 click Update on a card to upgrade",
  "\u26A0\uFE0F \u6709 ": "\u26A0\uFE0F ",
  " \u4E2A\u63D2\u4EF6\u67E5\u8BE2\u7248\u672C\u5931\u8D25\uFF08\u7F51\u7EDC\u6216 registry \u4E0D\u53EF\u8FBE\uFF09": " plugin(s) failed the version lookup (network or registry unreachable)",
  "\u2705 \u5DF2\u81EA\u52A8\u68C0\u67E5\u7248\u672C\u66F4\u65B0\uFF0C\u5168\u90E8\u4E3A\u6700\u65B0\u7248\u672C": "\u2705 Version check finished; everything is up to date",
  "\u{1F50D} \u65E0\u5339\u914D\u7684\u63D2\u4EF6\uFF08\u8BD5\u8BD5\u5176\u4ED6\u5173\u952E\u8BCD\uFF09": "\u{1F50D} No matching plugins (try other keywords)",
  "\u{1F4E6} \u6682\u65E0\u5339\u914D\u7684\u63D2\u4EF6\u5C42": "\u{1F4E6} No matching plugin layers",
  "\u66F4\u6539\u5728\u91CD\u542F dsh \u540E\u751F\u6548\uFF08\u5173\u95ED dsh \u8FDB\u7A0B\u540E\u91CD\u65B0\u8FD0\u884C\u5373\u53EF\uFF09": "Changes take effect after dsh restarts (quit the dsh process and run it again)",
  "pnpm \u8F93\u51FA\uFF1A\n": "pnpm output:\n",
  "Profile: \u9ED8\u8BA4": "Profile: default",
  "\u52A0\u8F7D\u4E2D\u2026": "Loading\u2026",
  "\u52A0\u8F7D\u9762\u677F\u2026": "Loading panel\u2026",
  "\u9762\u677F\u52A0\u8F7D\u5931\u8D25\uFF1A": "Panel failed to load: ",
  "\u{1F50C} MCP \u914D\u7F6E": "\u{1F50C} MCP config",
  " \u4E2A": " item(s)",
  "\u{1F504} \u5237\u65B0": "\u{1F504} Refresh",
  "\u2795 \u6DFB\u52A0\u670D\u52A1\u5668": "\u2795 Add server",
  " \u68C0\u6D4B\u4E2D...": " probing...",
  "\u2705 \u8FDE\u901A": "\u2705 Reachable",
  "\u274C \u4E0D\u901A": "\u274C Unreachable",
  " \u4E2A\u5DE5\u5177": " tool(s)",
  " \xB7 \u521D\u59CB\u5316\u6210\u529F\u4F46 ping \u5931\u8D25": " \xB7 initialized but ping failed",
  "\u8FDE\u63A5\u5931\u8D25": "Connection failed",
  "\u5DE5\u5177\uFF1A": "Tools: ",
  "\u4E0A\u6B21\u68C0\u6D4B\u7ED3\u679C\uFF08\u672C\u5730\u7F13\u5B58\uFF09\u3002\u70B9\u51FB\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u53EF\u91CD\u65B0\u68C0\u6D4B\u3002": "Last probe result (local cache). Click \u{1F50C} Test to probe again.",
  "\xB7 \u7F13\u5B58\u4E8E ": "\xB7 cached at ",
  "\u8BE5\u914D\u7F6E\u65E0\u6CD5\u5B89\u5168\u89E3\u6790\uFF0C\u8BF7\u624B\u52A8\u7F16\u8F91 cordis.patch.yml": "This config cannot be parsed safely \u2014 edit cordis.patch.yml by hand",
  "\u91CD\u65B0\u68C0\u6D4B\u8BE5\u670D\u52A1\u5668\u7684\u8FDE\u901A\u6027\uFF08\u5F53\u524D\u663E\u793A\u7684\u662F\u7F13\u5B58\u7ED3\u679C\uFF09": "Re-probe this server (what you see is a cached result)",
  "\u6D4B\u8BD5\u8BE5\u670D\u52A1\u5668\u7684\u8FDE\u901A\u6027": "Probe this server's connectivity",
  "\u68C0\u6D4B\u4E2D": "Probing",
  "\u{1F50C} \u6D4B\u8BD5": "\u{1F50C} Test",
  "\u8BD5\u8C03\u7528\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\uFF08\u4F1A\u771F\u5B9E\u6267\u884C\uFF0C\u5148\u300C\u{1F50C} \u6D4B\u8BD5\u300D\u83B7\u53D6\u5DE5\u5177\u5217\u8868\uFF09": "Try this server's tools (really executes \u2014 run \u{1F50C} Test first to fetch the tool list)",
  "\u{1F9EA} \u8BD5\u8C03\u7528": "\u{1F9EA} Playground",
  "\u7F16\u8F91": "Edit",
  "\u79FB\u9664": "Remove",
  "\u26A0\uFE0F \u786E\u5B9A\u4ECE cordis.patch.yml \u79FB\u9664\u8BE5 MCP \u670D\u52A1\u5668\u914D\u7F6E\uFF1F\u6574\u5757\u914D\u7F6E\uFF08\u542B headers \u4E2D\u7684\u5BC6\u94A5\u884C\uFF09\u4F1A\u88AB\u5220\u9664\u3002": "\u26A0\uFE0F Remove this MCP server from cordis.patch.yml? The whole block (including secret header lines) will be deleted.",
  "\u786E\u8BA4\u79FB\u9664": "Confirm removal",
  "\u53D6\u6D88": "Cancel",
  "\u{1F50C} \u6682\u65E0 MCP \u670D\u52A1\u5668\u914D\u7F6E": "\u{1F50C} No MCP servers configured",
  "\u6DFB\u52A0 MCP \u670D\u52A1\u5668": "Add MCP server",
  "\u7F16\u8F91 ": "Edit ",
  "ID\uFF08\u552F\u4E00\u6807\u8BC6\uFF0C[A-Za-z0-9_-]\uFF09": "ID (unique, [A-Za-z0-9_-])",
  "\u91CD\u65B0\u751F\u6210\u4E00\u4E2A\u968F\u673A ID": "Generate a random ID",
  "serverName\uFF08\u6A21\u578B\u547D\u540D\u7A7A\u95F4\uFF09": "serverName (model-facing namespace)",
  "\u4F20\u8F93\u65B9\u5F0F": "Transport",
  "stdio\uFF08\u5B50\u8FDB\u7A0B\uFF09": "stdio (subprocess)",
  "command\uFF08\u542F\u52A8\u547D\u4EE4\uFF09": "command (launch command)",
  "url\uFF08MCP \u7AEF\u70B9\uFF09": "url (MCP endpoint)",
  "headers\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u53EF\u9009\uFF09": "headers (one KEY=VALUE per line, optional)",
  "args\uFF08\u7A7A\u683C\u5206\u9694\uFF0C\u53EF\u9009\uFF09": "args (space-separated, optional)",
  "env\uFF08\u6BCF\u884C KEY=VALUE\uFF0C\u53EF\u9009\uFF09": "env (one KEY=VALUE per line, optional)",
  "\u542F\u7528\u81EA\u52A8\u91CD\u8FDE": "Enable auto-reconnect",
  "\u4FDD\u5B58\u4E2D...": "Saving...",
  "\u4FDD\u5B58": "Save",
  "\u672C\u5730\u5B89\u88C5": "Local install",
  "\u5305\u5B89\u88C5": "Package install",
  "\u5185\u7F6E": "Built-in",
  "profile patch \u4E2D\u5DF2\u5199\u5165\u8BE5\u63D2\u4EF6\u7684\u505C\u7528\u884C \u2014 \u91CD\u542F dsh \u540E\u4E0D\u518D\u6302\u8F7D\uFF1B\u70B9\u300C\u542F\u7528\u300D\u6062\u590D": "A disable row for this plugin exists in the profile patch \u2014 it will not mount after dsh restarts; click Enable to revert",
  "\u23F8 \u5DF2\u505C\u7528": "\u23F8 Disabled",
  "\u8FDC\u7A0B registry \u6709\u65B0\u7248\u672C\uFF1Av": "New version in the remote registry: v",
  "\uFF08\u5F53\u524D v": " (current v",
  "\uFF0C\u68C0\u6D4B\u4E8E ": ", checked at ",
  "\uFF0C\u66F4\u65B0\u540E\u63D0\u9192\u81EA\u52A8\u6D88\u9664": "; this notice clears itself after you update",
  "\u2B06 \u6709\u65B0\u7248\u672C v": "\u2B06 New version v",
  "\u26A0 \u66F4\u65B0\u68C0\u67E5\u5931\u8D25": "\u26A0 Update check failed",
  "\u79FB\u9664 profile patch \u4E2D\u7684\u505C\u7528\u884C\uFF08\u91CD\u542F dsh \u540E\u6062\u590D\u6302\u8F7D\uFF09": "Remove the disable row from the profile patch (mounts again after dsh restarts)",
  "\u5199\u5165\u505C\u7528\u884C\u5230 profile patch\uFF08\u4E0D\u5378\u8F7D\u3001\u4FDD\u7559\u914D\u7F6E\uFF1B\u91CD\u542F dsh \u540E\u4E0D\u518D\u6302\u8F7D\uFF09": "Write a disable row into the profile patch (keeps the config; the plugin stops mounting after dsh restarts)",
  "\u25B6 \u542F\u7528": "\u25B6 Enable",
  "\u23F8 \u505C\u7528": "\u23F8 Disable",
  "\u5347\u7EA7\u5230 v": "Upgrade to v",
  "\u2B06 \u66F4\u65B0": "\u2B06 Update",
  "\u5378\u8F7D": "Uninstall",
  "\u26A0\uFE0F \u786E\u5B9A\u8981\u5378\u8F7D\u8BE5\u63D2\u4EF6\u5417\uFF1F": "\u26A0\uFE0F Uninstall this plugin?",
  "\u786E\u8BA4\u5378\u8F7D": "Confirm uninstall",
  '\u4F1A\u8BDD\u5728\u7EBF\uFF1A\u4ECD\u6302\u8F7D\u4E8E dsh host \u5185\u5B58\uFF08\u672C\u8FDB\u7A0B\u5185\u521B\u5EFA\u6216\u6253\u5F00\u8FC7\u7684\u4F1A\u8BDD\u4FDD\u6301\u5728\u7EBF\uFF0C\u4E0D\u4EE3\u8868\u6B63\u5728\u8FD0\u884C\uFF09\uFF1B\u53EF\u76F4\u63A5"\u5173\u505C\u5E76\u5220\u9664"\uFF08\u4F1A\u4E2D\u65AD\u8BE5\u4F1A\u8BDD\u6B63\u5728\u8FDB\u884C\u7684\u5BF9\u8BDD\uFF09': `Live session: still mounted in the dsh host memory (sessions created or opened in this process stay live; this does not mean it is running). You can "Close & delete" directly (it interrupts the session's ongoing conversation)`,
  " \xB7 \u7F13\u5B58": " \xB7 cache",
  " \u5206\u949F": " min",
  " \u79D2": "s",
  "\u6BCF ": "Every ",
  "\u81EA\u52A8\u5FEB\u7167\u4F1A\u8BDD\u7528\u91CF\u5230\u53F0\u8D26": "auto-snapshot session usage into the ledger",
  "\uFF1B\u6700\u8FD1\u4E00\u6B21 ": "; last run ",
  "\u540E\u53F0\u81EA\u52A8\u5FEB\u7167\u5DF2\u5173\u95ED\uFF08config.usageSnapshotIntervalMs = 0\uFF09\u2014\u2014\u53EA\u6709\u6253\u5F00\u672C\u9875\u65F6\u624D\u4F1A\u8BB0\u5F55\u7528\u91CF": "Background auto-snapshot is OFF (config.usageSnapshotIntervalMs = 0) \u2014 usage is recorded only while this page is open",
  "\u{1F4CA} \u7528\u91CF\u4EEA\u8868\u76D8": "\u{1F4CA} Usage Dashboard",
  "VibeUsage \u59FF\u6001 \xB7 \u672C\u5730\u805A\u5408": "VibeUsage posture \xB7 locally aggregated",
  "\u81EA\u52A8\u5FEB\u7167": "Auto snapshot",
  "\u5DF2\u5173\u95ED": "Off",
  "\u91CD\u65B0\u7EDF\u8BA1": "Re-count",
  "\u21BB \u91CD\u65B0\u7EDF\u8BA1": "\u21BB Re-count",
  "\u4ECA\u5929": "Today",
  "\u5168\u90E8": "All",
  "\u5468\u65E5": "Sun",
  "\u5468\u4E00": "Mon",
  "\u5468\u4E8C": "Tue",
  "\u5468\u4E09": "Wed",
  "\u5468\u56DB": "Thu",
  "\u5468\u4E94": "Fri",
  "\u5468\u516D": "Sat",
  "\u{1F4A1} \u7F13\u5B58\u547D\u4E2D\u7387 ": "\u{1F4A1} Cache hit rate ",
  "% \u2014\u2014 \u957F\u4E0A\u4E0B\u6587\u590D\u7528\u826F\u597D\uFF0C\u91CD\u590D\u63D0\u793A\u6210\u672C\u88AB\u6709\u6548\u644A\u8584\u3002": "% \u2014 long-context reuse is healthy; repeated prompts cost less.",
  "\u{1F4A1} \u7F13\u5B58\u547D\u4E2D\u7387\u4EC5 ": "\u{1F4A1} Cache hit rate only ",
  "% \u2014\u2014 \u9AD8\u91CD\u590D\u957F\u4E0A\u4E0B\u6587\u5728\u6309\u5168\u4EF7\u8BA1\u8D39\uFF1B\u7A33\u5B9A\u7CFB\u7EDF\u63D0\u793A\u4E0E\u524D\u7F00\u53EF\u663E\u8457\u964D\u672C\u3002": "% \u2014 highly repetitive long contexts are billed at full price; stable system prompts and prefixes can cut costs a lot.",
  "\u{1F4A1} \u8F93\u51FA token \u662F\u8F93\u5165\u7684 ": "\u{1F4A1} Output tokens are ",
  " \u500D \u2014\u2014 \u751F\u6210\u91CF\u504F\u5927\uFF0C\u68C0\u67E5\u91CD\u590D\u91CD\u8BD5\u6216\u8D85\u957F\u56DE\u590D\u3002": "\xD7 the input \u2014 generation is heavy; check for duplicate retries or overly long replies.",
  "\u300D\u5360\u5168\u90E8\u7528\u91CF\u7684 ": '" accounts for ',
  "% \u2014\u2014 \u7528\u91CF\u9AD8\u5EA6\u96C6\u4E2D\u3002": "% of all usage \u2014 highly concentrated.",
  "\u{1F4A1} \u7528\u91CF\u6700\u9AD8\u7684\u4E00\u5929\u662F ": "\u{1F4A1} The busiest day was ",
  " \u5165 / ": " in / ",
  " \u51FA\uFF09\u3002": " out).",
  "\uFF1A\u8F93\u5165 ": ": input ",
  " \xB7 \u8F93\u51FA ": " \xB7 output ",
  " \xB7 \u7F13\u5B58 ": " \xB7 cache ",
  "\u70B9\uFF1A": " pts: ",
  "\u23F1 \u65E5\u671F": "\u23F1 Date",
  "\u7B5B\u9009": "Filter",
  "\u5168\u90E8\u9879\u76EE": "All projects",
  "\u6309\u9879\u76EE\u7B5B\u9009": "Filter by project",
  "\u603B Token": "Total tokens",
  "\u8F93\u5165 Token": "Input tokens",
  "\u8F93\u51FA Token": "Output tokens",
  "\u7F13\u5B58 Token": "Cache tokens",
  "\u4F1A\u8BDD\u6570": "Sessions",
  "\u7528\u6237\u6D88\u606F\u6570": "User messages",
  "\u52A9\u624B\u6D88\u606F\u6570": "Assistant messages",
  "\u6D3B\u8DC3\u5929\u6570": "Active days",
  "\u{1F4C8} \u6BCF\u65E5\u8D8B\u52BF": "\u{1F4C8} Daily trend",
  "\u8F93\u51FA": "Output",
  "\u8F93\u5165": "Input",
  "\u7F13\u5B58": "Cache",
  "\u8BE5\u65F6\u95F4\u8303\u56F4\u5185\u6CA1\u6709\u4F1A\u8BDD": "No sessions in this range",
  "\u{1F552} \u5206\u65F6\u6D3B\u8DC3": "\u{1F552} Hourly activity",
  "\u5C11 \u2592\u2592\u2592\u2592\u2592\u2592 \u591A": "less \u2592\u2592\u2592\u2592\u2592\u2592 more",
  "\u672A\u5206\u7EC4": "Ungrouped",
  "\u2705 \u5DF2\u5199\u5165 profile \u914D\u7F6E\uFF08\u6301\u4E45\u7D22\u5F15 + \u9996\u6B21\u641C\u7D22\u65F6\u6253\u5F00\uFF09\u2014 \u91CD\u542F dsh \u540E\u5168\u6587\u68C0\u7D22\u751F\u6548\u3002": "\u2705 Profile config written (durable index + opens on first search) \u2014 full-text search takes effect after dsh restarts.",
  "\u5168\u6587\u68C0\u7D22\u5728\u6B64\u90E8\u7F72\u4E2D\u9ED8\u8BA4\u5173\u95ED\uFF08\u5B98\u65B9 base \u914D\u7F6E openAt: never\uFF09\u3002\u4E00\u952E\u5199\u5165 profile \u8986\u76D6\u884C\uFF1A\u7D22\u5F15\u843D\u5728 $DSH_HOME \u4E0B\u3001\u9996\u6B21\u641C\u7D22\u65F6\u624D\u6253\u5F00\uFF0C\u4E0D\u62D6\u6162\u542F\u52A8\uFF1B\u5199\u5165\u540E\u9700\u91CD\u542F dsh\u3002": "Full-text search is OFF by default in this deployment (stock base config openAt: never). One click writes a profile override row: the index lives under $DSH_HOME and opens on first search, so startup stays fast; restart dsh after writing.",
  "\u26A1 \u4E00\u952E\u542F\u7528": "\u26A1 One-click enable",
  "\u68C0\u7D22\u6240\u6709\u4F1A\u8BDD\u7684\u6D88\u606F\u5185\u5BB9\u2026\uFF08\u5982\u300C\u5408\u5E76\u63D2\u4EF6\u300D\u6216\u67D0\u4E2A\u6587\u4EF6\u540D\uFF09": `Search every session's message content\u2026 (e.g. "merge plugin" or a file name)`,
  "\u641C\u7D22": "Search",
  "\u641C\u7D22\u4E2D\u2026": "Searching\u2026",
  "\u6CA1\u6709\u547D\u4E2D\u4EFB\u4F55\u4F1A\u8BDD\u3002": "No sessions matched.",
  "\u547D\u4E2D ": "Matched ",
  " \u4E2A\u4F1A\u8BDD": " session(s)",
  "\u672A\u547D\u540D\u4F1A\u8BDD": "Untitled session",
  "\u70B9\u51FB\u5C55\u5F00\u8BE5\u76EE\u5F55\u7684\u4F1A\u8BDD": "Click to expand this directory's sessions",
  "\u70B9\u51FB\u6298\u53E0\u8BE5\u76EE\u5F55\u7684\u4F1A\u8BDD": "Click to collapse this directory's sessions",
  "\u5DF2\u6298\u53E0": "Collapsed",
  "\u5220\u9664\u8BE5\u76EE\u5F55\u4E0B\u7684\u5168\u90E8 ": "Delete ALL ",
  " \u4E2A\u4F1A\u8BDD\uFF08\u5728\u7EBF\u4F1A\u8BDD\u4F1A\u5148\u5173\u505C\uFF09": " session(s) under this directory (live ones are closed first)",
  "\u{1F5D1} \u6574\u4E2A\u76EE\u5F55": "\u{1F5D1} Whole directory",
  "\u641C\u7D22\u6807\u9898\u3001\u5185\u5BB9\u6458\u8981\u3001\u76EE\u5F55\u6216 Session ID...": "Search title, summary, directory or session ID...",
  "\u641C\u7D22\u4F1A\u8BDD": "Search sessions",
  "\u8DE8\u5168\u90E8\u4F1A\u8BDD\u7684\u5168\u6587\u641C\u7D22\uFF08\u6309\u6D88\u606F\u5185\u5BB9\u68C0\u7D22\uFF09": "Full-text search across all sessions (by message content)",
  "\u{1F50E} \u5168\u6587\u641C\u7D22": "\u{1F50E} Full-text",
  "\u5168\u90E8(": "All(",
  "\u5728\u7EBF(": "Live(",
  "\u5DF2\u5F52\u6863(": "Archived(",
  "\u5DF2\u7ED3\u675F(": "Ended(",
  "\u53EA\u663E\u793A\u5DF2\u7F6E\u9876\u7684\u4F1A\u8BDD": "Show only pinned sessions",
  "\u5DF2\u7F6E\u9876(": "Pinned(",
  "\u5C55\u5F00\u5168\u90E8\u76EE\u5F55": "Expand all directories",
  "\u6298\u53E0\u5168\u90E8\u76EE\u5F55": "Collapse all directories",
  "\u25BE \u5168\u90E8\u5C55\u5F00": "\u25BE Expand all",
  "\u25B4 \u5168\u90E8\u6298\u53E0": "\u25B4 Collapse all",
  "\u5220\u9664\u5F53\u524D\u7B5B\u9009\u4E0B\u7684\u5168\u90E8 ": "Delete every session in the current filter",
  "\u{1F5D1} \u5220\u9664\u5F53\u524D (": "\u{1F5D1} Delete current (",
  "\u76EE\u5F55\u300C": 'Directory "',
  "\u5F53\u524D\u7B5B\u9009": "current filter",
  "\u5220\u9664\u4E2D ": "Deleting ",
  "\u786E\u8BA4\u5220\u9664 ": "Confirm deleting ",
  "\u7684 ": "'s ",
  " \u4E2A\u4F1A\u8BDD\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500": " session(s)? This cannot be undone",
  "\u8F93\u5165 ": "Input ",
  "\u8F93\u51FA ": "Output ",
  "\u7F13\u5B58\u8BFB ": "Cache read ",
  "\u{1F50D} \u65E0\u5339\u914D\u7684\u4F1A\u8BDD\u5185\u5BB9": "\u{1F50D} No matching session content",
  "\u{1F4AC} \u6CA1\u6709\u5DF2\u6301\u4E45\u5316\u7684\u4F1A\u8BDD": "\u{1F4AC} No persisted sessions",
  "\u52A0\u8F7D\u4E2D...": "Loading...",
  "\u5171 ": "Total ",
  " \u4E2A\u4F1A\u8BDD\uFF0C\u5F53\u524D\u5C55\u793A ": " session(s), showing ",
  "\u4F1A\u8BDD\u4FEE\u6539\u5373\u65F6\u540C\u6B65\u5230\u4FA7\u8FB9\u680F": "Session changes sync to the sidebar instantly",
  " \u6B63\u5728\u751F\u6210\u4F53\u68C0\u62A5\u544A\u2026": " is generating the health report\u2026",
  "\u4F53\u68C0\u5931\u8D25\uFF1A": "Health report failed: ",
  " \u4E2D\u65AD": " interrupted",
  " \u51FA\u9519": " errored",
  " \u6B21\u91CD\u8BD5": " retry(s)",
  " \u6B21\u538B\u7F29": " compaction(s)",
  "\u4F1A\u8BDD\u4F53\u68C0": "Session health",
  "\u4E3B\u8981\u9519\u8BEF\uFF1A": "Main error: ",
  "\u5DF2\u5F52\u6863": "Archived",
  "\u5DF2\u7ED3\u675F": "Ended",
  "\u53D6\u6D88\u7F6E\u9876": "Unpin",
  "\u7F6E\u9876\u8BE5\u4F1A\u8BDD\uFF08\u672C\u5730\u6536\u85CF\uFF0C\u968F\u65F6\u53EF\u5728\u300C\u{1F4CC} \u5DF2\u7F6E\u9876\u300D\u7B5B\u9009\u4E2D\u627E\u5230\uFF09": "Pin this session (a local favorite; find it anytime under the \u{1F4CC} Pinned filter)",
  "\u{1F4CC} \u5DF2\u7F6E\u9876": "\u{1F4CC} Pinned",
  "\u{1F4CC} \u7F6E\u9876": "\u{1F4CC} Pin",
  "\u5BFC\u51FA\u4E3A Markdown \u5BF9\u8BDD\u7A3F\uFF08.md \u4E0B\u8F7D\uFF09": "Export as a Markdown transcript (.md download)",
  "\u2B07 \u5BFC\u51FA": "\u2B07 Export",
  "\u4F1A\u8BDD\u4F53\u68C0\uFF1A\u5DE5\u5177\u8C03\u7528/\u9519\u8BEF/\u4E2D\u65AD/\u91CD\u8BD5\u7EDF\u8BA1": "Session health: tool calls / errors / interruptions / retries",
  "\u{1FA7A} \u4F53\u68C0": "\u{1FA7A} Health",
  "\u5F52\u6863": "Archive",
  "\u53D6\u6D88\u5F52\u6863": "Unarchive",
  "\u5220\u9664": "Delete",
  "\u5173\u505C\u8BE5\u5728\u7EBF\u4F1A\u8BDD\uFF08\u505C\u6B62\u5176 agent \u8FD0\u884C\uFF09\u5E76\u6C38\u4E45\u5220\u9664\u65E5\u5FD7\u8BB0\u5F55": "Close this live session (stops its agent) and permanently delete its logs",
  "\u5173\u505C\u5E76\u5220\u9664": "Close & delete",
  "\u4F1A\u8BDD\u5728\u7EBF": "Session live",
  "\u672C\u6B21\u4F1A\u8BDD token \u7528\u91CF\uFF08\u8F93\u5165 / \u8F93\u51FA / \u7F13\u5B58\u8BFB\uFF09\u2014\u2014\u6765\u81EA\u6A21\u578B\u9002\u914D\u5668\u4E0A\u62A5\u7684 usage \u6298\u53E0": "This session's token usage (input / output / cache read) \u2014 folded from usage reported by the model adapter",
  "\u5DF2\u7F6E\u9876": "Pinned",
  "\u6458\u8981\u8BFB\u53D6\u5931\u8D25\uFF1A": "Failed to read the summary: ",
  "\u65E0\u5DE5\u4F5C\u76EE\u5F55": "No working directory",
  "\u4F1A\u8BDD ID: ": "Session ID: ",
  "\u26A0\uFE0F \u5C06\u5173\u505C\u8BE5\u5728\u7EBF\u4F1A\u8BDD\uFF08\u6B63\u5728\u8FD0\u884C\u5219\u4F1A\u4E2D\u65AD\uFF09\u5E76\u6C38\u4E45\u5220\u9664\u8BB0\u5F55\u4E0E\u65E5\u5FD7\uFF0C\u786E\u5B9A\uFF1F": "\u26A0\uFE0F This will close the live session (interrupting it if running) and permanently delete its record and logs. Continue?",
  "\u26A0\uFE0F \u786E\u5B9A\u6C38\u4E45\u5220\u9664\u8BE5\u4F1A\u8BDD\u8BB0\u5F55\u53CA\u65E5\u5FD7\u6587\u4EF6\uFF1F": "\u26A0\uFE0F Permanently delete this session's record and log files?",
  "\u786E\u8BA4\uFF1F": "Confirm?",
  "\u63D0\u793A\u8BCD": "Prompt",
  "\u5DE5\u5177\u7EA6\u675F": "Tool filter",
  "\u6570\u503C\u6700\u5927\u59D4\u6258\u6DF1\u5EA6": "Numeric max delegation depth",
  "\u540E\u53F0\u6A21\u5F0F": "Background mode",
  "\u5B9E\u4F8B ID \u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u4E0B\u5212\u7EBF\u548C\u4E2D\u5212\u7EBF\uFF08\u5B57\u6BCD\u6216\u6570\u5B57\u5F00\u5934\uFF0C\u6700\u957F 64 \u4F4D\uFF09": "Instance ID may only contain letters, digits, underscores and dashes (starting with a letter or digit, up to 64 chars)",
  "\u5B50\u667A\u80FD\u4F53\u540D\u79F0\u5FC5\u987B\u662F 2-48 \u4F4D\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF\u4E14\u5B57\u6BCD\u5F00\u5934": "Subagent name must be 2-48 lowercase letters/digits/underscores and start with a letter",
  '\u5B50\u667A\u80FD\u4F53\u540D\u79F0 "': 'Subagent name "',
  '" \u662F\u4FDD\u7559\u540D\uFF08\u5185\u7F6E\u9884\u8BBE\u5DF2\u5360\u7528\uFF09': '" is reserved (taken by a built-in preset)',
  '" \u5DF2\u88AB\u5176\u4ED6\u5B9E\u4F8B\u4F7F\u7528': '" is already used by another instance',
  '\u672A\u77E5\u7684\u6267\u884C\u540E\u7AEF "': 'Unknown execution backend "',
  '\u540E\u7AEF "': 'Backend "',
  '" \u4E0D\u652F\u6301 persona\uFF08\u63D0\u793A\u8BCD\uFF09': '" does not support persona (prompt)',
  '" \u4E0D\u652F\u6301 toolFilter\uFF08\u5DE5\u5177\u7EA6\u675F\uFF09': '" does not support toolFilter',
  "\u6700\u5927\u59D4\u6258\u6DF1\u5EA6\u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570": "Max delegation depth must be a non-negative integer",
  '" \u65E0\u6CD5\u6267\u884C\u6570\u503C maxDepth\uFF1B\u8BF7\u52FE\u9009\u300C\u4EA4\u7531\u540E\u7AEF\u7BA1\u7406\u300D\u6216\u6362\u540E\u7AEF': '" cannot execute a numeric maxDepth; tick "backend-managed" or pick another backend',
  "maxTokens \u5FC5\u987B\u662F\u6B63\u6574\u6570": "maxTokens must be a positive integer",
  '\u5DE5\u5177 "': 'Tool "',
  '" \u662F\u4FDD\u7559\u540D\uFF08': '" is reserved (',
  "\uFF09\uFF0C\u4E0D\u80FD\u7528\u4E8E\u5DE5\u5177\u7EA6\u675F": ") and cannot be used in a tool filter",
  '" \u4E0D\u5728\u53EF\u9009\u6E05\u5355\u4E2D\uFF08\u6765\u81EA\u8FD0\u884C\u4E2D\u5DE5\u5177\u6216\u5185\u7F6E\u540D\u5F55\uFF09\uFF0C\u4FDD\u5B58\u4F1A\u88AB\u62D2\u7EDD': '" is not in the candidate list (from running tools or the built-in roster); saving will be rejected',
  "\u79FB\u9664 ": "Remove ",
  "\u56DE\u8F66\u6DFB\u52A0\uFF1A": "Press Enter to add: ",
  "\u65E0\u5339\u914D": "No match",
  "\u5237\u65B0": "Refresh",
  "\u26A0\uFE0F \u52A0\u8F7D\u5931\u8D25\uFF1A": "\u26A0\uFE0F Load failed: ",
  "\u4FDD\u5B58\u5931\u8D25\uFF1A": "Save failed: ",
  "\u5220\u9664\u5931\u8D25\uFF1A": "Delete failed: ",
  "\u5DF2\u6309\u300C": 'Adjusted or cleared per "',
  "\u300D\u7684\u80FD\u529B\u6E05\u9664\u6216\u8C03\u6574\uFF1A": '" capabilities: ',
  "\u641C\u7D22\u5B50\u667A\u80FD\u4F53\uFF08\u540D\u79F0/ID/\u540E\u7AEF/\u63D0\u793A\u8BCD/\u6A21\u578B\uFF09...": "Search subagents (name/ID/backend/prompt/model)...",
  "\uFF0B \u65B0\u5EFA\u5B50\u667A\u80FD\u4F53": "\uFF0B New subagent",
  "\u6267\u884C\u540E\u7AEF": "Execution backend",
  "\u6B63\u5728\u52A0\u8F7D\u5B50\u667A\u80FD\u4F53\u914D\u7F6E\u2026": "Loading subagent configs\u2026",
  "\u8FD8\u6CA1\u6709\u53D7\u7BA1\u5B50\u667A\u80FD\u4F53\u3002\u70B9\u51FB\u300C\uFF0B \u65B0\u5EFA\u5B50\u667A\u80FD\u4F53\u300D\u521B\u5EFA\u7B2C\u4E00\u4E2A\uFF1A\u540D\u79F0\u3001\u63D0\u793A\u8BCD\u3001\u5DE5\u5177\u7EA6\u675F\u3001\u6A21\u578B\u6307\u5B9A\u5168\u90E8\u53EF\u914D\u3002": "No managed subagents yet. Click \uFF0B New subagent to create the first one: name, prompt, tool filter and model are all configurable.",
  "\u6CA1\u6709\u5339\u914D\u5F53\u524D\u641C\u7D22/\u7B5B\u9009\u7684\u5B50\u667A\u80FD\u4F53\u3002": "No subagents match the current search/filters.",
  "\u6BCF\u5F20\u5361\u7247\u5BF9\u5E94 profile cordis.patch.yml \u4E2D\u4E00\u4E2A @deepseek-ai/dsh-tool-subagent \u884C\uFF1B\u4FDD\u5B58\u5373\u5199\u5165\u8BE5\u6587\u4EF6\uFF0C\u7531 Cordis HMR \u70ED\u52A0\u8F7D\u751F\u6548\uFF08\u65E0\u9700\u91CD\u542F\uFF09\uFF0C\u91CD\u542F dsh \u540E\u540C\u6837\u81EA\u52A8\u52A0\u8F7D\u3002\u9996\u6B21\u4FEE\u6539\u524D\u539F\u6587\u4EF6\u81EA\u52A8\u5907\u4EFD\u4E3A cordis.patch.yml.bak-subagent-admin\u3002": "Each card maps to one @deepseek-ai/dsh-tool-subagent row in the profile cordis.patch.yml; saving writes that file, hot-loaded by Cordis HMR (no restart), and it also loads automatically after a dsh restart. Before the first edit the original file is backed up as cordis.patch.yml.bak-subagent-admin.",
  "\u80FD\u529B\uFF1A": "Capabilities: ",
  "\u2713 \u63D0\u793A\u8BCD": "\u2713 Prompt",
  "\u2717 \u63D0\u793A\u8BCD": "\u2717 Prompt",
  "\u2713 \u5DE5\u5177\u7EA6\u675F": "\u2713 Tool filter",
  "\u2717 \u5DE5\u5177\u7EA6\u675F": "\u2717 Tool filter",
  "\u2713 \u6DF1\u5EA6\u4E0A\u9650": "\u2713 Depth cap",
  "\u2717 \u6DF1\u5EA6\u4E0A\u9650": "\u2717 Depth cap",
  "\u2713 \u53EF\u6301\u7EED\u4F1A\u8BDD": "\u2713 Continuable",
  "\u4EC5\u4E00\u6B21\u6027": "One-shot only",
  "\u270F\uFE0F \u7F16\u8F91\u5B50\u667A\u80FD\u4F53": "\u270F\uFE0F Edit subagent",
  "\u2728 \u65B0\u5EFA\u5B50\u667A\u80FD\u4F53": "\u2728 New subagent",
  "\u5B9E\u4F8B ID": "Instance ID",
  "\u5982 researcher\u3001code-reviewer": "e.g. researcher, code-reviewer",
  "\u8865\u4E01\u884C\u6807\u8BC6\uFF0C\u521B\u5EFA\u540E\u4E0D\u53EF\u6539\uFF1B\u6301\u4E45\u5316\u5728 profile \u7684 cordis.patch.yml": "Patch row identity; immutable after creation; persisted in the profile's cordis.patch.yml",
  "\u5B50\u667A\u80FD\u4F53\u540D\u79F0\uFF08\u6A21\u578B\u53EF\u89C1\u5DE5\u5177\u540D\uFF09": "Subagent name (model-visible tool name)",
  "\u5982 web_researcher\uFF08\u6A21\u578B\u7528\u5B83\u53D1\u8D77\u59D4\u6258\uFF09": "e.g. web_researcher (the model delegates through it)",
  "\u4E0D\u80FD\u7528\u4FDD\u7559\u540D subagent / subagent_fork / run_code\uFF0C\u4E14\u5404\u5B9E\u4F8B\u95F4\u552F\u4E00": "Cannot be the reserved names subagent / subagent_fork / run_code, and must be unique across instances",
  "\u6267\u884C\u540E\u7AEF\uFF08provider\uFF09": "Execution backend (provider)",
  "one-shot\uFF08\u4E00\u6B21\u6027\u4EFB\u52A1\uFF09": "one-shot (single-task)",
  "continuable\uFF08\u53EF\u6301\u7EED\u4F1A\u8BDD\uFF09": "continuable (resumable sessions)",
  "\u66B4\u9732 run_in_background \u53C2\u6570": "Exposes the run_in_background argument",
  "\u63D0\u793A\u8BCD\uFF08persona\uFF0C\u7559\u7A7A\u7EE7\u627F\u90E8\u7F72\u9ED8\u8BA4\uFF09": "Prompt (persona; leave empty to inherit the deployment default)",
  "\u8BE5\u5B50\u667A\u80FD\u4F53\u7684\u4EBA\u8BBE/\u804C\u8D23\u8BF4\u660E\u2026\u652F\u6301 {{model}} \u4E0E {{cwd}} \u6A21\u677F\u53D8\u91CF": "This subagent's persona/responsibilities\u2026 supports the {{model}} and {{cwd}} template variables",
  "\u5F53\u524D\u540E\u7AEF\u4E0D\u652F\u6301\u63D0\u793A\u8BCD\uFF1B\u5207\u6362\u540E\u7AEF\u65F6\u5DF2\u6709\u5185\u5BB9\u4F1A\u81EA\u52A8\u6E05\u9664": "The current backend does not support prompts; existing content is cleared automatically when you switch backends",
  "\u4FDD\u5B58\u540E\u5F71\u5B50\u8986\u76D6\uFF08shadow\uFF09\u90E8\u7F72\u7EA7 persona\uFF0C\u4EC5\u5BF9\u8BE5\u5B50\u667A\u80FD\u4F53\u751F\u6548": "After saving, shadows (overrides) the deployment-level persona for this subagent only",
  "\u6536\u8D77\u9AD8\u7EA7\u8BBE\u7F6E": "Hide advanced settings",
  "\u9AD8\u7EA7\u8BBE\u7F6E\uFF08\u5DE5\u5177\u3001\u6A21\u578B\u3001\u6DF1\u5EA6\u4E0E\u540E\u53F0\uFF09": "Advanced settings (tools, model, depth, background)",
  "\u5DE5\u5177\u7EA6\u675F\uFF08toolFilter\uFF0C\u7559\u7A7A\u5219\u4E0D\u9650\u5236\uFF1B\u53EF\u641C\u7D22\u548C\u624B\u52A8\u8F93\u5165\uFF0C\u4EC5\u5F53\u524D\u5019\u9009\u5DE5\u5177\u53EF\u4FDD\u5B58\uFF09": "Tool filter (toolFilter; empty = unrestricted; searchable and free-form, but only current candidate tools can be saved)",
  "\u4EC5\u5141\u8BB8\uFF08allow \u767D\u540D\u5355\uFF09": "Allow (whitelist)",
  "\u8F93\u5165\u6216\u9009\u62E9\u5DE5\u5177\u540D\uFF0C\u5982 read / glob / grep": "Type or pick a tool name, e.g. read / glob / grep",
  "\u4EC5\u5141\u8BB8\u5DE5\u5177": "Allowed tools",
  "\u8BBE\u7F6E\u540E\u5B50\u667A\u80FD\u4F53\u53EA\u4FDD\u7559\u540D\u5355\u5185\u5DE5\u5177\uFF0C\u5176\u4F59\u4ECE\u63D0\u793A\u8BCD\u79FB\u9664\u4E14\u62D2\u7EDD\u6267\u884C": "When set, the subagent keeps only the listed tools \u2014 the rest are removed from its prompt and refuse to run",
  "\u7981\u6B62\uFF08deny \u9ED1\u540D\u5355\uFF09": "Deny (blacklist)",
  "\u8F93\u5165\u6216\u9009\u62E9\u5DE5\u5177\u540D\uFF0C\u5982 bash / pwsh": "Type or pick a tool name, e.g. bash / pwsh",
  "\u7981\u6B62\u5DE5\u5177": "Denied tools",
  "\u5F53\u524D\u540E\u7AEF\u4E0D\u652F\u6301\u5DE5\u5177\u7EA6\u675F\uFF1B\u5207\u6362\u540E\u7AEF\u65F6\u5DF2\u6709\u7EA6\u675F\u4F1A\u81EA\u52A8\u6E05\u9664": "The current backend does not support tool filters; existing filters are cleared automatically when you switch backends",
  "\u540D\u5355\u5185\u5DE5\u5177\u5BF9\u5B50\u667A\u80FD\u4F53\u4E0D\u53EF\u89C1\uFF1B\u624B\u52A8\u8F93\u5165\u7684\u5DE5\u5177\u4E5F\u5FC5\u987B\u5728\u5F53\u524D\u5019\u9009\u6E05\u5355\u5185\u624D\u53EF\u4FDD\u5B58": "Listed tools are hidden from the subagent; hand-typed tools must also be in the current candidate list to save",
  "\u6A21\u578B\u6307\u5B9A\uFF08agentOptions\uFF0C\u7559\u7A7A\u5B57\u6BB5\u7EE7\u627F\u7236\u4EE3\u7406\u5F53\u524D\u8DEF\u7531\uFF09": "Model override (agentOptions; empty fields inherit the parent agent's current routing)",
  "\u7559\u7A7A\u7EE7\u627F\uFF0C\u5982 optirouter / deepseek-official": "Empty = inherit, e.g. optirouter / deepseek-official",
  "\u6A21\u578B\u6807\u8BC6\uFF08model\uFF09": "Model id (model)",
  "\u7559\u7A7A\u7EE7\u627F\uFF0C\u5982 auto": "Empty = inherit, e.g. auto",
  "\u6A21\u578B\u6807\u8BC6": "Model id",
  "\u4ECE\u5DF2\u914D\u7F6E\u6A21\u578B\u4E2D\u9009\u62E9\uFF0C\u6216\u624B\u586B\u6A21\u578B id\uFF08\u9700\u5728\u8BE5 provider \u8DEF\u7531\u4E0A\u6CE8\u518C\uFF09": "Pick a configured model, or type a model id (must be registered on that provider's routing)",
  "maxTokens\uFF08\u5355\u6B21\u56DE\u590D\u4E0A\u9650\uFF09": "maxTokens (per-reply cap)",
  "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4": "Empty = default",
  "\u6700\u5927\u59D4\u6258\u6DF1\u5EA6\uFF08maxDepth\uFF0C0 = \u7981\u6B62\u518D\u59D4\u6258\uFF09": "Max delegation depth (maxDepth, 0 = no further delegation)",
  "3\uFF08\u9ED8\u8BA4\uFF09": "3 (default)",
  "\u4EA4\u7531\u540E\u7AEF\u7BA1\u7406": "Backend-managed",
  "\u274C \u540E\u7AEF\u672A\u6CE8\u518C": "\u274C Backend not registered",
  "\u2705 \u5DF2\u6302\u8F7D": "\u2705 Mounted",
  "\u26A0\uFE0F \u5DE5\u5177\u672A\u6302\u8F7D": "\u26A0\uFE0F Tool not mounted",
  "\u7EE7\u627F\u7236\u4EE3\u7406": "Inherit from parent",
  "\u786E\u8BA4\u5220\u9664\uFF1F": "Confirm delete?",
  "\u53EF\u6301\u7EED": "Continuable",
  "\u4E00\u6B21\u6027": "One-shot",
  "\u6DF1\u5EA6\u2264": "depth\u2264",
  "\u6DF1\u5EA6=\u540E\u7AEF\u7BA1\u7406": "depth=backend",
  "\u4EC5\u5141\u8BB8": "allow",
  "\u7981\u6B62": "deny",
  "\u5DE5\u5177\u4E0D\u9650\u5236": "tools unrestricted",
  "\u6302\u8F7D": "Mount",
  "env\uFF08\u4F20\u7ED9 CLI \u5B50\u8FDB\u7A0B\u7684\u989D\u5916\u73AF\u5883\u53D8\u91CF\uFF09": "env (extra environment variables passed to the CLI subprocess)",
  "\u53D8\u91CF\u540D\uFF08\u5982 OPENAI_API_KEY\uFF09": "Variable name (e.g. OPENAI_API_KEY)",
  "\u53D8\u91CF\u503C": "Variable value",
  "\uFF0B \u6DFB\u52A0\u53D8\u91CF": "\uFF0B Add variable",
  "\u6536\u8D77\u660E\u7EC6": "Hide details",
  "\u5C55\u5F00\u660E\u7EC6": "Show details",
  "\u5DF2\u6302\u8F7D": "Mounted",
  "\u672A\u6302\u8F7D": "Not mounted",
  "provider \u5305": "provider package",
  "provider \u5305 \u2717": "provider package \u2717",
  "CLI \u4F9D\u8D56 \u2713": "CLI dependency \u2713",
  "CLI \u4F9D\u8D56 \u2717": "CLI dependency \u2717",
  "\u5DF2\u5B89\u88C5": "Installed",
  "npm install -g \u5168\u5C40\u5B89\u88C5\u7F3A\u5931\u5305\uFF1A": "npm install -g the missing package(s): ",
  "\u5B89\u88C5\u4E2D\u2026": "Installing\u2026",
  "\u5B89\u88C5\u4F9D\u8D56\u5305": "Install dependency packages",
  "\u4FDD\u5B58\u914D\u7F6E": "Save config",
  "\u786E\u8BA4\u5378\u8F7D\uFF1F": "Confirm uninstall?",
  "providerName\uFF08\u6267\u884C\u540E\u7AEF\u6CE8\u518C\u540D\uFF09": "providerName (execution backend registration name)",
  "\u5982 codex / claude-code\uFF08\u5B50\u667A\u80FD\u4F53\u8868\u5355\u7684\u6267\u884C\u540E\u7AEF\u9009\u9879\uFF09": "e.g. codex / claude-code (the execution-backend options in the subagent form)",
  "permissionMode\uFF08CLI \u6743\u9650\u6A21\u5F0F\uFF09": "permissionMode (CLI permission mode)",
  "\u679A\u4E3E\u6765\u81EA\u8BE5 provider \u5305\u7684 Config schema": "Enum comes from the provider package's Config schema",
  "disposeGraceMs\uFF08\u8FDB\u7A0B\u6811\u7EC8\u6B62\u5BBD\u9650\uFF0C\u6BEB\u79D2\uFF09": "disposeGraceMs (process-tree teardown grace, ms)",
  "\u540E\u7AEF\u5728\u7EBF \u2713": "Backend online \u2713",
  "\u540E\u7AEF\u672A\u6CE8\u518C": "Backend not registered",
  "command\uFF08PATH \u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF09": "command (a PATH command name or absolute path)",
  "\u5982 gemini / qwen / C:\\tools\\aider.exe": "e.g. gemini / qwen / C:\\tools\\aider.exe",
  "\u5982 cli-gemini\uFF08\u5B50\u667A\u80FD\u4F53\u8868\u5355\u7684\u6267\u884C\u540E\u7AEF\u9009\u9879\uFF09": "e.g. cli-gemini (the execution-backend option in the subagent form)",
  "args\uFF08\u7A7A\u683C\u5206\u9694\uFF0C{prompt} \u5360\u4F4D\u63D0\u793A\u8BCD\uFF09": "args (space-separated; {prompt} placeholder for the prompt)",
  "one-shot \u7EAF\u6587\u672C\uFF1Astdout \u5373\u59D4\u6258\u7ED3\u679C\uFF0C\u975E\u96F6\u9000\u51FA\u8BB0\u4E3A\u5931\u8D25\uFF1Bprompt \u7ECF {prompt} \u4F20\u5165": "one-shot plain text: stdout is the delegation result; a non-zero exit counts as failure; the prompt is passed via {prompt}",
  "command \u4E0D\u80FD\u5305\u542B\u7A7A\u683C\uFF08PATH \u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF09": "command must not contain spaces (a PATH command name or absolute path)",
  "args \u5FC5\u987B\u662F 1-20 \u4E2A\u975E\u7A7A\u7247\u6BB5\uFF08\u5355\u6761 \u2264 256 \u5B57\u7B26\uFF09\uFF0C\u7528 {prompt} \u5360\u4F4D\u63D0\u793A\u8BCD": "args must be 1-20 non-empty segments (each \u2264 256 chars), using {prompt} as the prompt placeholder",
  "args \u5FC5\u987B\u5305\u542B {prompt} \u5360\u4F4D\u7B26\uFF08\u63D0\u793A\u8BCD\u5C06\u66FF\u6362\u8BE5\u5360\u4F4D\u7B26\u4F20\u5165 CLI\uFF09": "args must contain the {prompt} placeholder (the prompt replaces it when invoking the CLI)",
  "providerName \u5FC5\u987B\u662F 1-48 \u4F4D\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u4E2D\u5212\u7EBF\u4E14\u5B57\u6BCD\u5F00\u5934": "providerName must be 1-48 lowercase letters/digits/underscores/dashes and start with a letter",
  "disposeGraceMs \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\uFF08\u6BEB\u79D2\uFF09": "disposeGraceMs must be a non-negative integer (ms)",
  "\u4F9D\u8D56\u5305\u5B89\u88C5\u5B8C\u6210": "Dependency packages installed",
  "\uFF0C\u5DF2\u91CD\u65B0\u68C0\u6D4B": ", re-probed",
  "\uFF08\u5BBF\u4E3B\u7AEF\u672A\u6CE8\u518C\u8BE5\u63A5\u53E3\uFF1A\u8BF7\u91CD\u542F dsh \u52A0\u8F7D\u6700\u65B0\u63D2\u4EF6\u540E\u91CD\u8BD5\uFF09": "(the host has not registered this interface: restart dsh to load the latest plugin and retry)",
  "\u6302\u8F7D\u5931\u8D25\uFF1A": "Mount failed: ",
  "\u{1F6F0}\uFE0F \u672C\u673A CLI": "\u{1F6F0}\uFE0F Local CLIs",
  "\u901A\u7528\u547D\u4EE4\u884C\u540E\u7AEF \xB7 one-shot \u7EAF\u6587\u672C": "Generic command-line backends \xB7 one-shot plain text",
  "\u91CD\u65B0\u68C0\u6D4B": "Re-probe",
  "\u68C0\u6D4B\u5E76\u6302\u8F7D harness \u5185\u7F6E\u7684\u5916\u90E8 CLI \u540E\u7AEF\uFF08codex / claude-code\uFF09\u4E0E\u672C\u673A\u5176\u4ED6\u547D\u4EE4\u884C\u5DE5\u5177\uFF1B\u6302\u8F7D\u540E\u5373\u53EF\u5728\u300C\u5B50\u667A\u80FD\u4F53\u300D\u8868\u5355\u7684\u6267\u884C\u540E\u7AEF\u4E0B\u62C9\u4E2D\u9009\u7528\u3002": "Detects and mounts the harness's built-in external CLI backends (codex / claude-code) plus other local command-line agent tools; once mounted they appear in the execution-backend dropdown of the Subagents form.",
  "\u6DFB\u52A0\u81EA\u5B9A\u4E49 CLI\uFF1A\u8F93\u5165\u547D\u4EE4\u540D\u6216\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u5982 aider\uFF08\u6302\u8F7D\u4E3A one-shot \u540E\u7AEF\uFF09": "Add a custom CLI: type a command name or absolute path, e.g. aider (mounted as a one-shot backend)",
  "\u672A\u68C0\u6D4B\u5230\u5176\u4ED6 agent CLI": "No other agent CLIs detected",
  "CLI \u540E\u7AEF": "CLI backends",
  "\u5B50\u667A\u80FD\u4F53\u7BA1\u7406": "Subagent management",
  "\u2713 \u5DF2\u91CD\u542F hooks \u6865\uFF0C\u914D\u7F6E\u5DF2\u751F\u6548\u3002": "\u2713 Hooks bridge restarted; the config is live.",
  "\u26A0 hooks \u6865\u70ED\u91CD\u542F\u5931\u8D25\uFF1A": "\u26A0 Hooks bridge hot-restart failed: ",
  "\uFF08\u914D\u7F6E\u5DF2\u5199\u5165\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548\uFF09": "(the config was written; it takes effect after dsh restarts)",
  "\u5DF2\u5199\u5165 hooks.json\u3002\u5F53\u524D\u672A\u6302\u8F7D hooks \u6865\uFF08hooks-claude-code\uFF09\uFF0C\u6302\u8F7D\u540E\u751F\u6548\u3002": "hooks.json written. The hooks bridge (hooks-claude-code) is not mounted yet; it takes effect once mounted.",
  "\u5DF2\u505C\u7528": "Disabled",
  "\u6CE8\u518C\u5931\u8D25": "Registration failed",
  "\u6587\u4EF6\u9519\u8BEF": "File error",
  "\u5220\u9664\u547D\u4EE4 /": "Delete command /",
  "\u53C2\u6570\u63D0\u793A\uFF1A": "Argument hint: ",
  "\u547D\u4EE4 /": "Command /",
  "\u540D\u79F0": "Name",
  "\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\uFF0C\u53EF\u542B\u6570\u5B57\u3001-\u3001_\u3002\u4F1A\u8BDD\u4E2D\u8F93\u5165 /\u540D\u79F0 \u8C03\u7528\u3002": "Starts with a lowercase letter; may contain digits, - and _. Invoke with /name in a session.",
  "\u53C2\u6570\u63D0\u793A\uFF08\u53EF\u9009\uFF09": "Argument hint (optional)",
  "\u4F8B\u5982 <file-path>": "e.g. <file-path>",
  "\u63CF\u8FF0": "Description",
  "\u8FD9\u4E2A\u547D\u4EE4\u505A\u4EC0\u4E48": "What this command does",
  "# \u89D2\u8272\n\n\u4F60\u8981\u2026\n\n\u5F53\u524D\u8BF7\u6C42\uFF1A$ARGUMENTS": "# Role\n\nYou are\u2026\n\nCurrent request: $ARGUMENTS",
  "\u53D1\u9001\u7ED9\u6A21\u578B\u7684\u63D0\u793A\u8BCD\u3002$ARGUMENTS \u4F1A\u66FF\u6362\u4E3A\u7528\u6237\u8F93\u5165\uFF1B\u672A\u4F7F\u7528\u5360\u4F4D\u7B26\u65F6\u8F93\u5165\u4F1A\u8FFD\u52A0\u5728\u672B\u5C3E\u3002": "The prompt sent to the model. $ARGUMENTS is replaced by the user's input; without the placeholder the input is appended at the end.",
  "\u63A5\u53D7\u56FE\u7247\u9644\u4EF6": "Accepts image attachments",
  "\u5DF2\u5BFC\u51FA ": "Exported ",
  " \u6761\u547D\u4EE4": " command(s)",
  "\u5BFC\u51FA\u5931\u8D25\uFF1A": "Export failed: ",
  "\u5BFC\u5165\u5931\u8D25\uFF1AJSON \u89E3\u6790\u9519\u8BEF \u2014 ": "Import failed: JSON parse error \u2014 ",
  "\u5BFC\u5165\u5B8C\u6210\uFF1A": "Import finished: ",
  " \u6761\u65B0\u589E": " added",
  " \u6761\u540C\u540D\u8DF3\u8FC7": " skipped (duplicate name)",
  " \u6761\u5931\u8D25": " failed",
  "\u63D0\u793A\u8BCD\u547D\u4EE4": "Prompt commands",
  "\u5237\u65B0\u547D\u4EE4\u5217\u8868": "Refresh the command list",
  "\u628A\u5168\u90E8\u547D\u4EE4\u4E0B\u8F7D\u4E3A\u4E00\u4E2A JSON \u6587\u4EF6\uFF08\u53EF\u5206\u4EAB\u3001\u53EF\u518D\u5BFC\u5165\uFF09": "Download every command as one JSON file (shareable, re-importable)",
  "\u2B06 \u5BFC\u5165": "\u2B06 Import",
  "\uFF0B\u65B0\u5EFA\u547D\u4EE4": "\uFF0BNew command",
  "\u5B58\u50A8\u4E8E ": "Stored at ",
  " \xB7 \u4FDD\u5B58\u540E\u7ACB\u5373\u751F\u6548\uFF08\u542B\u5728\u5176\u4ED6\u7A97\u53E3\u624B\u52A8\u6539\u6587\u4EF6\uFF09": " \xB7 effective immediately after saving (including manual file edits in other windows)",
  "\u2B06 \u5BFC\u5165\u547D\u4EE4\uFF08JSON \u6570\u7EC4\u6216\u5355\u6761\uFF09": "\u2B06 Import commands (a JSON array or a single entry)",
  '[{ "name": "review", "description": "\u4EE3\u7801\u5BA1\u67E5", "prompt": "\u8BF7\u5BA1\u67E5 $ARGUMENTS" }]': '[{ "name": "review", "description": "Code review", "prompt": "Please review $ARGUMENTS" }]',
  "\u5BFC\u5165\uFF08\u540C\u540D\u8DF3\u8FC7\uFF09": "Import (duplicate names skipped)",
  "\u517C\u5BB9\u300C\u2B07 \u5BFC\u51FA\u300D\u7684\u6587\u4EF6\u5185\u5BB9\uFF1B\u540C\u540D\u547D\u4EE4\u4E00\u5F8B\u8DF3\u8FC7\uFF0C\u7EDD\u4E0D\u9759\u9ED8\u8986\u76D6\u672C\u5730\u4FEE\u6539\u3002": "Accepts the file produced by \u2B07 Export; commands with duplicate names are always skipped \u2014 local edits are never silently overwritten.",
  " \u5DF2\u4FDD\u5B58\u5E76\u6CE8\u518C\u3002": " saved and registered.",
  "\u8FD8\u6CA1\u6709\u547D\u4EE4\u3002\u70B9\u51FB\u300C\uFF0B\u65B0\u5EFA\u547D\u4EE4\u300D\u521B\u5EFA\u4E00\u4E2A\uFF0C\u4F1A\u8BDD\u91CC\u8F93\u5165 /\u540D\u79F0 \u5373\u53EF\u628A\u63D0\u793A\u8BCD\u53D1\u7ED9\u6A21\u578B\u3002": "No commands yet. Click \uFF0BNew command to create one \u2014 then type /name in a session to send its prompt to the model.",
  " \u5DF2\u5220\u9664\u3002": " deleted.",
  " \u5DF2\u505C\u7528\u3002": " has been disabled.",
  " \u5DF2\u542F\u7528\u3002": " has been enabled.",
  "\uFF1B\u8B66\u544A\uFF1A": "; warning: ",
  " \u884C\u7F3A\u5C11\u300C=\u300D\u5DF2\u5FFD\u7565": ' line(s) missing "=" were ignored',
  "\u5DF2\u663E\u793A\u524D ": "Showing the first ",
  " \u4E2A\u4F1A\u8BDD\u2014\u2014\u7528\u8FC7\u6EE4\u6761\u4EF6\u7F29\u5C0F\u8303\u56F4\u67E5\u770B\u5176\u4F59": " sessions \u2014 narrow with the filter above to see the rest",
  " \u6761\u547D\u4E2D": " hit(s)",
  " \u4E2A\u6280\u80FD\u2014\u2014\u7528\u4E0A\u65B9\u8FC7\u6EE4\u6761\u4EF6\u67E5\u770B\u5176\u4F59": " skills \u2014 narrow with the filter above to see the rest",
  "\u5220\u9664\u94A9\u5B50 ": "Delete hook ",
  "\u5339\u914D\u5168\u90E8": "match all",
  "\u5339\u914D ": "match ",
  " \xB7 \u8D85\u65F6 ": " \xB7 timeout ",
  "\u94A9\u5B50 ": "Hook ",
  "\u4E8B\u4EF6": "Event",
  "\u8D85\u65F6\uFF08\u79D2\uFF09": "Timeout (s)",
  "\u7559\u7A7A\u6216 600 = \u6865\u9ED8\u8BA4\uFF0810 \u5206\u949F\uFF09\u3002": "Empty or 600 = the bridge default (10 minutes).",
  "\u5339\u914D\u5668": "Matcher",
  "\uFF08\u6B64\u4E8B\u4EF6\u5FFD\u7565\u5339\u914D\u5668\uFF09": "(this event ignores the matcher)",
  "write,edit \u6216\u6B63\u5219\uFF1B\u7559\u7A7A\u5339\u914D\u5168\u90E8": "write,edit or a regex; empty matches everything",
  "UserPromptSubmit / Stop \u6CA1\u6709\u5339\u914D\u5BF9\u8C61\uFF0C\u6865\u4F1A\u4E22\u5F03\u5339\u914D\u5668\u3002": "UserPromptSubmit / Stop have no match target; the bridge drops the matcher.",
  "\u4EC5 PreToolUse / PostToolUse \u6709\u5339\u914D\u5BF9\u8C61\uFF08\u5DE5\u5177\u540D\uFF0C\u5C0F\u5199\uFF0C\u5982 write / edit\uFF0C\u5927\u5C0F\u5199\u654F\u611F\uFF09\u3002": "Only PreToolUse / PostToolUse have a match target (tool name, lowercase, e.g. write / edit; case-sensitive).",
  "\u547D\u4EE4": "Command",
  "\u94A9\u5B50\u8F7D\u8377\u4EE5 JSON \u4ECE stdin \u4F20\u5165\uFF1B\u9000\u51FA\u7801 2 \u6216\u8F93\u51FA deny \u963B\u6B62\u52A8\u4F5C\u3002": "The hook payload arrives as JSON on stdin; exit code 2 or a deny output blocks the action.",
  "\u26A0\uFE0F \u6865\u6302\u8F7D\u884C\u7684 configPath \u6307\u5411 ": "\u26A0\uFE0F The bridge mount row's configPath points to ",
  "\uFF08\u672A\u58F0\u660E\uFF09": "(undeclared)",
  "\uFF0C\u4E0E\u672C\u9762\u677F\u7BA1\u7406\u7684 ": ", which differs from the ",
  " \u4E0D\u4E00\u81F4\u2014\u2014\u5728\u6B64\u4FDD\u5B58\u7684\u94A9\u5B50\u4E0D\u4F1A\u751F\u6548\u3002\u70B9\u300C\u26A1 \u4FEE\u590D\u6865\u6307\u5411\u300D\u628A\u5B83\u6539\u5230\u672C\u9762\u677F\u6587\u4EF6\uFF0C\u6216\u624B\u5DE5\u7F16\u8F91 profile \u7684 cordis.patch.yml\u3002": " managed by this panel \u2014 hooks saved here will NOT take effect. Click \u26A1 Repair bridge target to switch it to this panel's file, or edit the profile's cordis.patch.yml by hand.",
  "hooks \u6865\uFF08hooks-claude-code\uFF09\u5DF2\u6302\u8F7D\uFF1A\u4FDD\u5B58 / \u542F\u505C / \u5220\u9664\u540E\u81EA\u52A8\u91CD\u542F\u6865\u4F7F\u914D\u7F6E\u751F\u6548\uFF08\u91CD\u542F\u671F\u95F4\u94A9\u5B50\u6709\u7EA6\u4E00\u79D2\u7684\u7A7A\u7A97\uFF09\u3002": "The hooks bridge (hooks-claude-code) is mounted: saving / enabling / disabling / deleting restarts the bridge automatically (about a one-second gap while restarting).",
  "hooks \u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF08configPath \u6307\u5411 ": "The hooks bridge is installed and written to the profile (configPath: ",
  "\uFF09\uFF1A\u91CD\u542F dsh \u540E\u6302\u8F7D\u751F\u6548\u3002": "); it mounts after dsh restarts.",
  "\u5F53\u524D\u672A\u5B89\u88C5 hooks \u6865\uFF08": "The hooks bridge is not installed (",
  "\uFF09\uFF1A\u914D\u7F6E\u4F1A\u5199\u5165 ": "); the config is written to ",
  "\uFF0C\u5B89\u88C5\u5E76\u6302\u8F7D\u540E\u624D\u4F1A\u771F\u6B63\u6267\u884C\u3002": "; it only executes once installed and mounted.",
  "hooks \u6865\u5DF2\u5C31\u7EEA\u3002": "The hooks bridge is ready.",
  "hooks \u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF0C\u91CD\u542F dsh \u540E\u751F\u6548\u3002": "The hooks bridge is installed and written to the profile; it takes effect after dsh restarts.",
  "hooks \u6865\u5DF2\u5378\u8F7D\uFF1Apatch \u884C\u4E0E\u4F9D\u8D56\u5305\u5747\u5DF2\u79FB\u9664\uFF08\u91CD\u542F dsh \u540E\u5B8C\u5168\u751F\u6548\uFF09\u3002": "The hooks bridge is uninstalled: the patch row and dependency packages are both removed (fully effective after dsh restarts).",
  "Codex \u94A9\u5B50\u6865\uFF08hooks-codex\uFF09\u5DF2\u6302\u8F7D\uFF1A\u6D88\u8D39 ": "The Codex hooks bridge (hooks-codex) is mounted: it consumes Codex-format hooks from ",
  " \u91CC\u7684 Codex \u683C\u5F0F\u94A9\u5B50\uFF085 \u4E2A\u94A9\u70B9\uFF1ASessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop\uFF09\uFF0C\u4E0E\u4E0A\u9762\u7684 Claude-Code \u683C\u5F0F\u4E92\u4E0D\u5F71\u54CD\u3002\u672C\u9875\u53EA\u505A\u5B89\u88C5 / \u5378\u8F7D \u2014\u2014 \u94A9\u5B50\u5185\u5BB9\u624B\u5DE5\u7F16\u8F91\u8BE5\u6587\u4EF6\u3002": " (5 hook points: SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop), independent of the Claude-Code format above. This page only installs / uninstalls \u2014 edit the hook contents in that file by hand.",
  "Codex \u94A9\u5B50\u6865\u5DF2\u5B89\u88C5\u5E76\u5199\u5165 profile\uFF08\u94A9\u5B50\u6587\u4EF6 ": "The Codex hooks bridge is installed and written to the profile (hooks file ",
  "\u5F53\u524D\u672A\u5B89\u88C5 Codex \u94A9\u5B50\u6865\uFF08": "The Codex hooks bridge is not installed (",
  "\uFF09\uFF1ACodex \u683C\u5F0F\u94A9\u5B50\u5199\u5165 ": "); Codex-format hooks are written to ",
  "\uFF0C\u5B89\u88C5\u5E76\u6302\u8F7D\u540E\u624D\u4F1A\u6267\u884C\u3002": "; they only execute once installed and mounted.",
  "\uFF09\uFF0C\u91CD\u542F dsh \u540E\u6302\u8F7D\u751F\u6548\u3002": "); it mounts after dsh restarts.",
  "Codex \u94A9\u5B50\u6865\u5DF2\u5378\u8F7D\uFF1Apatch \u884C\u4E0E\u4F9D\u8D56\u5305\u5747\u5DF2\u79FB\u9664\uFF08\u91CD\u542F dsh \u540E\u5B8C\u5168\u751F\u6548\uFF09\u3002": "The Codex hooks bridge is uninstalled: the patch row and dependency packages are both removed (fully effective after dsh restarts).",
  "\u94A9\u5B50": "Hooks",
  "\u5237\u65B0\u94A9\u5B50\u5217\u8868": "Refresh the hook list",
  "\uFF0B\u65B0\u5EFA\u94A9\u5B50": "\uFF0BNew hook",
  "\u26A1 \u4FEE\u590D\u6865\u6307\u5411": "\u26A1 Repair bridge target",
  "\u26A1 \u5B89\u88C5\u5E76\u6302\u8F7D hooks \u6865": "\u26A1 Install & mount the hooks bridge",
  "\u5378\u8F7D hooks \u6865": "Uninstall the hooks bridge",
  "\u5378\u8F7D\u6865": "Uninstall bridge",
  "\u{1F4E5} \u5B89\u88C5 Codex \u94A9\u5B50\u6865": "\u{1F4E5} Install the Codex hooks bridge",
  "\u5378\u8F7D Codex \u94A9\u5B50\u6865": "Uninstall the Codex hooks bridge",
  "\u5378\u8F7D Codex \u6865": "Uninstall Codex bridge",
  "\u8FD8\u6CA1\u6709\u94A9\u5B50\u3002\u94A9\u5B50\u4F1A\u5728\u7279\u5B9A\u4E8B\u4EF6\uFF08\u5DE5\u5177\u8C03\u7528\u524D\u540E\u3001\u63D0\u4EA4\u63D0\u793A\u8BCD\u3001\u4F1A\u8BDD\u5F00\u59CB/\u7ED3\u675F\u7B49\uFF09\u81EA\u52A8\u6267\u884C\u547D\u4EE4\u3002": "No hooks yet. Hooks run commands automatically on specific events (before/after tool calls, prompt submissions, session start/end, etc.).",
  "\uFF08\u672A\u77E5\u8DEF\u5F84\uFF09": "(unknown path)",
  "\n\u70B9\u51FB\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u5B9A\u4F4D": "\nClick to locate in the file manager",
  " \u9879\u5DF2\u5B8C\u6210": " item(s) done",
  "\u79D2": "s",
  "\u5206": "m",
  "\u65F6": "h",
  "\u590D\u5236\u5B8C\u6574 git diff\uFF08HEAD vs \u5DE5\u4F5C\u533A\uFF09": "Copy the full git diff (HEAD vs working tree)",
  "\u2713 \u5DF2\u590D\u5236": "\u2713 Copied",
  "\u29C9 \u590D\u5236 diff": "\u29C9 Copy diff",
  " \u4E2A\u6587\u4EF6\u5DF2\u6539": " file(s) changed",
  "\u7B2C ": "Step ",
  "\u684C\u9762\u901A\u77E5\uFF1A\u5F00\uFF08\u9875\u9762\u5728\u540E\u53F0\u4E14\u5F85\u529E\u5168\u90E8\u5B8C\u6210\u65F6\u63D0\u9192\uFF09\u2014 \u70B9\u51FB\u5173\u95ED": "Desktop notifications: ON (alerts when the page is backgrounded and all todos finish) \u2014 click to turn off",
  "\u684C\u9762\u901A\u77E5\uFF1A\u5173 \u2014 \u70B9\u51FB\u5F00\u542F\uFF08\u9875\u9762\u5728\u540E\u53F0\u4E14\u5F85\u529E\u5168\u90E8\u5B8C\u6210\u65F6\u63D0\u9192\uFF09": "Desktop notifications: OFF \u2014 click to enable (alerts when the page is backgrounded and all todos finish)",
  "\u5F85\u529E\u6E05\u5355": "Todo list",
  "\u274C \u83B7\u53D6 diff \u5931\u8D25": "\u274C Failed to get the diff",
  "\u5DE5\u4F5C\u533A\u5E72\u51C0\uFF0C\u6CA1\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8": "Working tree clean \u2014 no uncommitted changes",
  "\u274C \u590D\u5236\u5931\u8D25": "\u274C Copy failed",
  "\u2705 \u5F85\u529E\u5168\u90E8\u5B8C\u6210": "\u2705 All todos done",
  " \u9879 \xB7 ": " item(s) \xB7 ",
  "\u901A\u77E5\u6743\u9650\u5DF2\u88AB\u6D4F\u89C8\u5668\u62D2\u7EDD\uFF0C\u8BF7\u5728\u7AD9\u70B9\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u540E\u91CD\u8BD5": "Notification permission was denied by the browser \u2014 allow it in the site settings and retry",
  "\u52A0\u8F7D\u5931\u8D25\uFF1A": "Load failed: ",
  "\u89E6\u53D1\u6D4B\u8BD5\u5931\u8D25\uFF1A": "Test trigger failed: ",
  "\u672A\u77E5\u9519\u8BEF": "Unknown error",
  "\u5B89\u88C5\u5B8C\u6210\uFF0C\u8BF7\u91CD\u542F dsh \u540E\u751F\u6548\u3002": "Installed. Restart dsh for it to take effect.",
  "\u5207\u6362\u5931\u8D25\uFF1A": "Switch failed: ",
  "\u7ACB\u5373\u89E6\u53D1\u5931\u8D25\uFF1A": "Trigger-now failed: ",
  "\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A": "Directory picker failed: ",
  "\u8BF7\u63D0\u4F9B\u76EE\u5F55\u8DEF\u5F84\uFF08\u539F\u751F\u9009\u62E9\u6216\u624B\u52A8\u8F93\u5165\uFF09": "Provide a directory path (native picker or manual input)",
  "\u65B0\u5EFA\u5931\u8D25\uFF1A": "Create failed: ",
  "\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A": "Title must not be empty",
  "\u91CD\u547D\u540D\u5931\u8D25\uFF1A": "Rename failed: ",
  "\u6392\u5E8F\u5931\u8D25\uFF1A": "Reorder failed: ",
  "\u26A0 \u8BE5\u5DE5\u4F5C\u533A\u7684\u76EE\u5F55\u5F53\u524D\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u4E34\u65F6\u79FB\u8D70\uFF09\uFF1Bregistry \u4E0D\u4F1A\u6539\u5199\u8BB0\u5F55": "\u26A0 This workspace's directory does not currently exist (possibly moved); the registry keeps the record untouched",
  "\u72B6\u6001\u68C0\u67E5\u5931\u8D25\uFF1A": "Status check failed: ",
  "\u{1F4C1} \u5DE5\u4F5C\u533A": "\u{1F4C1} Workspaces",
  "\u672C\u90E8\u7F72\u672A\u6302\u8F7D dsh-workspace\uFF08\u4EC5 web-app \u7F16\u6210\u81EA\u5E26\uFF09": "dsh-workspace is not mounted in this deployment (shipped with the web-app composition only)",
  "\u2795 \u65B0\u5EFA\u5DE5\u4F5C\u533A": "\u2795 New workspace",
  "\u27F3 \u5237\u65B0": "\u27F3 Refresh",
  "\u4E00\u952E\u53D6\u6D88\u5F52\u6863\u5168\u90E8\u5DF2\u5F52\u6863\u4F1A\u8BDD\uFF08\u4E0D\u5220\u9664\u4F1A\u8BDD\u672C\u4F53\uFF09": "Unarchive every archived session in one click (sessions themselves are kept)",
  "\u6062\u590D\u4E2D\u2026": "Restoring\u2026",
  "\u{1F4E6} \u53D6\u6D88\u5168\u90E8\u5F52\u6863 (": "\u{1F4E6} Unarchive all (",
  "\u539F\u751F\u9009\u62E9\u5668\u540E\u7AEF\uFF1A": "Native picker backend: ",
  "\u539F\u751F\u9009\u62E9\u5668\u53EF\u7528": "Native picker available",
  "\u539F\u751F\u9009\u62E9\u5668\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u7EDD\u5BF9\u8DEF\u5F84": "Native picker unavailable \u2014 type an absolute path manually",
  "\u65B0\u5EFA\u5DE5\u4F5C\u533A": "New workspace",
  "\u{1F4C1} \u9009\u62E9\u76EE\u5F55": "\u{1F4C1} Pick directory",
  "\u6216\u624B\u52A8\u8F93\u5165\u7EDD\u5BF9\u76EE\u5F55\u8DEF\u5F84": "or type an absolute directory path manually",
  "\u663E\u793A\u6807\u9898\uFF08\u7559\u7A7A\u5219\u7528\u76EE\u5F55\u6700\u540E\u4E00\u6BB5\uFF09": "Display title (empty = the directory's last segment)",
  "\u521B\u5EFA\u4E2D\u2026": "Creating\u2026",
  "\u6682\u65E0\u5DE5\u4F5C\u533A \u2014 \u70B9\u300C\u2795 \u65B0\u5EFA\u5DE5\u4F5C\u533A\u300D\u9009\u5B9A\u4E00\u4E2A\u76EE\u5F55\u4F5C\u4E3A\u9879\u76EE\u6839": "No workspaces yet \u2014 click \u2795 New workspace to pick a directory as a project root",
  "\u270E \u91CD\u547D\u540D": "\u270E Rename",
  "\u68C0\u67E5\u76EE\u5F55\u662F\u5426\u4ECD\u5B58\u5728\uFF08\u4E0D\u4FEE\u6539\u8BB0\u5F55\uFF09": "Check whether the directory still exists (does not modify the record)",
  "\u{1F50E} \u68C0\u67E5\u72B6\u6001": "\u{1F50E} Check status",
  "\u786E\u5B9A\u5220\u9664\u5DE5\u4F5C\u533A\u300C": 'Delete workspace "',
  "\u300D\uFF1F\uFF08\u4EC5\u5220\u9664\u6CE8\u518C\uFF0C\u76EE\u5F55\u4E0E\u4F1A\u8BDD\u672C\u4F53\u4FDD\u7559\uFF09": '"? (only the registration is removed; the directory and sessions are kept)',
  "\u5220\u9664\u4E2D\u2026": "Deleting\u2026",
  "\u521B\u5EFA\u4E8E ": "Created ",
  "\u66F4\u65B0\u4E8E ": "Updated ",
  "\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF1A": "Failed to read the config: ",
  "\u2705 \u5DF2\u5199\u5165 ": "\u2705 Written to ",
  " \u2014 \u91CD\u542F dsh \u540E\u751F\u6548": " \u2014 takes effect after dsh restarts",
  "\u2705 \u5DF2\u4FDD\u5B58\uFF08\u5373\u65F6\u751F\u6548\uFF09": "\u2705 Saved (live immediately)",
  "\u{1F501} \u5207\u6362 provider / \u5B89\u88C5 / \u5378\u8F7D \u540E\u9700**\u91CD\u542F dsh** \u751F\u6548\uFF1B\u2699 \u914D\u7F6E\u91CC\u5E26 settings \u547D\u540D\u7A7A\u95F4\u7684 provider \u4FDD\u5B58\u540E\u5373\u65F6\u751F\u6548\uFF0C\u5199 cordis \u884C\u7684\u9700\u91CD\u542F": "\u{1F501} Switching / installing / uninstalling a provider needs a **dsh restart**; in \u2699 config, providers with a settings namespace are live after saving, those writing cordis rows need a restart",
  "dsh \u9ED8\u8BA4 provider\uFF0C\u65E0\u6CD5\u4ECE\u6B64\u9762\u677F\u5378\u8F7D": "The dsh default provider \u2014 it cannot be uninstalled from this panel",
  "\u{1F6E1} dsh \u9ED8\u8BA4": "\u{1F6E1} dsh default",
  "provider \u901A\u8FC7\u6B64\u73AF\u5883\u53D8\u91CF\u8BFB\u53D6 API key\uFF08launch env, \u4E0D\u5B58 plugin\uFF09": "the provider reads its API key from this environment variable (launch env; not stored in the plugin)",
  "\u{1F4E6} \u6B64 provider \u672A\u5B89\u88C5 \u2014 \u9700\u8981\u70B9\u300C\u{1F4E5} \u5B89\u88C5\u300D\u6309\u94AE\u8C03 `pnpm add` \u628A npm \u5305\u52A0\u8FDB profile": "\u{1F4E6} This provider is not installed \u2014 click \u{1F4E5} Install to run `pnpm add` and add the npm package to the profile",
  "\u{1F4E5} \u5B89\u88C5": "\u{1F4E5} Install",
  "\u5378\u8F7D\u4E2D\u2026": "Uninstalling\u2026",
  "\u{1F5D1} \u5378\u8F7D": "\u{1F5D1} Uninstall",
  "\u7F16\u8F91\u8BE5 provider \u7684 Config\uFF08Endpoint / \u6A21\u578B / API Key \u2026\uFF09": "Edit this provider's Config (endpoint / model / API key \u2026)",
  "\u2699 \u6536\u8D77\u914D\u7F6E": "\u2699 Hide config",
  "\u2699 \u914D\u7F6E": "\u2699 Config",
  "\u52A0\u8F7D provider \u5217\u8868\u5931\u8D25 \u2014 \u68C0\u67E5 dsh \u662F\u5426\u5728\u8FD0\u884C": "Failed to load the provider list \u2014 check that dsh is running",
  "\u7EE7\u627F\u9ED8\u8BA4": "Inherit default",
  "\u5DF2\u914D\u7F6E \u2014 \u7559\u7A7A\u4E0D\u4FEE\u6539": "Configured \u2014 leave empty to keep",
  "\u672A\u914D\u7F6E \u2014 \u7559\u7A7A\u5219\u56DE\u9000\u5230\u51ED\u636E / \u73AF\u5883\u53D8\u91CF": "Not configured \u2014 empty falls back to credentials / environment",
  "\u7559\u7A7A = \u7EE7\u627F provider \u9ED8\u8BA4\u503C": "Empty = inherit the provider default",
  "\u7EE7\u627F\u9ED8\u8BA4\uFF1A": "Inherits default: ",
  "\u5220\u9664\u5DF2\u5B58\u7684\u5BC6\u94A5\u503C": "Delete the stored secret value",
  "\u5F53\u524D\u6CA1\u6709\u53EF\u5220\u9664\u7684\u5BC6\u94A5\u503C": "There is no stored secret value to delete",
  "\u21BA \u64A4\u9500": "\u21BA Undo",
  "\u6E05\u9664": "Clear",
  "\u5DF2\u8BBE\u7F6E": "Set",
  "\u{1F5C4} \u5B58\u50A8\uFF1Adsh settings \u547D\u540D\u7A7A\u95F4 `": "\u{1F5C4} Storage: dsh settings namespace `",
  "\u{1F5C4} \u5B58\u50A8\uFF1Acordis.patch.yml \u884C `": "\u{1F5C4} Storage: cordis.patch.yml row `",
  " \xB7 \u4FDD\u5B58\u540E\u9700\u91CD\u542F dsh \u751F\u6548": " \xB7 a dsh restart is needed after saving",
  " \xB7 \u4FDD\u5B58\u540E\u5373\u65F6\u751F\u6548": " \xB7 live immediately after saving",
  "\u8BE5 provider \u6CA1\u6709\u53EF\u914D\u7F6E\u5B57\u6BB5": "This provider has no configurable fields",
  "\u{1F4BE} \u4FDD\u5B58\u914D\u7F6E": "\u{1F4BE} Save config",
  "\u8BFB\u53D6 ": "Reading ",
  " \u914D\u7F6E\u2026": "'s config\u2026",
  "\u914D\u7F6E\u4E0D\u53EF\u7528": "Config unavailable",
  "\u4F1A\u8BDD\u5217\u8868\u4E0D\u53EF\u7528\uFF08": "The session list is unavailable (",
  "\uFF09\u2014 \u4EC5\u663E\u793A\u5168\u5C40\u6280\u80FD": ") \u2014 showing global skills only",
  "\u52A0\u8F7D\u6280\u80FD\u5931\u8D25\uFF1A": "Failed to load skills: ",
  "\uFF08\u53EF\u624B\u52A8\u590D\u5236 /": "(copy manually /",
  "\u{1F4DA} \u6280\u80FD": "\u{1F4DA} Skills",
  "\u672C\u90E8\u7F72\u672A\u6302\u8F7D @deepseek-ai/dsh-skill\uFF08\u6280\u80FD\u6CE8\u518C\u8868\u4E0D\u53EF\u7528\uFF09": "@deepseek-ai/dsh-skill is not mounted in this deployment (the skill registry is unavailable)",
  "\u52A0\u8F7D\u6280\u80FD\u6E05\u5355\u2026": "Loading the skill roster\u2026",
  "\u6309\u540D\u79F0 / \u63CF\u8FF0 / \u8DEF\u5F84\u8FC7\u6EE4\u2026": "Filter by name / description / path\u2026",
  "\u8FC7\u6EE4\u6280\u80FD": "Filter skills",
  "\u26A0 \u4F1A\u8BDD ": "\u26A0 Session ",
  " \u7684\u4F5C\u7528\u57DF\u672A\u80FD\u89E3\u6790\uFF1A": "'s scope could not be resolved: ",
  "\u{1F4CC} \u5171 ": "\u{1F4CC} ",
  " \u4E2A\u6280\u80FD": " skill(s) in total",
  " \xB7 \u5F53\u524D\u5339\u914D ": " \xB7 currently matching ",
  "\u6A21\u578B\u53EF\u4E3B\u52A8\u8C03\u7528\uFF08skill \u5DE5\u5177\uFF09": "The model can invoke it proactively (skill tool)",
  "\u{1F916} \u6A21\u578B\u53EF\u8C03\u7528": "\u{1F916} Model-invokable",
  "\u4EBA\u7C7B\u53EF\u5728 composer \u7528 /name \u8C03\u7528": "A human can invoke it with /name in the composer",
  "\u{1F464} \u4EBA\u7C7B\u53EF\u8C03\u7528": "\u{1F464} Human-invokable",
  "\u8BE5\u6280\u80FD\u5F53\u524D\u4E0D\u66B4\u9732\u7ED9\u4EFB\u4F55\u8C03\u7528\u65B9": "This skill is currently exposed to no invoker",
  "\u672A\u66B4\u9732": "Not exposed",
  "\u590D\u5236 /": "Copy /",
  " \u5230\u526A\u8D34\u677F\uFF08\u5728 composer \u76F4\u63A5\u7C98\u8D34\u5373\u53EF\u8C03\u7528\uFF09": " to the clipboard (paste it in the composer to invoke)",
  "\u{1F4CB} \u590D\u5236 /name": "\u{1F4CB} Copy /name",
  "\u754C\u9762\u8BED\u8A00": "Interface language",
  "\u5728\u7CFB\u7EDF\u8D44\u6E90\u7BA1\u7406\u5668\u4E2D\u6253\u5F00 SKILL.md \u6240\u5728\u76EE\u5F55\uFF08": "Open the SKILL.md directory in the system file manager (",
  "\u{1F4C2} \u6253\u5F00\u76EE\u5F55": "\u{1F4C2} Open directory",
  "\u4F55\u65F6\u7528\uFF1A": "When to use: ",
  "\u53EF\u89C1\u4E8E\uFF1A": "Visible in: ",
  "\u6CA1\u6709\u5339\u914D\u5F53\u524D\u7B5B\u9009\u6761\u4EF6\u7684\u6280\u80FD": "No skills match the current filter",
  "\u6CA1\u6709\u53D1\u73B0\u4EFB\u4F55\u6280\u80FD\uFF08\u5168\u5C40\u5C42\u3001\u9884\u8BBE\u4F5C\u7528\u57DF\u4E0E\u4F1A\u8BDD\u4F5C\u7528\u57DF\u90FD\u672A\u547D\u4E2D\u6280\u80FD\u6E90\uFF09": "No skills discovered (the global layer, preset scopes and session scopes all missed every skill source)",
  "\u5168\u5C40\u5C42\uFF1A": "Global layer: ",
  "\uFF08\u672C\u90E8\u7F72\u7531\u9884\u8BBE\u6302\u8F7D\u672C\u5730\u6280\u80FD\uFF0C\u5168\u5C40\u5C42\u4E3A\u7A7A\u5C5E\u6B63\u5E38\uFF09": "(this deployment mounts local skills through presets; an empty global layer is normal)",
  "\u9884\u8BBE\u4F5C\u7528\u57DF\uFF1A": "Preset scopes: ",
  " \u4E2A\u89E3\u6790\u5931\u8D25\uFF09": " failed to resolve)",
  "\u4F1A\u8BDD\u4F5C\u7528\u57DF\uFF1A": "Session scopes: ",
  "\u4F1A\u8BDD\u4F5C\u7528\u57DF\uFF1A\u65E0\uFF08dsh \u5F53\u524D\u6CA1\u6709\u5DF2\u77E5\u4F1A\u8BDD\uFF09": "Session scopes: none (dsh has no known sessions right now)",
  "\u8B66\u544A\uFF1A": "Warnings: ",
  " \u6761": " item(s)",
  "\u8BCA\u65AD\uFF1A": "Diagnostics: ",
  "\u9879\u76EE .agents": "Project .agents",
  "\u9879\u76EE .dsh": "Project .dsh",
  "\u7528\u6237 .agents": "User .agents",
  "\u7528\u6237 dsh": "User dsh",
  "\u63D2\u4EF6\u5185\u7F6E": "Plugin built-in",
  "\u8FD0\u884C\u65F6\u6CE8\u518C": "Runtime-registered",
  "\u81EA\u5B9A\u4E49\u6E90": "Custom source",
  "\u672A\u77E5\u6765\u6E90": "Unknown source",
  "\u65B0\u5EFA\u4F1A\u8BDD\u6A21\u5F0F\u9700\u8981 ": "Create-session mode needs ",
  " webhook \u8FD0\u884C\u65F6": " webhook runtime",
  "\uFF08\u5DF2\u5B89\u88C5\uFF0C\u9700\u6302\u8F7D\u5230 cordis.patch.yml \u5E76\u91CD\u542F dsh\uFF09": "(installed; it still needs a mount row in cordis.patch.yml and a dsh restart)",
  "\u26A1 \u5B89\u88C5\u5E76\u6302\u8F7D webhook \u8FD0\u884C\u65F6": "\u26A1 Install & mount the webhook runtime",
  "+ \u65B0\u5EFA\u89C4\u5219": "+ New rule",
  "\u8FD8\u6CA1\u6709 Webhook \u89E6\u53D1\u89C4\u5219\u3002\u70B9\u4E0A\u65B9\u6A21\u677F\u5361\u7247\u4E00\u952E\u521B\u5EFA\uFF0C\u6216\u300C\uFF0B \u65B0\u5EFA\u89C4\u5219\u300D\u4ECE\u96F6\u5F00\u59CB\u3002": "No webhook trigger rules yet. Click a template card above to create one in a click, or \uFF0B New rule from scratch.",
  "\u4F1A\u771F\u5B9E\u6CE8\u5165\u6D88\u606F\u5230\u76EE\u6807\u4F1A\u8BDD": "really injects a message into the target session",
  "\u{1F9EA} \u89E6\u53D1\u6D4B\u8BD5": "\u{1F9EA} Test trigger",
  "\u786E\u5B9A\u5220\u9664\u89C4\u5219\u300C": 'Delete rule "',
  "\u6700\u8FD1 ": "Last ",
  " \u6B21\u4EA4\u4ED8\uFF08\u672C\u6B21\u8FD0\u884C\u671F\u95F4\uFF09": " deliveries (this run)",
  "\u89C4\u5219\u6807\u8BC6\uFF08\u82F1\u6587\u5B57\u6BCD\u5F00\u5934\uFF0C\u65E0\u7A7A\u683C\uFF09": "Rule id (starts with a letter, no spaces)",
  "\u5171\u4EAB\u5BC6\u94A5\uFF08\u5FC5\u586B\uFF1B\u7F16\u8F91\u65F6\u7559\u7A7A\u8868\u793A\u4FDD\u6301\u4E0D\u53D8\uFF09": "Shared secret (required; leave empty when editing to keep the stored one)",
  "\u{1F3B2} \u6362\u4E00\u4E2A": "\u{1F3B2} Regenerate",
  "\u6362\u4E00\u4E2A 16 \u4F4D\u968F\u673A\u5BC6\u94A5": "Draw another 16-char random secret",
  "\u9690\u85CF": "Hide",
  "\u663E\u793A": "Show",
  "\u4E8B\u4EF6\u8FC7\u6EE4\uFF08\u7559\u7A7A = \u4EFB\u610F\u4E8B\u4EF6\uFF09": "Event filter (empty = any event)",
  "\u52A8\u4F5C\u6A21\u5F0F": "Action mode",
  "\u63A8\u9001\u5230\u65E2\u6709\u4F1A\u8BDD": "Push to an existing session",
  "\u65B0\u5EFA\u4F1A\u8BDD": "Create a session",
  "\u76EE\u6807\u4F1A\u8BDD ID\uFF08\u5982 session-xxx\uFF09": "Target session ID (e.g. session-xxx)",
  "steer\uFF08\u63D2\u5165\u5230\u4E0B\u4E00\u6B65\u4E4B\u524D\uFF0C\u52FE\u9009\u540E agent \u5F53\u524D\u6B65\u9AA4\u5B8C\u6210\u540E\u7ACB\u5373\u5904\u7406\uFF09": "steer (inserted before the next step; when ticked the agent handles it right after its current step)",
  "\u5DE5\u4F5C\u533A\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u5982 E:\\projects\\my-app\uFF09": "Workspace absolute path (e.g. E:\\projects\\my-app)",
  "Prompt \u6A21\u677F": "Prompt template",
  "\u7559\u7A7A\u4F7F\u7528\u9ED8\u8BA4\u6A21\u677F\u3002$RULE / $DELIVERY / $EVENT / $PAYLOAD \u4F1A\u88AB\u66FF\u6362\u3002": "Empty = the default template. $RULE / $DELIVERY / $EVENT / $PAYLOAD are substituted.",
  "\u521B\u5EFA": "Create",
  "\u8C03\u5EA6\u5668\u672A\u8FD0\u884C\uFF08headless \u90E8\u7F72\u6216\u63D2\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF09\u2014\u2014\u4EFB\u52A1\u53EF\u7F16\u8F91\uFF0C\u4F46\u4E0D\u4F1A\u81EA\u52A8\u89E6\u53D1": "The scheduler is not running (headless deployment or plugin failed to load) \u2014 tasks are editable but never fire automatically",
  "+ \u65B0\u5EFA\u4EFB\u52A1": "+ New task",
  "\u8FD8\u6CA1\u6709\u5B9A\u65F6\u4EFB\u52A1\u3002\u70B9\u4E0A\u65B9\u6A21\u677F\u5361\u7247\u4E00\u952E\u521B\u5EFA\uFF0C\u6216\u300C\uFF0B \u65B0\u5EFA\u4EFB\u52A1\u300D\u4ECE\u96F6\u5F00\u59CB\uFF1B\u4EFB\u52A1\u5728 dsh \u8FD0\u884C\u671F\u95F4\u6309 cron \u8868\u8FBE\u5F0F\u81EA\u52A8\u89E6\u53D1\u3002": "No scheduled tasks yet. Click a template card above to create one in a click, or \uFF0B New task from scratch; tasks fire on their cron expression while dsh runs.",
  "\u65E0\u53EF\u89E6\u53D1\u65F6\u523B": "No schedulable time",
  "\u542F\u7528/\u505C\u7528": "Enable/disable",
  "\u7ACB\u5373\u89E6\u53D1\u4E00\u6B21\uFF08\u4F1A\u771F\u5B9E\u6CE8\u5165\u6D88\u606F/\u65B0\u5EFA\u4F1A\u8BDD\uFF09": "Trigger once right now (really injects a message / creates a session)",
  "\u25B6 \u7ACB\u5373\u89E6\u53D1": "\u25B6 Trigger now",
  "\u786E\u5B9A\u5220\u9664\u4EFB\u52A1\u300C": 'Delete task "',
  "\u23F1 \u4E0B\u6B21\u89E6\u53D1 ": "\u23F1 Next fire ",
  "\u2014\uFF08\u8868\u8FBE\u5F0F\u5728\u53EF\u641C\u7D22\u8303\u56F4\u5185\u65E0\u5339\u914D\u65E5\u671F\uFF09": "\u2014 (the expression matches no date in the searchable range)",
  " \u540E (": " from now (",
  "\u76EE\u6807\u4F1A\u8BDD\u4E0D\u5728\u5185\u5B58\u4E2D\uFF0C\u89E6\u53D1\u65F6\u6CE8\u5165\u4F1A\u5931\u8D25": "The target session is not in memory \u2014 the injection will fail when it fires",
  "\u26A0 \u76EE\u6807\u4F1A\u8BDD\u79BB\u7EBF": "\u26A0 Target session offline",
  " \u6B21\u89E6\u53D1\uFF08\u672C\u6B21\u8FD0\u884C\u671F\u95F4\uFF09": " firings (this run)",
  "\u5B9A\u65F6\u4EFB\u52A1\uFF08\u5BBF\u4E3B\u7EA7\uFF09": "Scheduled tasks (host-level)",
  "\u6BCF\u5C0F\u65F6\u7B2C ": "At minute ",
  " \u5206": " of the hour",
  "\u6BCF\u5468 ": "Weekly on ",
  "\u6BCF\u5929 ": "Daily at ",
  "\u4EFB\u52A1\u6807\u8BC6\uFF08\u82F1\u6587\u5B57\u6BCD\u5F00\u5934\uFF0C\u65E0\u7A7A\u683C\uFF09": "Task id (starts with a letter, no spaces)",
  "\u4EFB\u52A1 ID": "Task ID",
  "\u8C03\u5EA6\uFF08\u672C\u5730\u65F6\u533A ": "Schedule (local timezone ",
  "\u8C03\u5EA6\u9891\u7387": "Frequency",
  "\u6BCF\u5C0F\u65F6": "Hourly",
  "\u6BCF\u5929": "Daily",
  "\u6BCF\u5468": "Weekly",
  "\u81EA\u5B9A\u4E49": "Custom",
  "\u661F\u671F": "Day of week",
  "\u4E8E": "at",
  "\u5206\u949F": "Minute",
  "\u65F6\u95F4": "Time",
  "cron \u8868\u8FBE\u5F0F": "cron expression",
  "5 \u4F4D cron\uFF08\u5206 \u65F6 \u65E5 \u6708 \u5468\uFF09\uFF1A\u652F\u6301 *, \u9017\u53F7\u5217\u8868, \u77ED\u6A2A\u8303\u56F4, \u659C\u6760\u6B65\u957F\uFF1B\u5468\u63A5\u53D7 0-7 \u4E0E SUN-SAT\u3002": "5-field cron (min hour day month weekday): supports *, comma lists, dash ranges and slash steps; weekdays accept 0-7 and SUN-SAT.",
  " \xB7 \u8FDB\u7A0B\u91CD\u542F\u671F\u95F4\u5230\u671F\u7684\u4EFB\u52A1\u4E0D\u8865\u6295\u3002": " \xB7 tasks that come due while the process is down are not back-filled.",
  "\u5386\u53F2\u4F1A\u8BDD": "Session history",
  "\u5DE5\u4F5C\u6D41": "Workflows",
  "\u5DE5\u4F5C\u6D41 = \u628A\u591A\u6B65\u4EFB\u52A1\u5199\u6210\u5C0F\u811A\u672C\uFF0C\u4EA4\u7ED9 dsh \u81EA\u52A8\u6D3E\u5B50\u667A\u80FD\u4F53\u9010\u6B65\u5B8C\u6210": "A workflow is a small script that runs a multi-step task \u2014 dsh spawns subagents and finishes it for you",
  "\u4E09\u6B65\u4E0A\u624B\uFF1A\u2460 \u70B9\u300C\u4ECE\u6A21\u677F\u5F00\u59CB\u300D\u91CC\u7684\u4EFB\u610F\u5361\u7247 \u2192 \u2461 \u6309\u9700\u6539\u540D\u79F0\u548C\u53C2\u6570 \u2192 \u2462 \u70B9\u300C\u{1F680} \u542F\u52A8\u300D\uFF0C\u8FD0\u884C\u5361\u7247\u5B9E\u65F6\u663E\u793A\u6BCF\u4E00\u6B65\u8FDB\u5EA6\u4E0E\u7ED3\u679C\u3002": "Three steps: \u2460 click any template card below \u2192 \u2461 tweak the name and args \u2192 \u2462 press \u{1F680} Start and watch each step live.",
  "\u4ECE\u6A21\u677F\u5F00\u59CB\uFF08\u70B9\u5361\u7247\u81EA\u52A8\u586B\u597D\uFF0C\u6539\u53C2\u6570\u5C31\u80FD\u8DD1\uFF09": "Start from a template (click to prefill everything, tweak and run)",
  "\u5B9A\u65F6\u4EFB\u52A1 = \u5230\u70B9\u81EA\u52A8\u7ED9 dsh \u53D1\u4E00\u53E5\u8BDD\u2014\u2014\u53EF\u4EE5\u50AC\u4FC3\u65E2\u6709\u4F1A\u8BDD\uFF08steer\uFF09\uFF0C\u4E5F\u53EF\u4EE5\u65B0\u5EFA\u4F1A\u8BDD\u4ECE\u5934\u8DD1": "A scheduled task sends dsh a message on a clock \u2014 nudge an existing session (steer) or spin up a fresh one",
  "\u4E09\u6B65\u4E0A\u624B\uFF1A\u2460 \u70B9\u4E0B\u65B9\u6A21\u677F\u5361\u7247\uFF08\u6216\u300C\uFF0B \u65B0\u5EFA\u4EFB\u52A1\u300D\uFF09 \u2192 \u2461 \u6539\u9891\u7387\u548C\u63D0\u793A\u8BCD \u2192 \u2462 \u4FDD\u5B58\uFF0Cdsh \u8FD0\u884C\u671F\u95F4\u5230\u70B9\u81EA\u52A8\u89E6\u53D1\u3002": "Three steps: \u2460 click a template card below (or \uFF0B New task) \u2192 \u2461 tweak the schedule and prompt \u2192 \u2462 save; it fires on time while dsh runs.",
  "\u5DE5\u4F5C\u65E5\u65E9\u62A5": "Weekday morning brief",
  "\u5DE5\u4F5C\u65E5\u65E9\u4E0A 9 \u70B9\uFF1A\u7ED9\u4F1A\u8BDD\u53D1\u4E00\u6761\u4ECA\u65E5\u7B80\u62A5\u63D0\u9192": "Weekdays 9:00 \u2014 send the session a today-brief reminder",
  "\u6BCF\u5468\u5468\u62A5": "Weekly report",
  "\u6BCF\u5468\u4E94 17 \u70B9\uFF1A\u56DE\u987E\u672C\u5468\u4F1A\u8BDD\u4E0E\u6539\u52A8\uFF0C\u8F93\u51FA\u7B80\u660E\u5468\u62A5": "Fridays 17:00 \u2014 review this week's sessions and changes into a short report",
  "\u6BCF\u5C0F\u65F6\u5DE1\u68C0": "Hourly patrol",
  "\u6BCF\u5C0F\u65F6\u6574\u70B9\uFF1A\u68C0\u67E5\u9879\u76EE\u72B6\u6001\uFF0C\u5F02\u5E38\u5148\u5B9A\u4F4D\u518D\u7ED9\u5EFA\u8BAE": "Every hour \u2014 check project status, diagnose anomalies before suggesting fixes",
  "Webhook = \u5916\u90E8\u4E8B\u4EF6 POST \u4E00\u4E2A HTTP \u8BF7\u6C42\uFF0C\u5C31\u81EA\u52A8\u7ED9\u4F60\u7684 dsh \u4F1A\u8BDD\u53D1\u4E00\u6761\u6D88\u606F\uFF08CI\u3001\u62A5\u8B66\u3001GitHub\u2026\u90FD\u884C\uFF09": "A webhook turns an external HTTP POST into a message for your dsh session (CI, alerts, GitHub\u2026 anything)",
  "\u4E09\u6B65\u4E0A\u624B\uFF1A\u2460 \u70B9\u4E0B\u65B9\u6A21\u677F\u5361\u7247\uFF08\u6216\u300C\uFF0B \u65B0\u5EFA\u89C4\u5219\u300D\uFF09 \u2192 \u2461 \u628A\u9762\u677F\u7ED9\u51FA\u7684\u7AEF\u70B9 URL \u4E0E\u5BC6\u94A5\u914D\u5230\u5916\u90E8\u670D\u52A1 \u2192 \u2462 \u4E8B\u4EF6\u5230\u8FBE\u81EA\u52A8\u89E6\u53D1\uFF0C\u4EA4\u4ED8\u5386\u53F2\u968F\u65F6\u53EF\u67E5\u3002": "Three steps: \u2460 click a template card below (or \uFF0B New rule) \u2192 \u2461 point the external service at the endpoint URL with the secret \u2192 \u2462 events fire automatically; check the delivery history anytime.",
  "CI \u5931\u8D25\u81EA\u52A8\u5904\u7406": "CI failure auto-triage",
  "CI/CD \u5931\u8D25\u4E8B\u4EF6\u63A8\u7ED9\u4F1A\u8BDD\uFF0C\u81EA\u52A8\u5B9A\u4F4D\u5E76\u5C1D\u8BD5\u4FEE\u590D": "Push CI/CD failure events to the session \u2014 locate and try to fix automatically",
  "GitHub Issue \u5206\u8BCA": "GitHub issue triage",
  "\u65B0 Issue \u5230\u8FBE\u65F6\u5F52\u7EB3\u8981\u70B9\u3001\u5B9A\u4F18\u5148\u7EA7\u5E76\u8D77\u8349\u56DE\u590D": "When a new issue arrives \u2014 summarize, prioritize and draft a reply",
  "\u62A5\u8B66\u65B0\u5EFA\u4F1A\u8BDD\u5904\u7406": "Alert handling in a fresh session",
  "\u7EBF\u4E0A\u62A5\u8B66\u65B0\u5EFA\u4E13\u95E8\u4F1A\u8BDD\uFF0C\u5B9A\u4F4D\u95EE\u9898\u5E76\u7ED9\u5904\u7F6E\u65B9\u6848": "Production alerts spin up a dedicated session \u2014 diagnose and propose a plan",
  "\uFF0B \u65B0\u5EFA\u5DE5\u4F5C\u6D41\uFF08\u81EA\u5DF1\u5199\u811A\u672C\uFF09": "\uFF0B New workflow (write your own script)",
  "\u6682\u65E0\u8FD0\u884C\u3002\u4E09\u6B65\u4E0A\u624B\uFF1A\u70B9\u4E0A\u65B9\u6A21\u677F\u5361\u7247 \u2192 \u6309\u9700\u6539\u53C2\u6570 \u2192 \u70B9\u300C\u{1F680} \u542F\u52A8\u300D\u3002\u4E5F\u53EF\u4EE5\u4ECE\u300C\u5DE5\u4F5C\u5E93\u300D\u542F\u52A8\u5DF2\u4FDD\u5B58\u7684\u811A\u672C\u3002": "No runs yet. Three steps: click a template above \u2192 tweak the args \u2192 press \u{1F680} Start. Saved scripts live in the Library tab.",
  "\u53C2\u6570\uFF1A\u811A\u672C\u91CC args.xxx \u7684\u503C\uFF0C\u5728\u4E0A\u9762\u8FD9\u4E2A JSON \u91CC\u586B\uFF08\u6A21\u677F\u5DF2\u5E26\u9ED8\u8BA4\u503C\uFF0C\u53EF\u76F4\u63A5\u6539\uFF09\u3002": "Args: values for args.xxx in the script, filled in this JSON (templates ship defaults you can edit).",
  "\u603B\u7ED3\u4E00\u4E2A\u4E3B\u9898": "Summarize a topic",
  "\u6D3E\u4E00\u4E2A\u5B50\u667A\u80FD\u4F53\uFF0C\u6309\u4F60\u7ED9\u7684\u4E3B\u9898\u8F93\u51FA\u4E00\u6BB5\u603B\u7ED3": "One subagent writes a short summary of your topic",
  "\u5E76\u884C\u53CC\u89D2\u5EA6\u5206\u6790": "Parallel two-angle analysis",
  "\u4E24\u4E2A\u5B50\u667A\u80FD\u4F53\u5E76\u884C\uFF0C\u5206\u522B\u4ECE\u6280\u672F\u4E0E\u4F53\u9A8C\u89D2\u5EA6\u5206\u6790": "Two subagents analyze your topic from the tech and UX angles in parallel",
  "\u5206\u6B65\u6DA6\u8272\u6D41\u6C34\u7EBF": "Stepwise polish pipeline",
  "\u51E0\u4E2A\u4E3B\u9898\u4F9D\u6B21\u7ECF\u8FC7\u300C\u521D\u7A3F \u2192 \u6DA6\u8272\u300D\u4E24\u9053\u5DE5\u5E8F": "Topics flow through a draft \u2192 polish two-stage pipeline",
  "\u6269\u5C55\u63D2\u4EF6": "Extensions",
  "\u68C0\u6D4B\u4E2D...": "Probing...",
  "\u811A\u672C\u4E0D\u80FD\u4E3A\u7A7A": "The script cannot be empty",
  "args \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A": "args is not valid JSON: ",
  "\u{1F680} \u5DE5\u4F5C\u6D41\u5DF2\u542F\u52A8": "\u{1F680} Workflow started",
  "\u8BE5\u8FD0\u884C\u5DF2\u4E0D\u5728\u8FDB\u884C\u4E2D": "That run is no longer in progress",
  "\u505C\u6B62\u8BF7\u6C42\u5DF2\u9001\u8FBE\uFF0C\u4F46\u8FD0\u884C\u672A\u5728\u9884\u7B97\u5185\u843D\u5B9A\uFF08\u811A\u672C\u5FFD\u7565\u53D6\u6D88\u4FE1\u53F7\uFF1F\uFF09": "Stop request delivered, but the run did not settle within its budget (the script ignores cancellation?)",
  "\u274C \u505C\u6B62\u5931\u8D25\uFF1A": "\u274C Failed to stop: ",
  "\u270F\uFE0F \u5DF2\u57FA\u4E8E\u65E7\u6B65\u9AA4\u7F13\u5B58\u91CD\u5EFA\u5DE5\u4F5C\u6D41": "\u270F\uFE0F Workflow rebuilt; finished steps served from cache",
  "\u2705 \u5DF2\u56DE\u7B54\uFF0C\u5DE5\u4F5C\u6D41\u7EE7\u7EED": "\u2705 Answered; the workflow continues",
  "\u56DE\u7B54\u5931\u8D25\uFF1A": "Failed to answer: ",
  "\u274C \u56DE\u7B54\u5931\u8D25\uFF1A": "\u274C Failed to answer: ",
  "\u25B6\uFE0F \u5DF2\u4ECE\u65AD\u70B9\u7EED\u8DD1": "\u25B6\uFE0F Resumed from the last checkpoint",
  "\u274C \u7EED\u8DD1\u5931\u8D25\uFF1A": "\u274C Failed to resume: ",
  "\u{1F680} \u5DF2\u542F\u52A8\uFF1A": "\u{1F680} Started: ",
  "\u274C \u542F\u52A8\u5931\u8D25\uFF1A": "\u274C Failed to start: ",
  "\u540D\u79F0\u548C\u811A\u672C\u4E0D\u80FD\u4E3A\u7A7A": "Name and script cannot be empty",
  "\u{1F4BE} \u5DF2\u4FDD\u5B58\uFF1A": "\u{1F4BE} Saved: ",
  "\u{1F5D1} \u5DF2\u5220\u9664\uFF1A": "\u{1F5D1} Deleted: ",
  "\u274C \u5220\u9664\u5931\u8D25\uFF1A": "\u274C Failed to delete: ",
  "\u5DE5\u4F5C\u6D41\u5F15\u64CE\u4E0D\u53EF\u7528\uFF1A\u672A\u6302\u8F7D @deepseek-ai/dsh-subagent\uFF0C\u6216\u670D\u52A1\u542F\u52A8\u5931\u8D25\u3002": "Workflow engine unavailable: @deepseek-ai/dsh-subagent is not mounted, or the service failed to start.",
  "\uFF08\u5BBF\u4E3B\u8FD4\u56DE\uFF1A": " (host reported: ",
  "\uFF09": ")",
  "\u8FD0\u884C (": "Runs (",
  "\u5DE5\u4F5C\u5E93 (": "Library (",
  " \u6B65": " steps",
  "\u8BE6\u60C5": "Details",
  "\u23F9 \u505C\u6B62": "\u23F9 Stop",
  "\u25B6 \u7EED\u8DD1": "\u25B6 Resume",
  "\u270F\uFE0F \u6539\u5EFA": "\u270F\uFE0F Rebuild",
  "\u23F8 \u5DE5\u4F5C\u6D41\u5728\u7B49\u5F85\u56DE\u7B54": "\u23F8 The workflow is waiting for an answer",
  "\u56DE\u7B54\u2026": "Answer\u2026",
  "\u53D1\u9001\u4E2D\u2026": "Sending\u2026",
  "\u56DE\u7B54": "Answer",
  "\u811A\u672C": "Script",
  "\u8FD4\u56DE\u503C": "Return value",
  "\u65E5\u5FD7": "Log",
  "\u6539\u5EFA\u5DE5\u4F5C\u6D41\uFF08\u5DF2\u5B8C\u6210\u6B65\u9AA4\u8D70\u7F13\u5B58\uFF0C\u4E0D\u91CD\u82B1\u8C03\u7528\uFF09": "Rebuild workflow (finished steps are served from cache; no extra calls)",
  "\u65B0\u5EFA\u5DE5\u4F5C\u6D41": "New workflow",
  "\u540D\u79F0\uFF08\u53EF\u9009\uFF09": "Label (optional)",
  "\u7236\u4F1A\u8BDD": "Parent session",
  "\u6CA1\u6709\u5728\u7EBF\u4F1A\u8BDD\u2014\u2014\u5148\u5728 dsh \u4E2D\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u518D\u542F\u52A8\u5DE5\u4F5C\u6D41\u3002": "No live session \u2014 open a session in dsh before starting a workflow.",
  "TypeScript / JavaScript\uFF0C\u9876\u5C42 return \u8FD4\u56DE\u7ED3\u679C": "TypeScript / JavaScript; a top-level return yields the result",
  "args\uFF08JSON \u5BF9\u8C61\uFF09": "args (JSON object)",
  "\u63D0\u4EA4\u4E2D\u2026": "Submitting\u2026",
  "\u786E\u8BA4\u6539\u5EFA": "Confirm rebuild",
  "\u{1F680} \u542F\u52A8": "\u{1F680} Start",
  "\uFF0B \u4FDD\u5B58\u4E00\u4E2A\u5DE5\u4F5C\u6D41": "\uFF0B Save a workflow",
  "\u5DE5\u4F5C\u5E93\u4E3A\u7A7A\u3002\u4FDD\u5B58\u5E38\u7528\u811A\u672C\u540E\uFF0C\u53EF\u4EE5\u6309\u540D\u4E00\u952E\u542F\u52A8\u3002": "The library is empty. Save your common scripts here to launch them by name.",
  "\u9879\u76EE": "Project",
  "\u5168\u5C40": "Global",
  "\u{1F680} \u8FD0\u884C": "\u{1F680} Run",
  "\u786E\u8BA4\u5220\u9664": "Confirm delete",
  "\u{1F5D1} \u5220\u9664": "\u{1F5D1} Delete",
  "\u4FDD\u5B58\u5230\u5DE5\u4F5C\u5E93": "Save to the library",
  "\u540D\u79F0\uFF08\u5B57\u6BCD\u6570\u5B57 . _ -\uFF09": "Name (alphanumeric . _ -)",
  "\u9879\u76EE\uFF08\u968F\u5DE5\u4F5C\u533A .dsh/\uFF09": "Project (under the workspace .dsh/)",
  "\u4E00\u53E5\u8BDD\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09": "One-line description (optional)",
  "\u4FDD\u5B58\u4E2D\u2026": "Saving\u2026",
  "\u{1F4BE} \u4FDD\u5B58": "\u{1F4BE} Save",
  "\u8FD0\u884C\u4E2D": "Running",
  "\u5DF2\u5B8C\u6210": "Completed",
  "\u5931\u8D25": "Failed",
  "\u5DF2\u505C\u6B62": "Stopped",
  "\u5DF2\u5931\u6D3B": "Orphaned",
  "// \u53EF\u7528\uFF1Aagent(prompt, opts?) / parallel(thunks) / pipeline(items, ...stages)": "// Available: agent(prompt, opts?) / parallel(thunks) / pipeline(items, ...stages)",
  "//       phase(title) / log(msg) / report(key, value) / shell(cmd)": "//       phase(title) / log(msg) / report(key, value) / shell(cmd)",
  "// \u9876\u5C42 return \u8FD4\u56DE\u7ED3\u679C\uFF1B\u5355\u6B65\u5931\u8D25 agent() \u8FD4\u56DE null\uFF0C\u811A\u672C\u7EE7\u7EED\u3002": "// A top-level return yields the result; a failed agent() step returns null and the script continues.",
  // Phase F3: privileged-action audit card in the Plugins panel.
  "\u64CD\u4F5C\u5BA1\u8BA1": "Action audit",
  "\u52A0\u8F7D\u5BA1\u8BA1": "Load audit",
  "\u5C1A\u672A\u52A0\u8F7D\u3002\u5BA1\u8BA1\u8BB0\u5F55\u7279\u6743\u52A8\u4F5C\uFF08\u5B89\u88C5/\u5378\u8F7D\u63D2\u4EF6\u3001\u5199\u5165\u94A9\u5B50\u3001\u5220\u9664\u4F1A\u8BDD\u7B49\uFF09\u3002\u6587\u4EF6\uFF1A": "Not loaded yet. The trail records privileged actions (installing or removing plugins, writing hooks, deleting sessions). File: ",
  "\u6682\u65E0\u8BB0\u5F55\u3002": "No entries yet."
};
var I18N_NS = "dshAdmin";
var I18N_ZH = null;
var boundTranslate = null;
var localeActiveId = null;
var localeSetLocale = null;
var localeListeners = /* @__PURE__ */ new Set();
function subscribeLocale(listener) {
  localeListeners.add(listener);
  return function() {
    localeListeners.delete(listener);
  };
}
function activeLanguage() {
  if (localeActiveId !== null) return /^en\b/i.test(localeActiveId) ? "en" : "zh";
  return I18N_LANG;
}
function notifyLocaleListeners() {
  var snapshot = [];
  localeListeners.forEach(function(listener) {
    snapshot.push(listener);
  });
  for (var i = 0; i < snapshot.length; i += 1) {
    try {
      snapshot[i]();
    } catch (e) {
    }
  }
}
function readActiveLocaleId(locale) {
  try {
    var snapshot = typeof locale.getSnapshot === "function" ? locale.getSnapshot() : null;
    return snapshot !== null && typeof snapshot.active === "string" ? snapshot.active : null;
  } catch (e) {
    return null;
  }
}
function installLocaleRuntime(ctx) {
  var locale = typeof ctx.get === "function" ? ctx.get("locale") : void 0;
  if (locale === void 0 || locale === null) return function() {
  };
  if (typeof locale.register !== "function" || typeof locale.bind !== "function") return function() {
  };
  if (I18N_ZH === null) {
    I18N_ZH = {};
    for (var key in I18N_EN) I18N_ZH[key] = key;
  }
  var dispose = null;
  try {
    dispose = locale.register(I18N_NS, { zh: I18N_ZH, en: I18N_EN });
  } catch (e) {
    dispose = null;
  }
  boundTranslate = locale.bind(I18N_NS);
  localeActiveId = readActiveLocaleId(locale);
  localeSetLocale = typeof locale.setLocale === "function" ? function(id) {
    locale.setLocale(id);
  } : null;
  var unsubscribe = typeof locale.subscribe === "function" ? locale.subscribe(function() {
    localeActiveId = readActiveLocaleId(locale);
    notifyLocaleListeners();
  }) : null;
  return function() {
    if (typeof unsubscribe === "function") unsubscribe();
    boundTranslate = null;
    localeActiveId = null;
    localeSetLocale = null;
    if (typeof dispose === "function") dispose();
  };
}
function dshT(s) {
  if (boundTranslate !== null) {
    var bound = boundTranslate(s);
    return bound === void 0 || bound === null || bound === "" ? s : bound;
  }
  if (I18N_LANG !== "en") return s;
  var v = I18N_EN[s];
  return v === void 0 ? s : v;
}
function i18nSource(s) {
  if (activeLanguage() !== "en") return s;
  for (var k in I18N_EN) {
    if (I18N_EN[k] === s) return k;
  }
  return s;
}
function setAdminLang(lang) {
  var next = lang === "en" ? "en" : "zh";
  try {
    window.localStorage.setItem("dsh-admin-lang", next);
  } catch (e) {
  }
  if (localeSetLocale !== null) {
    localeSetLocale(next);
    return;
  }
  window.location.reload();
}
function currentLanguage() {
  return activeLanguage();
}

// lib/panel-ids.js
var PANEL_IDS = Object.freeze([
  "extensions",
  // 插件管理（官方已覆盖时自动让位）
  "mcp",
  // MCP 服务器
  "skills",
  // 技能
  "subagents",
  // 子智能体
  "commands",
  // 命令
  "hooks",
  // 钩子
  "sessions",
  // Web 与会话
  "webSearch",
  // Web 搜索
  "usage",
  // 用量仪表盘
  "automation",
  // 自动化（定时任务 / Webhook / 工作流）
  "todo"
  // 待办清单
]);
var PANEL_STATES = Object.freeze(["auto", "on", "off"]);

// src/client/native-coverage.js
var NATIVE_COVERAGE = Object.freeze([
  Object.freeze({
    panel: "extensions",
    label: "\u6269\u5C55\u63D2\u4EF6",
    official: "\u63D2\u4EF6\u4FA7\u8FB9\u680F\u9875 (ui-plugin-manager) + \u63D2\u4EF6\u5217\u8868\u9875\u7B7E (ui-settings-plugin-inventory)",
    since: "0.1.7",
    detect: function(ctx) {
      return hasSlotEntry(ctx, "sidebar.panellist", "plugins") || hasSlotEntry(ctx, "settings.plugins.tab", "all");
    }
  }),
  Object.freeze({
    panel: "mcp",
    label: "MCP \u670D\u52A1\u5668",
    official: "\u65E0\uFF08\u4EC5\u5BBF\u4E3B mcp-client\uFF09",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "skills",
    label: "\u6280\u80FD",
    official: "ui-skill\uFF08/ \u89E6\u53D1\u4E0E\u8C03\u7528\u5361\u7247\uFF09\uFF1B\u5168\u91CF\u6E05\u5355\u4ECD\u65E0\u5B98\u65B9\u9875",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "subagents",
    label: "\u5B50\u667A\u80FD\u4F53",
    official: "ui-settings-subagent\uFF08\u6DF1\u5EA6/\u5BB9\u91CF/\u6A21\u578B\uFF09\uFF1B\u7F16\u5199\u4FA7\u4ECD\u65E0\u5B98\u65B9\u9875",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "commands",
    label: "\u547D\u4EE4",
    official: "ui-commands\uFF08\u5BA2\u6237\u7AEF\u547D\u4EE4 API\uFF0C\u975E\u6587\u4EF6\u5316\u7BA1\u7406\uFF09",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "hooks",
    label: "\u94A9\u5B50",
    official: "\u65E0\uFF08\u5BBF\u4E3B hook \u534F\u8BAE + \u4E24\u4E2A\u6865\u5305\uFF0C\u5747\u65E0 UI\uFF09",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "sessions",
    label: "Web \u4E0E\u4F1A\u8BDD",
    official: "ui-workspace\uFF08\u6D4F\u89C8/\u5F52\u6863/\u91CD\u547D\u540D/\u5206\u53C9\uFF09\uFF1B\u6279\u5220/\u5BFC\u51FA/\u4F53\u68C0\u4ECD\u65E0\u5B98\u65B9\u9875",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "webSearch",
    label: "Web \u641C\u7D22",
    official: "ui-settings-web-search\uFF08\u5B98\u65B9 provider \u7684\u914D\u7F6E\u9875\uFF09\uFF1Bprovider \u5207\u6362\u4ECD\u65E0\u5B98\u65B9\u9875",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "usage",
    label: "\u7528\u91CF\u4EEA\u8868\u76D8",
    official: "\u65E0\uFF08dsh \u7684 token \u8BB0\u8D26\u53EA\u5B58\u5728\u4E8E\u4F1A\u8BDD\u65E5\u5FD7\uFF09",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "automation",
    label: "\u81EA\u52A8\u5316",
    official: "ui-schedule\uFF08\u4F1A\u8BDD\u7EA7\u4EFB\u52A1\uFF09\uFF1B\u5BBF\u4E3B\u7EA7 cron \u4E0E Webhook \u5165\u7AD9\u4ECD\u65E0\u5B98\u65B9\u9875",
    since: null,
    detect: function() {
      return false;
    }
  }),
  Object.freeze({
    panel: "todo",
    label: "\u5F85\u529E\u6E05\u5355",
    official: "ui-conversation TodoPanel\uFF08conversation.input.dock \u7684 todo \u6761\uFF09",
    since: "0.1.7",
    detect: function() {
      return false;
    }
    // overlay, not a duplicate: ours replaces the strip while it has data
  })
]);
var PANEL_IDS2 = PANEL_IDS;
if (NATIVE_COVERAGE.map(function(row) {
  return row.panel;
}).join(",") !== PANEL_IDS2.join(",")) {
  throw new Error("native-coverage: the coverage table must list exactly the configurable panels (" + PANEL_IDS2.join(", ") + "), in that order");
}
function hasSlotEntry(ctx, name, id) {
  try {
    if (ctx.slots === void 0 || ctx.slots === null || typeof ctx.slots.entries !== "function") return false;
    var entries = ctx.slots.entries(name);
    if (!Array.isArray(entries)) return false;
    for (var i = 0; i < entries.length; i += 1) {
      var options = entries[i] && entries[i].options;
      if (options !== void 0 && options !== null && options.id === id) return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}
function forcedPanels() {
  var forced = {};
  try {
    var raw = window.localStorage.getItem("dsh-admin-panels");
    if (typeof raw !== "string" || raw.trim() === "") return forced;
    var names = raw.split(",");
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i].trim();
      if (PANEL_IDS2.indexOf(name) !== -1) forced[name] = true;
    }
  } catch (error) {
  }
  return forced;
}
function resolveNativeCoverage(ctx) {
  var forced = forcedPanels();
  var active = {};
  var yielded = [];
  for (var i = 0; i < NATIVE_COVERAGE.length; i += 1) {
    var row = NATIVE_COVERAGE[i];
    active[row.panel] = true;
    if (forced[row.panel] === true) continue;
    var covered = false;
    try {
      covered = row.detect(ctx) === true;
    } catch (error) {
      covered = false;
    }
    if (covered) {
      active[row.panel] = false;
      yielded.push(row);
    }
  }
  return { active, yielded };
}

// src/client/impl.js
var createElement = import_react.default.createElement;
var useState = import_react.default.useState;
var useRef = import_react.default.useRef;
var useEffect = import_react.default.useEffect;
function useLocaleRevision() {
  var bump = useState(0)[1];
  useEffect(function() {
    return subscribeLocale(function() {
      bump(function(n) {
        return n + 1;
      });
    });
  }, []);
}
function withLocale(Component) {
  return function LocaleAwareSlot(props) {
    useLocaleRevision();
    return createElement(Component, props);
  };
}
function baseName(path) {
  if (path === null || path === "") return dshT("\uFF08\u65E0\u5DE5\u4F5C\u76EE\u5F55\uFF09");
  var parts = path.replace(/\\/g, "/").split("/");
  var last = parts[parts.length - 1];
  return last === "" ? parts[parts.length - 2] || path : last;
}
function formatDate(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  var d = new Date(ms);
  var pad = function(n) {
    return (n < 10 ? "0" : "") + String(n);
  };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function messageOf(error) {
  if (error !== null && typeof error === "object" && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  if (error === void 0 || error === null) return "";
  return JSON.stringify(error) ?? "";
}
function sectionState(initial) {
  var pair = useState(initial);
  var alive = useRef(false);
  function patch(partial) {
    pair[1](function(cur) {
      var next = {};
      for (var k in cur) next[k] = cur[k];
      for (var pk in partial) next[pk] = partial[pk];
      return next;
    });
  }
  function mount(reload) {
    useEffect(function() {
      alive.current = true;
      reload();
      return function() {
        alive.current = false;
      };
    }, []);
  }
  return { state: pair[0], set: pair[1], alive, patch, mount };
}
var activeToast = null;
function showToast(type, text, duration) {
  if (typeof document === "undefined") return;
  duration = duration || 3e3;
  function quit(state2) {
    if (state2.leaving) return;
    state2.leaving = true;
    clearTimeout(state2.timer);
    state2.el.classList.add("leaving");
    state2.removalTimer = setTimeout(function() {
      if (state2.el.parentNode) state2.el.parentNode.removeChild(state2.el);
      if (activeToast === state2) activeToast = null;
    }, 200);
  }
  var current = activeToast;
  if (current !== null && current.el.parentNode !== null) {
    clearTimeout(current.timer);
    clearTimeout(current.removalTimer);
    current.leaving = false;
    current.el.className = "dsh-admin-toast " + type;
    current.el.textContent = text;
    current.timer = setTimeout(function() {
      quit(current);
    }, duration);
    return;
  }
  var toast = document.createElement("div");
  toast.className = "dsh-admin-toast " + type;
  toast.textContent = text;
  document.body.appendChild(toast);
  var state = { el: toast, timer: null, removalTimer: null, leaving: false };
  activeToast = state;
  toast.addEventListener("click", function() {
    quit(state);
  });
  state.timer = setTimeout(function() {
    quit(state);
  }, duration);
}
function copyTextToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).then(function() {
      showToast("success", dshT("\u{1F4CB} \u4F1A\u8BDD ID \u5DF2\u590D\u5236"));
    }, function() {
      fallbackCopy(text);
    });
    return;
  }
  fallbackCopy(text);
}
function fallbackCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {
    showToast("error", dshT("\u274C \u590D\u5236\u5931\u8D25\uFF1A") + messageOf(e));
  }
}
function copyTextSilently(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text);
  }
  try {
    fallbackCopy(text);
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e);
  }
}
function downloadTextFile(filename, text) {
  if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error(dshT("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u6587\u4EF6\u4E0B\u8F7D"));
  }
  var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() {
    URL.revokeObjectURL(url);
  }, 1e3);
}
var SETTINGS_NAV_ICONS = {
  "\u6280\u80FD": '<path d="M8 4.6C6.9 3.6 5.3 3.2 3 3.3v8.4c2.3-.1 3.9.3 5 1.3 1.1-1 2.7-1.4 5-1.3V3.3c-2.3-.1-3.9.3-5 1.3z"/><path d="M8 4.6v8.4"/>',
  "MCP\u670D\u52A1\u5668": '<rect x="2.25" y="2.25" width="11.5" height="4.75" rx="1.2"/><rect x="2.25" y="9" width="11.5" height="4.75" rx="1.2"/><circle cx="5" cy="4.62" r="0.95" fill="currentColor" stroke="none"/><circle cx="5" cy="11.38" r="0.95" fill="currentColor" stroke="none"/>',
  "\u5B50\u667A\u80FD\u4F53": '<rect x="2.2" y="2.6" width="6" height="4.2" rx="1.2"/><rect x="7.8" y="9.2" width="6" height="4.2" rx="1.2"/><path d="M5.2 6.8v3a1.6 1.6 0 0 0 1.6 1.6h1"/>',
  "\u7528\u91CF\u4EEA\u8868\u76D8": '<path d="M3.5 13V8.5"/><path d="M8 13V3"/><path d="M12.5 13V6"/>',
  "\u81EA\u52A8\u5316": '<circle cx="8" cy="8" r="5.6"/><path d="M9.2 4.8L6.7 8.6h2.3l-2 3.3"/>',
  "Web \u4E0E\u4F1A\u8BDD": '<circle cx="7" cy="7" r="4.8"/><path d="M7 4.8V7l1.8 1.2"/><path d="M10.6 10.6l2.6 2.6"/>',
  "\u5DE5\u4F5C\u6D41": '<circle cx="4" cy="4" r="1.8"/><circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="8" r="1.8"/><path d="M5.8 4h2.4a2 2 0 0 1 2 2v.4M5.8 12h2.4a2 2 0 0 0 2-2v-.4"/>'
};
var SETTINGS_NAV_ICON_MARK = "data-dsh-admin-nav-icon";
function buildNavIconSvg(label, template) {
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute(SETTINGS_NAV_ICON_MARK, label);
  svg.innerHTML = template;
  return svg;
}
function setupSettingsNavIcons() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function() {
  };
  var repaint = function() {
    var dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (dialog === null) return;
    var nav = dialog.querySelector("nav");
    if (nav === null) return;
    var rows = nav.querySelectorAll("button");
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var labelSpan = row.querySelector("span");
      if (labelSpan === null) continue;
      var template = SETTINGS_NAV_ICONS[i18nSource(labelSpan.textContent)];
      if (template === void 0) continue;
      var stock = row.querySelector("svg");
      if (stock !== null) {
        if (stock.hasAttribute(SETTINGS_NAV_ICON_MARK)) continue;
        var replacement = buildNavIconSvg(labelSpan.textContent, template);
        replacement.setAttribute("class", stock.getAttribute("class") || "");
        row.replaceChild(replacement, stock);
      } else if (row.querySelector("svg[" + SETTINGS_NAV_ICON_MARK + '="' + labelSpan.textContent + '"]') === null) {
        row.insertBefore(buildNavIconSvg(labelSpan.textContent, template), row.firstChild);
      }
    }
  };
  var observer = new MutationObserver(repaint);
  observer.observe(document.body, { childList: true, subtree: true });
  repaint();
  return function() {
    observer.disconnect();
  };
}
function setupMenuInjection(call, refreshSessions) {
  if (typeof document === "undefined") return function() {
  };
  function sessionTitleFromRow(row) {
    var btn = row.querySelector(dshT('button[aria-label*="\u4F1A\u8BDD" i][aria-label*="\u64CD\u4F5C" i], button[aria-label*="session" i][aria-label*="actions" i]'));
    if (btn === null) return null;
    var label = btn.getAttribute("aria-label") || "";
    var zh = /会话["“]([^"”]+)["”]/.exec(label);
    if (zh) return zh[1].trim();
    var en = /session\s*["“]([^"”]+)["”]/i.exec(label);
    if (en) return en[1].trim();
    return label.replace(/^会话/, "").replace(/^session/i, "").replace(/["“”]|的操作|actions$/gi, "").trim() || null;
  }
  function rowForMenu(menuEl) {
    var menuRect = menuEl ? menuEl.getBoundingClientRect() : null;
    var allRows = document.querySelectorAll('[role="treeitem"]');
    if (allRows.length === 0) return null;
    var rows = [];
    for (var i = 0; i < allRows.length; i++) {
      var r = allRows[i];
      if (r.querySelector(dshT('button[aria-label*="\u4F1A\u8BDD" i][aria-label*="\u64CD\u4F5C" i], button[aria-label*="\u5DE5\u4F5C\u533A" i][aria-label*="\u64CD\u4F5C" i], button[aria-label*="session" i][aria-label*="actions" i], button[aria-label*="workspace" i][aria-label*="actions" i]'))) {
        rows.push(r);
      }
    }
    if (rows.length === 0) return null;
    if (menuRect === null || menuRect.height === 0) {
      if (rows.length === 1) return rows[0];
      return null;
    }
    var closest = rows[0];
    var closestDist = Infinity;
    for (var j = 0; j < rows.length; j++) {
      var rect = rows[j].getBoundingClientRect();
      if (rect.height === 0) continue;
      var rowCenter = rect.top + rect.height / 2;
      var dist = Math.abs(rowCenter - menuRect.top);
      if (dist < closestDist) {
        closestDist = dist;
        closest = rows[j];
      }
    }
    return closest;
  }
  function injectItems(menuEl) {
    if (menuEl.querySelector("[data-dsh-admin-injected]")) return;
    var text = menuEl.textContent || "";
    var isSession = text.indexOf("\u5F52\u6863\u4F1A\u8BDD") !== -1 || text.indexOf("Archive session") !== -1;
    var isWorkspace = !isSession && (text.indexOf("\u5220\u9664") !== -1 || text.indexOf("Delete workspace") !== -1);
    if (!isSession && !isWorkspace) return;
    var viewport = menuEl.querySelector('[role="presentation"]');
    if (viewport === null) return;
    var row = rowForMenu(menuEl);
    if (row === null) return;
    if (isSession) {
      let fetchSessions = function(done) {
        call("sessionAdmin/list", {}).then(function(listResult) {
          done(listResult && listResult.ok && listResult.value && listResult.value.sessions || []);
        }, function() {
          showToast("error", dshT("\u274C \u65E0\u6CD5\u52A0\u8F7D\u4F1A\u8BDD\u5217\u8868"));
        });
      }, norm = function(v) {
        return (v || "").replace(/\s+/g, " ").replace(/\.{3,}\s*$/, "").trim().toLowerCase();
      }, resolveSessionFuzzy = function(cb) {
        fetchSessions(function(sessions) {
          var match = null;
          var nt = norm(title);
          for (var i = 0; i < sessions.length; i++) {
            var s = sessions[i];
            var st = norm(s.title);
            if (st === nt) {
              match = s;
              break;
            }
            if (nt.length > 3 && st.indexOf(nt) !== -1) {
              match = s;
              break;
            }
            if (st.length > 3 && nt.indexOf(st) !== -1) {
              match = s;
              break;
            }
            var cwdBase = s.cwd ? s.cwd.replace(/\\/g, "/").split("/").pop() : "";
            if (cwdBase && (cwdBase === nt || nt.indexOf(cwdBase) !== -1 || cwdBase.indexOf(nt) !== -1)) {
              match = s;
              break;
            }
          }
          if (match === null) {
            showToast("error", dshT("\u274C \u672A\u627E\u5230\u5339\u914D\u7684\u4F1A\u8BDD"));
            return;
          }
          cb(match);
        });
      }, resolveSessionExact = function(cb) {
        fetchSessions(function(sessions) {
          var nt = norm(title);
          var exact = [];
          for (var i = 0; i < sessions.length; i++) {
            if (norm(sessions[i].title) === nt) exact.push(sessions[i]);
          }
          if (exact.length === 0) {
            showToast("error", dshT("\u274C \u672A\u627E\u5230\u5339\u914D\u7684\u4F1A\u8BDD"));
            return;
          }
          if (exact.length > 1) {
            showToast("error", dshT("\u274C \u5B58\u5728 ") + String(exact.length) + dshT(" \u4E2A\u540C\u540D\u4F1A\u8BDD\uFF0C\u65E0\u6CD5\u786E\u5B9A\u8981\u5220\u9664\u7684\u76EE\u6807\uFF1B\u8BF7\u5728 \u8BBE\u7F6E \u2192 \u5386\u53F2\u4F1A\u8BDD \u4E2D\u6309\u4F1A\u8BDD ID \u5220\u9664"));
            return;
          }
          cb(exact[0]);
        });
      };
      var title = sessionTitleFromRow(row);
      if (title === null) return;
      appendMenuItem(viewport, dshT("\u590D\u5236\u4F1A\u8BDD ID"), "normal", function() {
        resolveSessionFuzzy(function(session) {
          copyTextToClipboard(session.id);
        });
      });
      appendMenuItem(viewport, dshT("\u5220\u9664\u4F1A\u8BDD"), "danger", function() {
        resolveSessionExact(function(match) {
          var method = match.live ? "sessionAdmin/closeSession" : "sessionAdmin/deleteSession";
          call(method, { sessionId: match.id }).then(function(result) {
            if (result && result.ok) {
              showToast("success", dshT("\u{1F5D1}\uFE0F \u4F1A\u8BDD\u5DF2\u5220\u9664"));
              if (refreshSessions) refreshSessions();
            } else {
              showToast("error", dshT("\u274C \u5220\u9664\u4F1A\u8BDD\u5931\u8D25\uFF1A") + messageOf(result && result.error));
            }
          }, function(err) {
            showToast("error", dshT("\u274C \u5220\u9664\u4F1A\u8BDD\u5931\u8D25\uFF1A") + messageOf(err));
          });
        });
      }, dshT("\u26A0\uFE0F \u518D\u70B9\u4E00\u6B21\u786E\u8BA4\u5220\u9664\uFF08\u5728\u7EBF\u4F1A\u8BDD\u5C06\u5148\u5173\u505C\uFF09"));
    } else {
      var wsTitle = (row.querySelector('[class*="_title"]') || {}).textContent || "";
      wsTitle = wsTitle.trim();
      if (wsTitle === "") return;
      appendMenuItem(viewport, dshT("\u5728\u8D44\u6E90\u7BA1\u7406\u5668\u6253\u5F00"), "normal", function() {
        call("sessionAdmin/list", {}).then(function(listResult) {
          var workspaces = listResult && listResult.ok && listResult.value && listResult.value.workspaces || [];
          var wsPath = null;
          for (var i = 0; i < workspaces.length; i++) {
            var w = workspaces[i];
            var wTitle = w && w.title || "";
            if (wTitle === wsTitle || wsTitle !== "" && wTitle !== "" && (wsTitle.indexOf(wTitle) !== -1 || wTitle.indexOf(wsTitle) !== -1)) {
              wsPath = w && w.path;
              break;
            }
          }
          if (wsPath === null) {
            showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A\u672A\u627E\u5230\u5DE5\u4F5C\u533A\u8DEF\u5F84"));
            return;
          }
          call("fsAdmin/reveal", { path: wsPath }).then(function(result) {
            if (!(result && result.ok)) showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A") + messageOf(result && result.error));
          }, function(err) {
            showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A") + messageOf(err));
          });
        }, function() {
          showToast("error", dshT("\u274C \u6253\u5F00\u5931\u8D25\uFF1A\u65E0\u6CD5\u52A0\u8F7D\u5DE5\u4F5C\u533A\u5217\u8868"));
        });
      });
    }
  }
  function appendMenuItem(viewport, label, kind, onClick, confirmText) {
    var sep = document.createElement("div");
    sep.setAttribute("role", "separator");
    sep.setAttribute("data-dsh-admin-injected", "");
    sep.style.cssText = "margin:3px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(200,200,210,0.3))";
    viewport.appendChild(sep);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.setAttribute("data-dsh-admin-injected", "");
    btn.textContent = label;
    var color = kind === "danger" ? "#ef4444" : "inherit";
    var hoverBg = kind === "danger" ? "rgba(239,68,68,0.12)" : "rgba(200,200,210,0.3)";
    btn.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:" + color + ";border-radius:5px;text-align:left";
    btn.addEventListener("mouseenter", function() {
      btn.style.background = hoverBg;
    });
    btn.addEventListener("mouseleave", function() {
      btn.style.background = "transparent";
    });
    var armed = false;
    var disarmTimer = null;
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      if (confirmText === void 0) {
        onClick();
        return;
      }
      if (!armed) {
        armed = true;
        btn.textContent = confirmText;
        disarmTimer = setTimeout(function() {
          armed = false;
          btn.textContent = label;
        }, 4e3);
        return;
      }
      clearTimeout(disarmTimer);
      armed = false;
      btn.textContent = label;
      onClick();
    });
    viewport.appendChild(btn);
  }
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      if (!added || added.length === 0) continue;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        var el = (
          /** @type {Element} */
          node
        );
        if (el.getAttribute && el.getAttribute("role") === "menu") {
          injectItems(el);
        } else {
          var menu = el.querySelector && el.querySelector('[role="menu"]');
          if (menu) injectItems(menu);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return function() {
    observer.disconnect();
  };
}
var PANELS_CHUNK = "./client.panels.js";
var panelsModule = null;
var loaderRequire = (
  /** @type {any} */
  require
);
var panelsLoad = null;
var panelsError = null;
function loadPanels() {
  if (panelsLoad === null) {
    if (typeof loaderRequire.async !== "function") {
      panelsError = "this host does not serve client chunks";
      return Promise.reject(new Error("plugin-admin: " + panelsError));
    }
    panelsLoad = loaderRequire.async(PANELS_CHUNK).then(function(mod) {
      if (typeof mod.configure === "function") {
        mod.configure({
          currentLanguage,
          dshT,
          i18nSource,
          setAdminLang,
          baseName,
          formatDate,
          messageOf,
          sectionState,
          showToast,
          copyTextToClipboard,
          copyTextSilently,
          downloadTextFile
        });
      }
      panelsModule = mod;
      return mod;
    }).catch(function(error) {
      panelsError = messageOf(error);
      panelsLoad = null;
      throw error;
    });
  }
  return panelsLoad;
}
function lazyPanel(exportName) {
  return function LazyPanel(props) {
    var statePair = useState(panelsModule);
    var loaded = statePair[0];
    var setModule = statePair[1];
    var errorPair = useState(panelsError);
    var failure = errorPair[0];
    var setFailure = errorPair[1];
    var attemptPair = useState(0);
    var attempt = attemptPair[0];
    var setAttempt = attemptPair[1];
    useEffect(function() {
      var alive = true;
      if (loaded === null) {
        loadPanels().then(function() {
          if (alive) setModule(panelsModule);
        }).catch(function(error) {
          if (alive) setFailure(messageOf(error) || dshT("\u672A\u77E5\u9519\u8BEF"));
        });
      }
      return function() {
        alive = false;
      };
    }, [attempt, loaded]);
    var Component = loaded === null ? null : loaded[exportName];
    if (Component === void 0 || Component === null) {
      return createElement(
        "div",
        { className: "card", style: { padding: "12px", opacity: failure === null ? 0.7 : 1 } },
        failure === null ? dshT("\u52A0\u8F7D\u9762\u677F\u2026") : [
          dshT("\u9762\u677F\u52A0\u8F7D\u5931\u8D25\uFF1A") + failure,
          createElement("button", {
            key: "retry",
            className: "btn",
            style: { marginLeft: "8px" },
            onClick: function() {
              panelsLoad = null;
              setFailure(null);
              setAttempt(attempt + 1);
            }
          }, dshT("\u91CD\u8BD5"))
        ]
      );
    }
    return createElement(Component, props);
  };
}
function apply(ctx) {
  var coverage = resolveNativeCoverage(ctx);
  if (coverage.yielded.length > 0) {
    ctx.logger?.info?.("plugin-admin: \u5B98\u65B9\u5DF2\u8986\u76D6\uFF0C\u8BA9\u4F4D\u9762\u677F\uFF1A" + coverage.yielded.map(function(row) {
      return row.panel;
    }).join(", "));
  }
  ctx.effect(function() {
    return installLocaleRuntime(ctx);
  }, "plugin-admin: locale runtime");
  var call = function(method, args) {
    return ctx.connection.rpc.call("/api", method, { args });
  };
  var refreshSessions = null;
  try {
    var sessionsSvc = ctx.get && ctx.get("sessions");
    if (sessionsSvc && typeof sessionsSvc.refresh === "function") {
      refreshSessions = function() {
        sessionsSvc.refresh().catch(function() {
        });
      };
    }
  } catch (e) {
    refreshSessions = null;
  }
  var disposeSidebar = ctx.effect(function() {
    return setupMenuInjection(call, refreshSessions);
  });
  ctx.effect(function() {
    return setupSettingsNavIcons();
  });
  var POLICY_CACHE_KEY = "dsh-admin-panels-policy";
  var readPolicyCache = function() {
    try {
      var raw = window.localStorage.getItem(POLICY_CACHE_KEY);
      if (typeof raw !== "string" || raw === "") return {};
      var parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  };
  var writePolicyCache = function(states) {
    try {
      window.localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify(states));
    } catch (error) {
    }
  };
  var panelStates = readPolicyCache();
  var slotDisposed = false;
  ctx.effect(function() {
    return function() {
      slotDisposed = true;
    };
  }, "plugin-admin: slot lifecycle");
  var yielded = function(panel) {
    var state = panelStates[panel] || "auto";
    if (state === "off") return true;
    if (state === "on") return false;
    return coverage.active[panel] === false;
  };
  var SLOT_SPECS = [
    {
      panel: "extensions",
      slot: "settings.plugins.tab",
      options: {
        name: "settings.plugins.tab",
        id: "extensions",
        order: 20,
        label: function() {
          return dshT("\u6269\u5C55\u63D2\u4EF6");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("PluginsSection"))
    },
    {
      panel: "mcp",
      slot: "settings.plugins.tab",
      options: {
        name: "settings.plugins.tab",
        id: "mcp-servers",
        order: 40,
        label: function() {
          return dshT("MCP\u670D\u52A1\u5668");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("McpSection"))
    },
    {
      panel: "skills",
      slot: "settings.plugins.tab",
      options: {
        name: "settings.plugins.tab",
        id: "skills",
        order: 30,
        label: function() {
          return dshT("\u6280\u80FD");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("SkillsSection"))
    },
    {
      panel: "sessions",
      slot: "settings.section",
      options: {
        name: "settings.section",
        id: "web-sessions",
        order: 27,
        label: function() {
          return dshT("Web \u4E0E\u4F1A\u8BDD");
        },
        inject: function() {
          return { call, refreshSessions };
        }
      },
      component: withLocale(lazyPanel("WebSessionsSection"))
    },
    {
      panel: "subagents",
      slot: "settings.plugins.tab",
      options: {
        name: "settings.plugins.tab",
        id: "subagent-admin",
        order: 50,
        label: function() {
          return dshT("\u5B50\u667A\u80FD\u4F53");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("SubagentAdminSection"))
    },
    {
      panel: "commands",
      slot: "settings.plugins.tab",
      options: {
        name: "settings.plugins.tab",
        id: "ch-commands",
        order: 60,
        label: function() {
          return dshT("\u547D\u4EE4");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("ChCommandsSection"))
    },
    {
      panel: "hooks",
      slot: "settings.plugins.tab",
      options: {
        name: "settings.plugins.tab",
        id: "ch-hooks",
        order: 70,
        label: function() {
          return dshT("\u94A9\u5B50");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("ChHooksSection"))
    },
    {
      panel: "usage",
      slot: "settings.section",
      options: {
        name: "settings.section",
        id: "usage-dashboard",
        order: 28,
        label: function() {
          return dshT("\u7528\u91CF\u4EEA\u8868\u76D8");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("UsageDashboardSection"))
    },
    {
      panel: "automation",
      slot: "settings.section",
      options: {
        name: "settings.section",
        id: "automation",
        order: 29,
        label: function() {
          return dshT("\u81EA\u52A8\u5316");
        },
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("AutomationSection"))
    },
    {
      panel: "todo",
      slot: "conversation.input.dock",
      options: {
        name: "conversation.input.dock",
        id: "todo-admin",
        order: 5,
        inject: function() {
          return { call };
        }
      },
      component: withLocale(lazyPanel("TodoAdminDock"))
    }
  ];
  var injectDisposers = {};
  var registerDisposers = {};
  var installOne = function(spec) {
    if (slotDisposed || injectDisposers[spec.panel] !== void 0) return;
    injectDisposers[spec.panel] = ctx.slots.inject(spec.slot, function() {
      if (yielded(spec.panel)) return void 0;
      var dispose = ctx.slots.register(spec.options, spec.component);
      registerDisposers[spec.panel] = dispose;
      return dispose;
    });
  };
  var uninstallOne = function(panel) {
    var dispose = registerDisposers[panel];
    if (dispose === void 0) return;
    registerDisposers[panel] = void 0;
    try {
      dispose();
    } catch (error) {
    }
  };
  var reconcileSlots = function() {
    for (var i = 0; i < SLOT_SPECS.length; i += 1) {
      var spec = SLOT_SPECS[i];
      if (yielded(spec.panel)) {
        uninstallOne(spec.panel);
        continue;
      }
      installOne(spec);
    }
  };
  reconcileSlots();
  var ask = null;
  try {
    ask = call("pluginAdmin/panels", {});
  } catch (error) {
    ask = null;
  }
  if (ask !== null && typeof ask.then === "function") {
    ask.then(function(result) {
      var panels = result && result.ok !== false && result.value ? result.value.panels : null;
      if (panels === null || panels === void 0 || typeof panels !== "object") return;
      panelStates = panels;
      writePolicyCache(panels);
      reconcileSlots();
    }, function() {
    });
  }
}

// src/client/index.js
var inject = ["slots", "connection"];
return module.exports
} });

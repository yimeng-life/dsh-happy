#!/usr/bin/env node
/**
 * 一次性把插件改成"可发布"的包名。
 *
 * DSH 认包名，而包名同时出现在两个地方，必须完全一致：
 *   1. package.json 的 name
 *   2. cordis.patch.yml 里那一行的 name
 * 再加上 client.js 里 __ModuleLoader__.load({ id }) 的 id —— 宿主靠它找浏览器模块，
 * 也是同一份名字。漏任何一个的结果都是"装上了但没有效果"，所以用脚本一次改完。
 *
 * 注意：patch 行的 `id:`（现在是 `happy`）是内部行标识，不跟包名走，脚本不动它。
 *
 * 用法（在插件目录里跑）：
 *   node tools/rename.mjs dsh-happy
 *   node tools/rename.mjs @your-name/dsh-happy
 *
 * 改完记得：插件页卸载旧的 → 重新安装（新名字）→ 立即启用。
 */
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^(@[a-z0-9][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/;

const next = process.argv[2];
if (!next) {
  console.error('usage: node tools/rename.mjs <new-package-name>');
  process.exit(2);
}
if (!NAME_RE.test(next)) {
  console.error(`包名不合法：${next}`);
  console.error('只允许小写字母、数字、- . _ ~，可带一个 @scope/ 前缀。');
  process.exit(2);
}
if (next === '@local/happy') {
  console.error('这是本地开发用的占位名，不能发布到公共 registry。');
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, '..');
const pkgPath = path.join(root, 'package.json');
const clientPath = path.join(root, 'client.js');
const patchPath = path.join(root, 'cordis.patch.yml');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const previous = pkg.name;
pkg.name = next;
delete pkg.private;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const client = fs.readFileSync(clientPath, 'utf8');
if (!/id:\s*'[^']+'/.test(client)) {
  console.error('client.js 里没找到 id: \'...\'，脚本不继续，避免改坏。');
  process.exit(1);
}
fs.writeFileSync(clientPath, client.replace(/id:\s*'[^']+'/, `id: '${next}'`));

const patch = fs.readFileSync(patchPath, 'utf8');
if (!/name:\s*'[^']+'/.test(patch)) {
  console.error('cordis.patch.yml 里没找到 name: \'...\'，脚本不继续。');
  process.exit(1);
}
fs.writeFileSync(patchPath, patch.replace(/name:\s*'[^']+'/, `name: '${next}'`));

console.log(`包名：${previous}  ->  ${next}`);
console.log('已同步修改：package.json / client.js (__ModuleLoader__ id) / cordis.patch.yml');
console.log('下一步：');
console.log('  1. npm pack --dry-run         # 看会发出去哪些文件');
console.log('  2. npm login && npm publish   # 带 @scope 的加 --access public');
console.log('  3. 插件页卸载旧版本，用新包名重新安装');

#!/usr/bin/env node
/**
 * 发版前确认流程：
 * 1. 执行 nx release --dry-run 得到建议版本
 * 2. 展示建议版本，支持直接确认或手动输入新版本
 * 3. 用最终版本执行 nx release
 *
 * 用法: node scripts/release-with-confirm.mjs <group>
 * 例:   node scripts/release-with-confirm.mjs platform-packages
 */

import { spawn } from 'child_process';
import inquirer from 'inquirer';
import * as readline from 'readline';

const BASE_BRANCH = process.env.RELEASE_BASE_BRANCH || 'main';

const group = process.argv[2];
if (!group) {
  console.error('用法: node scripts/release-with-confirm.mjs <group>');
  console.error(
    '例:   node scripts/release-with-confirm.mjs platform-packages',
  );
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.capture ? 'pipe' : 'inherit',
      shell: false,
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    if (opts.capture && child.stdout)
      child.stdout.on('data', (d) => (stdout += d.toString()));
    if (opts.capture && child.stderr)
      child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (opts.capture) resolve({ code, stdout, stderr });
      else resolve(code);
    });
    child.on('error', reject);
  });
}

// 从 dry-run 输出中解析出建议的新版本号（第一个出现的 x.y.z）
function parseSuggestedVersion(stdout) {
  const m =
    stdout.match(/(?:get new version|New version)\s+(\d+\.\d+\.\d+)/i) ||
    stdout.match(/version\s+(\d+\.\d+\.\d+)\s+written/i);
  return m ? m[1] : null;
}

// 从 dry-run 输出中解析当前版本号
function parseCurrentVersion(stdout) {
  const m =
    stdout.match(/current version\s+(\d+\.\d+\.\d+)/i) ||
    stdout.match(/version\s+(\d+\.\d+\.\d+)\s+already resolved/i);
  return m ? m[1] : null;
}

// 基于当前版本计算 patch/minor/major 建议版本
function bumpVersion(current, type) {
  const parts = current.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  let [maj, min, pat] = parts;
  switch (type) {
    case 'patch':
      pat += 1;
      break;
    case 'minor':
      min += 1;
      pat = 0;
      break;
    case 'major':
      maj += 1;
      min = 0;
      pat = 0;
      break;
    default:
      return null;
  }
  return `${maj}.${min}.${pat}`;
}

async function isGitRepo() {
  try {
    const { stdout } = await run(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      { capture: true },
    );
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function isCleanWorkingTree() {
  try {
    const { stdout } = await run('git', ['status', '--porcelain'], {
      capture: true,
    });
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

async function prepareReleaseBranch({ group, version }) {
  const inRepo = await isGitRepo();
  if (!inRepo) {
    console.warn(
      '当前目录不是 git 仓库，跳过自动创建发布分支和 Pull Request。',
    );
    return null;
  }

  const clean = await isCleanWorkingTree();
  if (!clean) {
    console.warn(
      '工作区存在未提交修改，出于安全考虑将直接在当前分支上发版，不自动创建发布分支和 Pull Request。',
    );
    return null;
  }

  const branchName = `release/${group}/${version}`;
  console.log(`\n创建发布分支: ${branchName}\n`);
  const code = await run('git', ['checkout', '-b', branchName]);
  if (code !== 0) {
    console.warn(
      '创建发布分支失败，将继续在当前分支上发版，请稍后手动创建分支和 Pull Request。',
    );
    return null;
  }

  return { branchName };
}

async function pushBranchAndCreatePr({ group, version, branchName }) {
  if (!branchName) return;

  console.log('\n推送发布分支到远程...\n');
  const pushCode = await run('git', ['push', '-u', 'origin', branchName]);
  if (pushCode !== 0) {
    console.warn(
      '推送发布分支到远程失败，请检查远程仓库配置并手动推送，然后在远程创建 Pull Request。',
    );
    return;
  }

  const title = `chore(release): ${group} v${version}`;
  const body =
    '自动生成的发布 PR。请在合并前确认 Changelog 与版本号是否符合预期。';

  console.log('\n尝试通过 GitHub CLI 创建 Pull Request...\n');
  const prCode = await run('gh', [
    'pr',
    'create',
    '--title',
    title,
    '--body',
    body,
    '--base',
    BASE_BRANCH,
  ]);

  if (prCode !== 0) {
    console.warn(
      '使用 GitHub CLI 创建 Pull Request 失败，请确认已安装 gh 并登录，或在远程仓库中手动创建 Pull Request。',
    );
  }
}

// 从 dry-run 输出中截取 Changelog 预览（Previewing an entry ... 到 Running target 之前）
function extractChangelogPreview(stdout) {
  const start = stdout.indexOf('Previewing an entry in');
  if (start === -1) return '';
  const end =
    stdout.indexOf('Running target nx-release-publish') !== -1
      ? stdout.indexOf('Running target nx-release-publish')
      : stdout.indexOf('NOTE: The "dryRun"');
  if (end === -1) return stdout.slice(start).trim();
  let block = stdout.slice(start, end).trim();
  // 去掉行首的 "+ "，便于阅读
  return block
    .split('\n')
    .map((line) => (line.startsWith('+ ') ? line.slice(2) : line))
    .join('\n');
}

async function main() {
  console.log(`\n正在计算建议版本（dry-run）: --groups ${group}\n`);
  const { code, stdout } = await run(
    'npx',
    ['nx', 'release', '--groups', group, '--dry-run'],
    { capture: true },
  );
  if (code !== 0) {
    console.error('dry-run 未成功，请先解决错误再发版。');
    process.exit(code);
  }

  const suggested = parseSuggestedVersion(stdout);
  if (!suggested) {
    console.error('未能从 dry-run 输出中解析出版本号，请手动执行:');
    console.error(`  npx nx release --groups ${group} [版本号]`);
    process.exit(1);
  }

  const changelogPreview = extractChangelogPreview(stdout);
  if (changelogPreview) {
    console.log('\n--- 生成的 Changelog 预览 ---\n');
    console.log(changelogPreview);
    console.log('\n--- 确认版本 ---');
  } else {
    console.log('\n--- 确认版本 ---');
  }

  const current = parseCurrentVersion(stdout);
  if (current) {
    console.log(`当前版本: ${current}`);
    console.log(`建议版本(按提交计算): ${suggested}`);
  }

  // 构建 inquirer 的 choices：{ name, value }，name 为展示文案
  const choices = [];
  if (current) {
    const patch = bumpVersion(current, 'patch');
    const minor = bumpVersion(current, 'minor');
    const major = bumpVersion(current, 'major');
    if (patch) choices.push({ name: `patch  →  ${patch}`, value: patch });
    if (minor) choices.push({ name: `minor  →  ${minor}`, value: minor });
    if (major) choices.push({ name: `major  →  ${major}`, value: major });
  }
  choices.push({
    name: `使用建议版本  ${suggested}`,
    value: suggested,
  });
  choices.push(new inquirer.Separator());
  choices.push({ name: '自定义版本号（输入）', value: '__custom__' });
  choices.push({ name: '取消', value: '__cancel__' });

  // inquirer 13 的箭头列表类型为 select（不是 list），才能正确渲染选项
  const { choice } = await inquirer.prompt([
    {
      type: 'select',
      name: 'choice',
      message: '请用 上下箭头 选择本次要发布的版本，Enter 确认：',
      choices,
      default: suggested,
      pageSize: 15,
      loop: true,
    },
  ]);

  if (choice === '__cancel__') {
    console.log('已取消。');
    process.exit(0);
  }

  let version = choice;
  if (choice === '__custom__') {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    version = (await ask('输入版本号 (如 1.2.3): ')).trim();
    rl.close();
  }

  // 简单校验版本号格式
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    console.error('版本号格式应为 x.y.z 或 x.y.z-prerelease');
    process.exit(1);
  }

  // 在真正发版前，先创建发布分支，后续的版本号与 Changelog 提交都落在该分支上
  const branchInfo = await prepareReleaseBranch({ group, version });

  console.log(`\n执行发版: --groups ${group} ${version}\n`);
  const exitCode = await run('npx', [
    'nx',
    'release',
    '--groups',
    group,
    version,
    '--yes',
  ]);

  if (exitCode === 0 && branchInfo?.branchName) {
    await pushBranchAndCreatePr({
      group,
      version,
      branchName: branchInfo.branchName,
    });
  }

  process.exit(exitCode ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

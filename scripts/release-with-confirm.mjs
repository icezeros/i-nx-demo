#!/usr/bin/env node
/**
 * 发版前确认 + 自动建分支 + 自动创建 PR。
 *
 * 新版实现基于 Nx Release 的 Programmatic API，而不是 shell 调用 `nx release`：
 * - 先用 releaseVersion/releaseChangelog 做一次 dry-run，拿到「建议版本 + changelog 内容」用于交互确认
 * - 用户确认最终版本号（可选 patch/minor/major、自定义）
 * - 创建发布分支 `release/<group>/<version>`
 * - 在该分支上用 Programmatic API 依次执行：version → changelog → publish
 * - 最后自动 push 分支并用 `gh pr create` 创建 Pull Request
 *
 * 用法: node scripts/release-with-confirm.mjs <group>
 * 例:   node scripts/release-with-confirm.mjs platform-packages
 */

import { spawn } from 'child_process';
import inquirer from 'inquirer';
import * as readline from 'readline';
import {
  releaseChangelog,
  releasePublish,
  releaseVersion,
} from 'nx/release/index.js';

const BASE_BRANCH = process.env.RELEASE_BASE_BRANCH || 'main';

// 解析参数：支持 --verbose / -v，group 为第一个非选项参数
const args = process.argv.slice(2).filter((a) => a !== '--verbose' && a !== '-v');
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const group = args[0];
if (!group) {
  console.error('用法: node scripts/release-with-confirm.mjs <group> [--verbose]');
  console.error(
    '例:   node scripts/release-with-confirm.mjs platform-packages',
  );
  console.error('      node scripts/release-with-confirm.mjs platform-packages --verbose  # 显示 Nx 底层输出');
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
function getCurrentVersionFromProjects(projectsVersionData) {
  const all = Object.values(projectsVersionData ?? {});
  if (!all.length) return null;
  return all[0]?.currentVersion ?? null;
}

function printChangelogPreview({ workspaceChangelog, projectChangelogs }) {
  console.log('\n--- 生成的 Changelog 预览 ---\n');

  if (workspaceChangelog?.contents) {
    console.log(workspaceChangelog.contents);
  } else if (projectChangelogs && Object.keys(projectChangelogs).length > 0) {
    for (const [project, data] of Object.entries(projectChangelogs)) {
      console.log(`## ${project}\n`);
      // data 结构中通常有 contents 字段，这里做一下兜底
      // @ts-ignore
      console.log(data.contents ?? String(data));
      console.log('\n');
    }
  } else {
    console.log('（本次未生成任何 Changelog 内容）');
  }

  console.log('\n--- 确认版本 ---');
}

async function main() {
  // 发版前要求工作区干净，否则无法创建发布分支和 PR，且易产生半途中断
  const inRepo = await isGitRepo();
  if (inRepo) {
    const clean = await isCleanWorkingTree();
    if (!clean) {
      console.error(
        '\n错误：工作区存在未提交修改。发版前请先 commit 或 stash，以保证：\n' +
          '  1) 能创建发布分支 release/<group>/<version>\n' +
          '  2) 发版完成后能自动 push 并创建 Pull Request。\n\n' +
          '请执行: git status 查看修改，然后 git add/commit 或 git stash。\n',
      );
      process.exit(1);
    }
  }

  console.log(
    `\n正在计算建议版本（dry-run，使用 Nx Programmatic API）: group=${group}\n`,
  );

  // 1）用 Programmatic API 做一次 dry-run，拿到建议版本 + changelog 内容
  const {
    workspaceVersion: suggested,
    projectsVersionData,
    releaseGraph: dryRunReleaseGraph,
  } = await releaseVersion({
    groups: [group],
    dryRun: true,
    verbose,
  });

  if (!suggested) {
    console.error('未能计算出建议版本，请检查 nx.json 中的 release 配置。');
    process.exit(1);
  }

  const changelogResult = await releaseChangelog({
    groups: [group],
    releaseGraph: dryRunReleaseGraph,
    versionData: projectsVersionData,
    version: suggested,
    dryRun: true,
    verbose,
  });

  printChangelogPreview(changelogResult);

  const current = getCurrentVersionFromProjects(projectsVersionData);
  if (current) {
    console.log(`当前版本: ${current}`);
    console.log(`建议版本(按 conventional commits 计算): ${suggested}`);
  }

  // 2）交互式选择最终版本号
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

  // 3）创建发布分支，让后续所有改动都发生在该分支上
  const branchInfo = await prepareReleaseBranch({ group, version });

  console.log(
    `\n开始正式发版（Programmatic API）: group=${group}, version=${version}\n`,
  );
  console.log(
    '（会依次：更新 package.json → 更新 package-lock.json → 生成 CHANGELOG，请勿中途 Ctrl+C）\n',
  );

  // 4）正式版本阶段（不再 dry-run），这里显式传入 specifier=version
  const {
    workspaceVersion,
    projectsVersionData: finalProjectsVersionData,
    releaseGraph,
  } = await releaseVersion({
    groups: [group],
    specifier: version,
    dryRun: false,
    verbose,
  });

  // 5）正式生成并写入 changelog
  await releaseChangelog({
    groups: [group],
    releaseGraph,
    versionData: finalProjectsVersionData,
    version: workspaceVersion,
    dryRun: false,
    verbose,
  });

  // 6）执行 publish（如果你的 nx release 配置里没有配置 publish，则这里会很快结束或跳过）
  const publishResults = await releasePublish({
    groups: [group],
    releaseGraph,
    dryRun: false,
    verbose,
  });

  const allOk = Object.values(publishResults).every(
    (result) => result.code === 0,
  );

  // 7）push 分支并创建 PR（只在版本/Changelog/Publish 全部成功时执行）
  if (allOk && branchInfo?.branchName) {
    await pushBranchAndCreatePr({
      group,
      version: workspaceVersion ?? version,
      branchName: branchInfo.branchName,
    });
  } else if (!allOk) {
    console.warn('部分项目发布失败，已跳过自动创建 PR，请检查上面的日志。');
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

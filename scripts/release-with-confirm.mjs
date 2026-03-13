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
import * as readline from 'readline';

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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  const answer = await ask(
    `建议版本: ${suggested}\n` +
      `  [Enter/Y] 使用建议版本并执行发版\n` +
      `  [n]       取消\n` +
      `  或输入新版本号 (如 1.2.0): `,
  );
  rl.close();

  const trimmed = answer.trim().toLowerCase();
  if (trimmed === 'n' || trimmed === 'no') {
    console.log('已取消。');
    process.exit(0);
  }

  const version =
    trimmed === '' || trimmed === 'y' || trimmed === 'yes'
      ? suggested
      : trimmed;

  // 简单校验版本号格式
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    console.error('版本号格式应为 x.y.z 或 x.y.z-prerelease');
    process.exit(1);
  }

  console.log(`\n执行发版: --groups ${group} ${version}\n`);
  const exitCode = await run('npx', [
    'nx',
    'release',
    '--groups',
    group,
    version,
    '--yes',
  ]);
  process.exit(exitCode ?? 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

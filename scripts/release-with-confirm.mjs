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
      shell: true,
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log('\n--- 确认版本 ---');
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

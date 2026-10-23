#!/usr/bin/env node
/**
 * build-apps.mjs — builds the two String Music products from one codebase.
 *
 *   String Music Simple  (com.stringmusic.simple)  → Google Play
 *       web/simple/* only, ELITE_BUILD = false, no network permission,
 *       no streaming code in the binary.
 *
 *   String Music Elite   (com.stringmusic.elite)   → GitHub Releases
 *       the full web app, ELITE_BUILD = true.
 *
 * Usage:
 *   node tools/build-apps.mjs simple
 *   node tools/build-apps.mjs elite
 *   node tools/build-apps.mjs both
 *   node tools/build-apps.mjs both --release
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'mobile', 'android');
const assetsDir = (edition) =>
  path.join(androidDir, 'app', 'src', edition, 'assets', 'public');
const distDir = path.join(root, 'dist');

const args = process.argv.slice(2);
const editionArg = args.find((a) => !a.startsWith('--')) || 'both';
const release = args.includes('--release');
const editions = editionArg === 'both' ? ['simple', 'elite'] : [editionArg];

if (!editions.every((e) => e === 'simple' || e === 'elite')) {
  console.error('Usage: node tools/build-apps.mjs [simple|elite|both] [--release]');
  process.exit(1);
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      copyDir(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

/** Writes js/build-config.js with the edition flag forced to `elite`. */
function writeBuildConfig(targetDir, elite, sourceDir) {
  const source = path.join(sourceDir, 'js', 'build-config.js');
  let text = fs.readFileSync(source, 'utf8');
  text = text.replace(
    /^const ELITE_BUILD = (true|false);/m,
    `const ELITE_BUILD = ${elite};`
  );
  const dest = path.join(targetDir, 'js', 'build-config.js');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
}

function stage(edition) {
  const target = assetsDir(edition);
  rmrf(target);
  fs.mkdirSync(target, { recursive: true });

  if (edition === 'elite') {
    // Full app: everything under web/ (the Simple shell lives in web/simple).
    copyDir(path.join(root, 'web'), target);
    rmrf(path.join(target, 'simple'));
    writeBuildConfig(target, true, path.join(root, 'web'));
  } else {
    // Local-only shell: index.html + its two files + the shared flag.
    for (const file of ['index.html', 'simple.css', 'simple.js']) {
      fs.copyFileSync(
        path.join(root, 'web', 'simple', file),
        path.join(target, file)
      );
    }
    writeBuildConfig(target, false, path.join(root, 'web'));
  }

  console.log(`staged ${edition} → ${path.relative(root, target)}`);
  return target;
}

function flavorVersion(edition) {
  const gradle = fs.readFileSync(
    path.join(androidDir, 'app', 'build.gradle'),
    'utf8'
  );
  const block = gradle.match(
    new RegExp(`${edition}\\s*\\{\\s*dimension[\\s\\S]*?versionName\\s+"([^"]+)"`)
  );
  return block ? block[1] : '0.0.0';
}

function gradleTask(edition) {
  const cap = edition.charAt(0).toUpperCase() + edition.slice(1);
  return `assemble${cap}${release ? 'Release' : 'Debug'}`;
}

function apkPath(edition) {
  const variant = release ? 'release' : 'debug';
  return path.join(
    androidDir, 'app', 'build', 'outputs', 'apk', edition, variant,
    `app-${edition}-${variant}.apk`
  );
}

/** Gradle 8.2.1 needs JDK 17; a JDK 24 on PATH fails the build outright. */
function resolveJavaHome() {
  const current = process.env.JAVA_HOME;
  if (current && /jdk-?17|jdk17|17\./i.test(current) && fs.existsSync(current)) {
    return current;
  }
  const bundled = path.join(root, '.tools', 'jdk17');
  if (fs.existsSync(bundled)) {
    const entry = fs.readdirSync(bundled).find((name) => name.startsWith('jdk'));
    if (entry) return path.join(bundled, entry);
  }
  return current || null;
}

const javaHome = resolveJavaHome();
if (javaHome) {
  process.env.JAVA_HOME = javaHome;
  console.log(`JAVA_HOME=${javaHome}`);
} else {
  console.warn('⚠ No JDK 17 found — Gradle 8.2.1 may reject a newer JDK.');
}

fs.mkdirSync(distDir, { recursive: true });

for (const edition of editions) {
  stage(edition);
  const task = gradleTask(edition);
  console.log(`\n▶ ${task}`);
  const gradlew = path.join(
    androidDir,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  );
  const gradleArgs = [task, '--parallel', '--build-cache'];
  if (process.platform === 'win32') {
    // The workspace path can contain spaces, so hand cmd one quoted command.
    const cmd = `"${gradlew}" ${gradleArgs.join(' ')}`;
    const result = spawnSync(cmd, {
      cwd: androidDir,
      stdio: 'inherit',
      shell: true,
    });
    if (result.status !== 0) {
      console.error(`✗ gradle failed (${task})`);
      process.exit(result.status || 1);
    }
  } else {
    execFileSync(gradlew, gradleArgs, { cwd: androidDir, stdio: 'inherit' });
  }

  const built = apkPath(edition);
  if (!fs.existsSync(built)) {
    console.error(`✗ expected APK missing: ${built}`);
    process.exit(1);
  }
  const version = flavorVersion(edition);
  const out = path.join(
    distDir,
    `string-music-${edition}-${version}${release ? '' : '-debug'}.apk`
  );
  fs.copyFileSync(built, out);
  console.log(`✓ ${path.relative(root, out)}`);
}

#!/usr/bin/env node
/**
 * Cross-platform installer for dsh-cost-pill.
 *
 * The plugin ships as plain ESM with zero runtime dependencies and a prebuilt
 * browser bundle, so installing it needs no package manager and no build step.
 * This script does the two things a dsh profile actually needs:
 *
 *   1. expose the package inside the profile's node_modules (a link, so edits
 *      to the clone apply immediately);
 *   2. register the package in `dsh.profile.bundles`, the ordered list of
 *      bundle patch layers the profile boots with — a dependency alone is not
 *      enough, its `cordis.patch.yml` never reaches the Loader otherwise.
 *
 * Usage:
 *   node install.mjs [--profile web] [--dry-run]
 *
 * Environment:
 *   DSH_HOME     overrides ~/.dsh
 *   DSH_PROFILE  default profile name when --profile is absent
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'dsh-cost-pill';
const source = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const profileFlag = argv.indexOf('--profile');
const profile =
  profileFlag === -1 ? process.env.DSH_PROFILE || 'web' : argv[profileFlag + 1];

if (profileFlag !== -1 && profile === undefined) {
  fail('--profile needs a value');
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const profileDir = join(dshHome, 'profiles', profile);
const manifestPath = join(profileDir, 'package.json');

if (!existsSync(manifestPath)) {
  fail(
    `no profile manifest at ${manifestPath}\n` +
      `start dsh once with --profile ${profile} (or pass --profile) so the profile exists.`
  );
}

console.log(`source : ${source}`);
console.log(`profile: ${profileDir}`);

/* ---- 1. Expose the package in the profile's node_modules -------------- */
const modulePath = join(profileDir, 'node_modules', PACKAGE);
removeEntry(modulePath);
if (dryRun) {
  console.log(`[dry-run] link ${modulePath} -> ${source}`);
} else {
  mkdirSync(dirname(modulePath), { recursive: true });
  symlinkSync(source, modulePath, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`linked : ${modulePath} -> ${source}`);
}

/* ---- 2. Register the bundle layer ------------------------------------ */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.dependencies = manifest.dependencies || {};
manifest.dependencies[PACKAGE] = 'file:' + source.replace(/\\/g, '/');

manifest.dsh = manifest.dsh || {};
manifest.dsh.profile = manifest.dsh.profile || {};
const bundles = manifest.dsh.profile.bundles || (manifest.dsh.profile.bundles = []);
const added = !bundles.includes(PACKAGE);
if (added) bundles.push(PACKAGE);

const next = JSON.stringify(manifest, undefined, 2) + '\n';
if (dryRun) {
  console.log(`[dry-run] ${manifestPath}\n${next}`);
} else {
  writeFileSync(manifestPath, next, 'utf8');
  console.log(
    added ? `bundle : registered "${PACKAGE}" in dsh.profile.bundles`
          : `bundle : "${PACKAGE}" already registered`
  );
}

console.log('');
console.log('Done. Restart dsh web so the client bundle is assembled again:');
console.log(`  restart-dsh.ps1            (Windows)`);
console.log(`  dsh --profile ${profile}    (any platform; then reload the page)`);
console.log('Then hard-refresh the page (Ctrl+Shift+R).');

/** Remove a previous link or installed copy without following it. */
function removeEntry(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    return; // absent
  }
  if (dryRun) return;
  if (stat.isSymbolicLink()) {
    try {
      unlinkSync(path);
      return;
    } catch (error) {
      /* junction removal falls through to rmdir */
    }
  }
  rmSync(path, { recursive: true, force: true });
}

function fail(message) {
  console.error(`install: ${message}`);
  process.exit(1);
}

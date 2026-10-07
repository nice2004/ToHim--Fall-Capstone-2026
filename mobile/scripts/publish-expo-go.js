#!/usr/bin/env node
/**
 * Publish the current app code as an EAS Update that anyone can open in Expo Go by scanning
 * one permanent QR code — no laptop or dev server needed. The QR code always loads the latest
 * update on the `expo-go` channel, so re-running this script updates what testers get.
 *
 * Usage (from mobile/):
 *   npm run publish:expo-go
 *   npm run publish:expo-go -- "Sprint 2: verse search fixes"     # custom update message
 *
 * Safe for TestFlight/EAS builds: see app.config.js. These updates use the `exposdk:<SDK>`
 * runtime version and their own channel, so store builds (runtime "1.0.0") never receive them.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const MOBILE_DIR = path.resolve(__dirname, '..');
const CHANNEL = 'expo-go';
const appJson = require(path.join(MOBILE_DIR, 'app.json')).expo;
const projectId = appJson.extra.eas.projectId;
const apiBaseUrl = appJson.extra.apiBaseUrl;
const sdkMajor = require(path.join(MOBILE_DIR, 'node_modules', 'expo', 'package.json')).version.split('.')[0];
const runtimeVersion = `exposdk:${sdkMajor}.0.0`;

const message =
  process.argv.slice(2).join(' ').trim() ||
  `Expo Go preview ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

console.log(`Publishing ToHim to the "${CHANNEL}" channel for Expo Go (${runtimeVersion}).`);
console.log(`The app will talk to: ${apiBaseUrl}\n`);

const result = spawnSync(
  'eas',
  ['update', '--channel', CHANNEL, '--message', JSON.stringify(message)],
  {
    cwd: MOBILE_DIR,
    stdio: 'inherit',
    shell: true, // finds eas.cmd on Windows
    env: {
      ...process.env,
      EXPO_GO_UPDATE: '1', // app.config.js: use the Expo Go runtime version
      // Always bake the deployed backend into the shared QR build, even if this shell has a
      // local override set for development.
      EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
    },
  }
);

if (result.error || result.status !== 0) {
  if (result.error && result.error.code === 'ENOENT') {
    console.error('\nCould not find the EAS CLI. Install it with: npm install -g eas-cli');
  } else {
    console.error('\nPublishing failed (see the EAS output above). Nothing was changed for testers.');
  }
  process.exit(result.status || 1);
}

const query = `projectId=${projectId}&runtimeVersion=${encodeURIComponent(runtimeVersion)}&channel=${CHANNEL}`;
console.log('\nPublished. Testers with Expo Go can scan this QR code (it never changes):');
console.log(`  https://qr.expo.dev/eas-update?slug=exp&${query}`);
console.log('Or open this link on a phone that has Expo Go:');
console.log(`  exp://u.expo.dev/${projectId}?runtime-version=${encodeURIComponent(runtimeVersion)}&channel-name=${CHANNEL}`);

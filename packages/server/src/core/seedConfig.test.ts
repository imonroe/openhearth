import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { seedConfigDir } from './seedConfig.js';

let root: string;
let seedDir: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oh-seed-'));
  seedDir = path.join(root, 'seed');
  fs.mkdirSync(seedDir);
  fs.writeFileSync(path.join(seedDir, 'openhearth.yaml'), 'server:\n  port: 8080\n');
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('seedConfigDir', () => {
  it('seeds a missing config directory', () => {
    const configDir = path.join(root, 'config');
    const result = seedConfigDir(configDir, seedDir);
    expect(result.seeded).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'openhearth.yaml'))).toBe(true);
  });

  it('seeds an empty config directory', () => {
    const configDir = path.join(root, 'config');
    fs.mkdirSync(configDir);
    expect(seedConfigDir(configDir, seedDir).seeded).toBe(true);
  });

  it('leaves a non-empty config directory untouched', () => {
    const configDir = path.join(root, 'config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'openhearth.yaml'), 'server:\n  port: 9999\n');
    const result = seedConfigDir(configDir, seedDir);
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('config-not-empty');
    // user file preserved
    expect(fs.readFileSync(path.join(configDir, 'openhearth.yaml'), 'utf8')).toContain('9999');
  });

  it('reports when there is no seed directory', () => {
    const result = seedConfigDir(path.join(root, 'config'), path.join(root, 'nope'));
    expect(result).toEqual({ seeded: false, reason: 'no-seed-dir' });
  });
});

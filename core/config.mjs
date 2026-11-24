import os from 'node:os';
import { readJson, readYaml, writeJsonAtomic } from './fsutil.mjs';
import { paths } from './paths.mjs';

// Settings come from three layers, later ones winning:
//   1. defaults below
//   2. team/team.yaml (from the team pack: shared defaults and caps)
//   3. ~/.stacked-studio/config.json (this person's own choices)

export const DEFAULTS = {
  image_provider: null, // null = the first one with a key; falls back to the free test provider
  image_model: null,
  video_provider: null,
  daily_cap_usd: 5,
  aspect: '4:5',
  size: '1K',
};

export function teamConfig() {
  return readYaml(paths().teamConfig, {}) ?? {};
}

export function userConfig() {
  return readJson(paths().userConfig, {}) ?? {};
}

export function settings() {
  const team = teamConfig().defaults ?? {};
  const mine = userConfig();
  const pick = (k) => mine[k] ?? team[k] ?? DEFAULTS[k];
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, pick(k)]));
}

export function setUserSetting(key, value) {
  if (!(key in DEFAULTS) && key !== 'author') throw new Error(`Unknown setting "${key}". Known: ${[...Object.keys(DEFAULTS), 'author'].join(', ')}.`);
  const cfg = userConfig();
  if (value === null || value === undefined) delete cfg[key];
  else cfg[key] = value;
  writeJsonAtomic(paths().userConfig, cfg);
}

/** Who made a record. Defaults to the computer's user name; set with `studio config author "Name"`. */
export function author() {
  return userConfig().author ?? process.env.STACKED_AUTHOR ?? os.userInfo().username;
}

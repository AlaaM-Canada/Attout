'use strict';
// Simple JSON-file store. Good enough for a demo; swap for a database later.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SEED_DIR = path.join(__dirname, '..', 'data');

function filePath(name) { return path.join(DATA_DIR, name); }

function readJson(name, fallback) {
  const p = filePath(name);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    // On a fresh deploy with DATA_DIR set, copy the seed file from the repo.
    const seed = path.join(SEED_DIR, name);
    if (DATA_DIR !== SEED_DIR && fs.existsSync(seed)) {
      const v = JSON.parse(fs.readFileSync(seed, 'utf8'));
      writeJson(name, v);
      return v;
    }
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const p = filePath(name);
  fs.writeFileSync(p + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(p + '.tmp', p);
}

const store = {
  inventory: {
    all() { return readJson('inventory.json', []); },
    get(id) { return this.all().find((c) => c.id === id) || null; },
    remove(id) { writeJson('inventory.json', this.all().filter((c) => c.id !== id)); },
    save(car) {
      const all = this.all();
      const i = all.findIndex((c) => c.id === car.id);
      if (i === -1) all.push(car); else all[i] = car;
      writeJson('inventory.json', all);
      return car;
    }
  },
  audit: {
    all() { return readJson('audit.json', []); },
    add(entry) {
      const all = this.all();
      all.unshift(Object.assign({ at: new Date().toISOString(), user: 'Owner' }, entry));
      writeJson('audit.json', all.slice(0, 500));
      return all[0];
    }
  },
  cache: {
    get(key, maxAgeMs) {
      const all = readJson('cache.json', {});
      const hit = all[key];
      if (!hit) return null;
      if (Date.now() - new Date(hit.at).getTime() > maxAgeMs) return null;
      return hit;
    },
    set(key, value) {
      const all = readJson('cache.json', {});
      all[key] = { at: new Date().toISOString(), value };
      writeJson('cache.json', all);
    },
    keys() { return Object.keys(readJson('cache.json', {})); }
  }
};

module.exports = store;

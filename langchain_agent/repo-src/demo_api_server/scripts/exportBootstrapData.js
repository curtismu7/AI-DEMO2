const fs = require('fs');
const path = require('path');
const dataStore = require('../data/store');

/** Convert Date objects to ISO strings for JSON output. */
function toSerializableSnapshot(snapshot) {
  return JSON.parse(
    JSON.stringify(snapshot, (_key, value) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    })
  );
}

/** Resolve output path from arg/env/default. */
function resolveOutputPath() {
  const argPath = process.argv[2];
  if (argPath) return path.resolve(process.cwd(), argPath);
  if (process.env.BANKING_BOOTSTRAP_FILE) return path.resolve(process.cwd(), process.env.BANKING_BOOTSTRAP_FILE);
  return path.resolve(__dirname, '..', 'data', 'bootstrapData.json');
}

/** Export current runtime memory data to bootstrap JSON. */
function run() {
  const outputPath = resolveOutputPath();
  const snapshot = toSerializableSnapshot(dataStore.getSnapshot());
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`[bootstrap-export] Wrote snapshot to ${outputPath}`);
}

run();

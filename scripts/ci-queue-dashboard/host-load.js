'use strict';

const { execFile: nodeExecFile } = require('node:child_process');
const nodeOs = require('node:os');

// The runners share this Mac with everything else on it. A slow CI job is
// usually explained here (load well above the core count, and by what) rather
// than in the job itself.

function processName(command) {
  const text = String(command || '').trim();
  const app = /\/([^/]+)\.app\//.exec(text);
  if (app) return app[1];
  return text.split('/').at(-1).split(' ')[0] || 'process';
}

function parseTopProcesses(output, limit = 5) {
  return String(output || '').split(/\r?\n/).map((line) => {
    const match = /^\s*([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) return null;
    return { name: processName(match[3]), cpuPercent: Number(match[1]), memMb: Math.round(Number(match[2]) / 1024) };
  }).filter(Boolean).slice(0, limit);
}

function readHostLoad({ execFile = nodeExecFile, os = nodeOs, platform = process.platform } = {}) {
  const base = { load1: Number(os.loadavg()[0].toFixed(1)), cores: os.cpus().length, top: [] };
  if (platform !== 'darwin' && platform !== 'linux') return Promise.resolve(base);
  return new Promise((resolve) => {
    // Fixed arguments, no shell. -r sorts by CPU on macOS; --sort does on Linux.
    const args = platform === 'darwin' ? ['-Ao', 'pcpu=,rss=,comm=', '-r'] : ['-eo', 'pcpu=,rss=,comm=', '--sort=-pcpu'];
    execFile('ps', args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? base : { ...base, top: parseTopProcesses(stdout) });
    });
  });
}

module.exports = { parseTopProcesses, processName, readHostLoad };

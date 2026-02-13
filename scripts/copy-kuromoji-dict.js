#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const sourceDir = path.join(rootDir, "node_modules", "kuromoji", "dict");
const targetDir = path.join(rootDir, "public", "dict");

if (!fs.existsSync(sourceDir)) {
  console.error("kuromoji dictionary not found. Run `npm install` first.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

console.log(`Copied dictionary: ${sourceDir} -> ${targetDir}`);


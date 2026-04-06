import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Please provide a valid semantic version. Example: npm run bump 1.0.12");
  process.exit(1);
}

const filesToUpdate = [
  {
    path: 'package.json',
    replace: (content) => content.replace(/"version": ".*?"/, `"version": "${newVersion}"`)
  },
  {
    path: 'src-tauri/tauri.conf.json',
    replace: (content) => content.replace(/"version": ".*?"/, `"version": "${newVersion}"`)
  },
  {
    path: 'src-tauri/Cargo.toml',
    replace: (content) => content.replace(/version = ".*?"/, `version = "${newVersion}"`)
  }
];

filesToUpdate.forEach(file => {
  const filePath = path.join(rootDir, file.path);
  if (fs.existsSync(filePath)) {
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    const newContent = file.replace(originalContent);
    if (originalContent !== newContent) {
      fs.writeFileSync(filePath, newContent);
      console.log(`✅ Updated ${file.path} to ${newVersion}`);
    } else {
      console.log(`ℹ️ No changes needed for ${file.path}`);
    }
  } else {
    console.warn(`⚠️ Could not find ${filePath}`);
  }
});

console.log(`\n🎉 Successfully bumped all module versions to ${newVersion}!\nRun "npm install && cd src-tauri && cargo check" to re-generate the lockfiles.`);

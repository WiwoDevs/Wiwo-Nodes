import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  console.error("npm_execpath is unavailable; run this command through npm scripts.");
  process.exit(1);
}

const cleanEnvironment = { ...process.env };

// npm exposes user-level allow-scripts as a project-scoped environment value
// to nested npm processes. npm 11 rejects that value before running commands
// such as audit or sbom, so let the child read the original user config instead.
for (const key of Object.keys(cleanEnvironment)) {
  if (key.toLowerCase() === "npm_config_allow_scripts") {
    delete cleanEnvironment[key];
  }
}

const result = spawnSync(process.execPath, [npmCli, ...process.argv.slice(2)], {
  env: cleanEnvironment,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function prepareSite({ sourceHtmlPath, siteDir }) {
  const indexPath = path.join(siteDir, "index.html");
  fs.mkdirSync(siteDir, { recursive: true });
  fs.copyFileSync(sourceHtmlPath, indexPath);
  fs.writeFileSync(path.join(siteDir, ".nojekyll"), "", "utf8");
  return { indexPath };
}

function runGh(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input
  });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, command) {
  if (result.status === 0) return;
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  throw new Error(`${command} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
}

function readExistingDashboard({ repository, runCommand, options }) {
  const result = runCommand("gh", [
    "api",
    `repos/${repository}/contents/site/index.html`
  ], options);
  if (result.status === 0) {
    const payload = JSON.parse(result.stdout);
    return {
      content: Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8"),
      sha: payload.sha
    };
  }
  if (result.status === 1 && /Not Found|404/i.test(`${result.stderr || ""}\n${result.stdout || ""}`)) {
    return null;
  }
  requireSuccess(result, "gh api get dashboard");
}

function publishDashboard({
  sourceHtmlPath,
  projectRoot,
  repository,
  runCommand = runGh,
  commitMessage = "Publish dashboard"
}) {
  const { indexPath } = prepareSite({
    sourceHtmlPath,
    siteDir: path.join(projectRoot, "site")
  });
  const options = { cwd: projectRoot };
  const existing = readExistingDashboard({ repository, runCommand, options });
  const content = fs.readFileSync(indexPath, "utf8");
  if (existing && existing.content === content) return { indexPath, published: false };

  const body = {
    message: commitMessage,
    content: Buffer.from(content, "utf8").toString("base64")
  };
  if (existing) body.sha = existing.sha;
  requireSuccess(runCommand("gh", [
    "api",
    "--method",
    "PUT",
    `repos/${repository}/contents/site/index.html`,
    "--input",
    "-"
  ], { ...options, input: JSON.stringify(body) }), "gh api publish dashboard");
  return { indexPath, published: true };
}

module.exports = { prepareSite, publishDashboard };

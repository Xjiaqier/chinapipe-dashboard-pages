"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAX_GITHUB_API_ATTEMPTS = 4;

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

function waitForRetry(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isTransientGitHubApiFailure(result) {
  if (result?.error) {
    return true;
  }

  const detail = [result?.stderr, result?.stdout].filter(Boolean).join("\n");
  return /HTTP\/2.*(?:stream|cancel)|stream.*(?:cancel|reset)|ECONN(?:RESET|REFUSED)|socket hang up|timed out|timeout|temporary failure|HTTP 5\d\d|HTTP 429|rate limit/i.test(detail);
}

function runGhWithRetry(command, args, options, retryOptions = {}) {
  const runCommand = retryOptions.runCommand || runGh;
  const pause = retryOptions.waitForRetry || waitForRetry;
  const maxAttempts = retryOptions.maxAttempts || MAX_GITHUB_API_ATTEMPTS;
  let result = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      result = runCommand(command, args, options);
    } catch (error) {
      result = { status: 1, error, stderr: error?.message || String(error) };
    }

    if (result.status === 0 || !isTransientGitHubApiFailure(result) || attempt === maxAttempts) {
      return result;
    }

    pause(1000 * 2 ** (attempt - 1));
  }

  return result;
}

function requireSuccess(result, command) {
  if (result.status === 0) return;
  const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  throw new Error(`${command} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
}

function readExistingDashboard({ repository, retryOptions, options }) {
  const result = runGhWithRetry("gh", [
    "api",
    `repos/${repository}/contents/site/index.html`
  ], options, retryOptions);
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
  commitMessage = "Publish dashboard",
  waitForRetry,
  maxAttempts
}) {
  const { indexPath } = prepareSite({
    sourceHtmlPath,
    siteDir: path.join(projectRoot, "site")
  });
  const options = { cwd: projectRoot };
  const retryOptions = { runCommand, waitForRetry, maxAttempts };
  const existing = readExistingDashboard({ repository, retryOptions, options });
  const content = fs.readFileSync(indexPath, "utf8");
  if (existing && existing.content === content) return { indexPath, published: false };

  const body = {
    message: commitMessage,
    content: Buffer.from(content, "utf8").toString("base64")
  };
  if (existing) body.sha = existing.sha;
  requireSuccess(runGhWithRetry("gh", [
    "api",
    "--method",
    "PUT",
    `repos/${repository}/contents/site/index.html`,
    "--input",
    "-"
  ], { ...options, input: JSON.stringify(body) }, retryOptions), "gh api publish dashboard");
  return { indexPath, published: true };
}

module.exports = { prepareSite, publishDashboard, runGhWithRetry };

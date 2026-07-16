const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const publisherPath = path.join(projectRoot, "scripts", "publish-dashboard.js");
const { prepareSite, publishDashboard } = require(publisherPath);

test("includes the Pages dashboard publisher", () => {
  assert.equal(fs.existsSync(publisherPath), true);
});

test("exports a site preparation function", () => {
  assert.equal(typeof prepareSite, "function");
});

test("exports a GitHub-backed dashboard publisher", () => {
  assert.equal(typeof publishDashboard, "function");
});

test("prepares the Pages index path from a dashboard file", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chinapipe-pages-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const sourceHtmlPath = path.join(tempDir, "panel.html");
  const siteDir = path.join(tempDir, "site");
  fs.writeFileSync(sourceHtmlPath, "<html><body>dashboard</body></html>", "utf8");

  assert.deepEqual(prepareSite({ sourceHtmlPath, siteDir }), {
    indexPath: path.join(siteDir, "index.html")
  });
});

test("publishes a changed dashboard through the GitHub Contents API", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chinapipe-pages-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const sourceHtmlPath = path.join(tempDir, "panel.html");
  fs.writeFileSync(sourceHtmlPath, "<html><body>dashboard</body></html>", "utf8");
  const calls = [];
  const runCommand = (command, args, options) => {
    calls.push([command, args, options]);
    if (args[0] === "api" && args[1].includes("/contents/site/index.html") && args.length === 2) {
      return { status: 1, stderr: "Not Found" };
    }
    return { status: 0, stdout: "{}" };
  };

  assert.deepEqual(publishDashboard({
    sourceHtmlPath,
    projectRoot: tempDir,
    repository: "Xjiaqier/chinapipe-dashboard-pages",
    runCommand,
    commitMessage: "Publish dashboard"
  }), {
    indexPath: path.join(tempDir, "site", "index.html"),
    published: true
  });
  assert.deepEqual(calls.map(([command, args]) => [command, args]), [
    ["gh", ["api", "repos/Xjiaqier/chinapipe-dashboard-pages/contents/site/index.html"]],
    ["gh", ["api", "--method", "PUT", "repos/Xjiaqier/chinapipe-dashboard-pages/contents/site/index.html", "--input", "-"]]
  ]);
});

test("retries a transient GitHub API read failure before publishing", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chinapipe-pages-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const sourceHtmlPath = path.join(tempDir, "panel.html");
  fs.writeFileSync(sourceHtmlPath, "<html><body>dashboard</body></html>", "utf8");
  const calls = [];
  const delays = [];
  const runCommand = (command, args, options) => {
    calls.push([command, args, options]);
    const isRead = args[0] === "api" && args.length === 2;
    if (isRead && calls.length === 1) {
      return { status: 1, stderr: "HTTP/2 stream was cancelled" };
    }
    if (isRead) {
      return { status: 1, stderr: "Not Found" };
    }
    return { status: 0, stdout: "{}" };
  };

  const result = publishDashboard({
    sourceHtmlPath,
    projectRoot: tempDir,
    repository: "Xjiaqier/chinapipe-dashboard-pages",
    runCommand,
    waitForRetry(milliseconds) {
      delays.push(milliseconds);
    }
  });

  assert.equal(result.published, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [1000]);
});

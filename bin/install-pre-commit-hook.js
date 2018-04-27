
const PATH = require("path");
const FS = require("fs");


var packageRoot = process.cwd();
var gitPath = PATH.join(packageRoot, ".git");


if (process.argv.length <= 2) {
    throw new Error("Usage: install-pre-commit-hook <script-path>");
}

var scriptPath = process.argv[2];
if (!FS.existsSync(scriptPath)) {
    throw new Error("Script path '" + scriptPath + "' does not exist!");
}

if (!FS.existsSync(gitPath)) {
	process.exit(0);
	return;
}

if (FS.statSync(gitPath).isFile()) {
	var m = FS.readFileSync(gitPath, "utf8").match(/^gitdir:\s*(.+)[\n$]/);
	if (!m) {
		throw new Error("Error parsing gitdir pointer!");
	}
	gitPath = PATH.join(PATH.dirname(gitPath), m[1]);
}

var hooksPath = PATH.join(gitPath, "hooks");
var preCommitPath = PATH.join(hooksPath, "pre-commit");

try {
	FS.unlinkSync(preCommitPath);
} catch(err) {}

console.error("Linking '" + scriptPath + "' to '" + preCommitPath + "'");
FS.symlinkSync(scriptPath, preCommitPath);

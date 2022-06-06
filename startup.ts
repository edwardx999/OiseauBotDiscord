import { FSWatcher, watch } from "fs";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { glob } from "glob";
import { abort, stderr, stdout } from "process";

let child: ChildProcessWithoutNullStreams;
const spawnBot = () => {
	child = spawn("node", ["./bot.js", "./token.txt"]);
	console.log(`Started bot with pid ${child.pid}`);
	child.stdout.pipe(stdout);
	child.stderr.pipe(stderr);
	child.on("close", spawnBot);
};
spawnBot();

const responder = (() => {
	let killer: NodeJS.Timeout = null;
	let files: string[] = [];
	const warmupDelay = 5000;
	const startupTime = Date.now();
	const killDelay = 1000;
	return (filename: string) => {
		if (Date.now() - startupTime < warmupDelay) {
			console.log(`Ignoring early file change for ${filename}`);
			return;
		}
		files.push(filename);
		if (killer) {
			clearTimeout(killer);
		}
		killer = setTimeout(() => {
			files.sort();
			console.log(`File change detected at ${files}`);
			files = [];
			child.kill();
		}, killDelay);
	};
})();

let dirWatcher: FSWatcher = null;

glob("*.js", (error, matches) => {
	if (error) {
		console.error("Failed to find js files");
		abort();
	}
	const makeWatcher = (filename: string) => watch(filename, () => responder(filename));
	let watchers = matches.map(makeWatcher);
	dirWatcher = watch(".", event => {
		if (event === "rename") {
			glob("*.js", (error, newMatches) => {
				if (!error) {
					if (matches.length != newMatches.length || (matches.sort(), newMatches.sort(), (matches.some((path, index) => path != newMatches[index])))) {
						watchers.forEach(watcher => watcher.close());
						responder("(directory change)");
						watchers = matches.map(makeWatcher);
					}
				}
			});
		}
	});
});
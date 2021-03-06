import { watch } from "fs";
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
	const killDelay = 1000;
	return () => {
		if (killer) {
			clearTimeout(killer);
		}
		killer = setTimeout(() => {
			console.log("File change detected");
			child.kill();
		}, killDelay);
	};
})();

glob("*.js", (error, matches) => {
	if (error) {
		console.error("Failed to find js files");
		abort();
	}
	let watchers = matches.map(filename => watch(filename, responder));
	const dirWatcher = watch(".", event => {
		if (event === "rename") {
			glob("*.js", (error, newMatches) => {
				if (!error) {
					if (matches.length != newMatches.length || (matches.sort(), newMatches.sort(), (matches.some((path, index) => path != newMatches[index])))) {
						watchers.forEach(watcher => watcher.close());
						responder();
						watchers = matches.map(filename => watch(filename, responder));
					}
				}
			});
		}
	});
});
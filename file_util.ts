import * as fs from "fs";
import { sep as pathSeparator } from "path";
import * as os from "os";
import * as cp from "child_process";


export { createTempDir, pathSeparator, spawnTimeout, SpawnResult };

const tmpDir = os.tmpdir();

const createTempDir = async () => {
	const tempFolder = await fs.promises.mkdtemp(tmpDir + pathSeparator);
	return tempFolder;
};

interface SpawnResult {
	stdout: string;
	stderr: string;
	exitCode?: number; // if not present, timed out
}


const spawnTimeout = (command: string, args: string[], timeoutMs: number, options?: cp.SpawnOptions) => {
	return new Promise<SpawnResult>((resolve, reject) => {
		try {
			const child = cp.spawn(command, args, options);
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timeout = setTimeout(() => {
				child.kill();
				timedOut = true;
			}, timeoutMs);
			child.stdout.on("data", data => stdout += data);
			child.stderr.on("data", data => stderr += data);
			child.on("close", code => {
				if (!timedOut) {
					resolve({ stdout, stderr, exitCode: code });
					clearTimeout(timeout);
				}
				else {
					resolve({ stdout, stderr });
				}
			});
		} catch (err) {
			reject(err);
		}
	});
};

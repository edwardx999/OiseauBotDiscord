import * as fs from "fs";
import { sep as pathSeparator } from "path";
import * as os from "os";
import * as cp from "child_process";


export { createTempDir, pathSeparator, spawnTimeout, SpawnResult, makeCallOnce, saveToFile };

const tmpDir = os.tmpdir();

const createTempDir = () => {
	return fs.promises.mkdtemp(tmpDir + pathSeparator);
};

interface SpawnResult {
	stdout: string;
	stderr: string;
	exitCode?: number; // if not present, timed out
}

const spawnTimeout = (command: string, args: string[], timeoutMs: number, options?: cp.SpawnOptions, childHandler?: (child: cp.ChildProcess) => any) => {
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
					clearTimeout(timeout);
					resolve({ stdout, stderr, exitCode: code });
				}
				else {
					resolve({ stdout, stderr });
				}
			});
			if (childHandler) {
				childHandler(child);
			}
		} catch (err) {
			reject(err);
		}
	});
};

function makeCallOnce<T>(callback: (resolve: (value?: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => any) {
	let promise: Promise<T> = null;
	let result: T;
	return async () => {
		if (result !== undefined) {
			return result;
		}
		if (promise === null) {
			promise = new Promise<T>((resolve, reject) => callback(resolve, reject));
		}
		try {
			result = await promise;
			return result;
		} catch (err) {
			promise = null;
			throw err;
		}
	};
}

const saveToFile = (from: NodeJS.ReadableStream, path: string) => {
	const fileStream = fs.createWriteStream(path);
	return new Promise<void>((resolve, reject) => {
		from.pipe(fileStream);
		from.on("error", err => {
			reject(err);
		});
		fileStream.on("finish", async () => {
			resolve();
		});
	});
};
import * as fs from "fs";
import * as os from "os";
import { sep as pathSeparator } from "path";
import * as fetch from "node-fetch";
import * as cp from "child_process";

export { SprocResult, executeSproc, cleanupSproc }

interface SprocResult {
	sprocOutput: string;
	folderToCleanUp: string;
	filePaths: string[];
}

async function executeSproc(fileUrls: string[], commands: string[]): Promise<SprocResult> {
	const tmpDir = os.tmpdir();
	const tempFolder = await fs.promises.mkdtemp(tmpDir + pathSeparator);
	try {
		const downloadJobs = fileUrls.map((url, index) => {
			return fetch.default(url);
		});
		const paddingDigits = downloadJobs.length.toString().length;
		for (let i = 0; i < downloadJobs.length; ++i) {
			const request = await downloadJobs[i];
			const path = (() => {
				const type = request.headers.get("content-type");
				switch (type) {
					case "image/png":
					case "image/jpeg":
					case "image/tiff":
					case "image/bmp":
						return `${tempFolder}/${i.toString().padStart(paddingDigits, "0")}.${type.substring(6)}`;
					default:
						throw "Unsupported file type";
				}
			})();
			const fileStream = fs.createWriteStream(path);
			await new Promise((resolve, reject) => {
				request.body.pipe(fileStream);
				request.body.on("error", err => {
					reject(err);
				});
				fileStream.on("finish", async () => {
					resolve();
				});
			});
		}
		const outputPath = tempFolder + pathSeparator + "output";
		await fs.promises.mkdir(outputPath);
		const output = await new Promise<string>((resolve, reject) => {
			const sproc = cp.spawn(`.${pathSeparator}sproc_lim`, [tempFolder].concat(commands));
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timeout = setTimeout(() => {
				sproc.kill();
				stdout = "Timeout";
				reject(stdout);
				timedOut = true;
			}, 60000);
			sproc.stdout.on("data", data => stdout += data);
			sproc.stderr.on("data", data => stderr += data);
			sproc.on("close", code => {
				if (!timedOut) {
					if (code != 0) {
						console.log(code);
						console.log(stdout);
						console.log(stderr);
						reject(stdout);
					}
					else {
						resolve(stdout);
					}
					clearTimeout(timeout);
				}
			});
		});
		const outputFiles = (await fs.promises.readdir(outputPath)).map(filename => outputPath + pathSeparator + filename).sort();
		return { filePaths: outputFiles, folderToCleanUp: tempFolder, sprocOutput: output };
	} catch (e) {
		await fs.promises.rmdir(tempFolder, { recursive: true });
		throw e;
	}
}

async function cleanupSproc(result: SprocResult) {
	return await fs.promises.rmdir(result.folderToCleanUp, { recursive: true });
}
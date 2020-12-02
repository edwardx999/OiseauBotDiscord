import * as fs from "fs";
import * as fetch from "node-fetch";
import * as cp from "child_process";
import { createTempDir, pathSeparator, spawnTimeout } from "./file_util";

export { Result, executeSproc, cleanupSproc }

interface Result {
	sprocOutput: string;
	folder: string;
	filePaths: string[];
}

async function executeSproc(fileUrls: string[], commands: string[], timeoutMs?: number): Promise<Result> {
	const tempFolder = await createTempDir();
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
						return `${tempFolder}${pathSeparator}${i.toString().padStart(paddingDigits, "0")}.${type.substring(6)}`;
					default:
						throw `Unsupported file type "${type}"`;
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
		const output = await spawnTimeout(`.${pathSeparator}sproc_lim`, [tempFolder].concat(commands), timeoutMs || 60000);
		if (output.exitCode === undefined) {
			throw "Timeout";
		}
		if (output.exitCode != 0) {
			throw output.stdout;
		}
		const outputFiles = (await fs.promises.readdir(outputPath)).map(filename => outputPath + pathSeparator + filename).sort();
		return { filePaths: outputFiles, folder: tempFolder, sprocOutput: output.stdout };
	} catch (e) {
		await fs.promises.rmdir(tempFolder, { recursive: true });
		throw e;
	}
}

async function cleanupSproc(result: Result) {
	return await fs.promises.rmdir(result.folder, { recursive: true });
}
import * as fs from "fs";
import * as fetch from "node-fetch";
import { createTempDir, pathSeparator, spawnTimeout, saveToFile } from "./util";

export { Result, execute, cleanup }

interface Result {
	sprocOutput: string;
	folder: string;
	filePaths: string[];
}

async function execute(fileUrls: string[], commands: string[], timeoutMs?: number): Promise<Result> {
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
			await saveToFile(request.body, path);
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
		await fs.promises.rm(tempFolder, { recursive: true, force: true });
		throw e;
	}
}

async function cleanup(result: Result) {
	return await fs.promises.rm(result.folder, { recursive: true, force: true });
}
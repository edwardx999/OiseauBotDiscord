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
	const downloadJobs = fileUrls.map((url, index) => {
		return fetch.default(url);
	});
	try {
		for (let i = 0; i < downloadJobs.length; ++i) {
			const request = await downloadJobs[i];
			const path = (() => {
				const type = request.headers.get("content-type");
				switch (type) {
					case "image/png":
					case "image/jpeg":
					case "image/tiff":
					case "image/bmp":
						return `${tempFolder}/${i}.${type.substring(6)}`;
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
			sproc.stdout.on("data", data => stdout = stdout + data);
			sproc.on("close", code => {
				if (code != 0) {
					reject(stdout);
				}
				else {
					resolve(stdout);
				}
			});
		});
		const outputFiles = (await fs.promises.readdir(outputPath)).map(filename => outputPath + pathSeparator + filename);
		return { filePaths: outputFiles, folderToCleanUp: tempFolder, sprocOutput: output };
	} catch (e) {
		await fs.promises.rmdir(tempFolder, { recursive: true });
		throw e;
	}
	return;
}

async function cleanupSproc(result: SprocResult) {
	return await fs.promises.rmdir(result.folderToCleanUp, { recursive: true });
}
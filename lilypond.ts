import { createTempDir, pathSeparator, spawnTimeout, SpawnResult } from "./file_util";
import * as fs from "fs";
import * as cp from "child_process";
import * as glob from "glob";
import * as path from "path";
import { clearTimeout } from "timers";

export { render, cleanup, OutputFormats };

const inputFileName = "music.ly";
const version = "2.18.2";

const enum OutputFormats {
	IMAGES = "images",
	PDF = "pdf",
	MIDI = "midi",
	MP3 = "mp3"
}

interface Result {
	folder: string;
	filePaths: string[];
};

const render = async (lilyCode: string, formats: Partial<Record<OutputFormats, any>>, timeoutMs?: number): Promise<Result> => {
	const directory = await createTempDir();
	timeoutMs = timeoutMs || 60000;
	try {
		const lilyFile = await fs.promises.writeFile(`${directory}${pathSeparator}${inputFileName}`,
			`\\version "${version}"
\\header {
	tagline = ""
	title = ""
	composer = ""
}
${lilyCode}
`);
		const args = (() => {
			const ret = ["-dsafe", "--loglevel=ERROR"];
			if (formats[OutputFormats.IMAGES]) {
				ret.push("-fpng");
				ret.push("-dresolution=240");
			}
			if (formats[OutputFormats.PDF]) {
				ret.push("-fpdf");
			}
			ret.push(inputFileName);
			return ret;
		})();
		const result = await spawnTimeout("lilypond", args, timeoutMs, { cwd: directory });
		if (result.exitCode === undefined) {
			throw "Timeout";
		}
		if (result.exitCode != 0) {
			throw result.stderr;
		}
		const filePaths: string[] = [];
		const globExtensions: string[] = [];
		if (formats[OutputFormats.IMAGES]) {
			const sproc = await spawnTimeout("sproc", ["*.png", "-hp", "0", "tol:1", "bg:254", "-vp", "0", "tol:1", "bg:254"], timeoutMs, { cwd: directory });
			globExtensions.push("png");
		}
		if (formats[OutputFormats.PDF]) {
			globExtensions.push("pdf");
		}
		if (formats[OutputFormats.MP3]) {
			const midis = await getGlob(`${directory}${pathSeparator}*.mid`);
			for (const midi of midis) {
				await convertMidi(directory, path.basename(midi), timeoutMs);
			}
			globExtensions.push("mp3");
		}
		if (formats[OutputFormats.MIDI]) {
			globExtensions.push("mid");
		}
		const globPattern = `${directory}${pathSeparator}*.+(${globExtensions.join("|")})`;
		return { folder: directory, filePaths: await getGlob(globPattern) };
	} catch (error) {
		fs.promises.rmdir(directory, { recursive: true })
		throw error;
	}
};

const cleanup = (result: Result) => {
	return fs.promises.rmdir(result.folder, { recursive: true });
};

const getGlob = (pattern: string) => {
	return new Promise<string[]>((resolve) => {
		glob(pattern, (err, matches) => {
			if (err) {
				resolve([]);
			}
			else {
				resolve(matches);
			}
		});
	});
};

const convertMidi = (directory: string, filename: string, timeoutMs: number) => {
	return new Promise<void>((resolve) => {
		const timidify = cp.spawn("wsl", ["timidity", filename, "-Ow", "-o", "-"], { cwd: directory });
		const ffmpeg = cp.spawn("ffmpeg", ["-i", "-", "-acodec", "libmp3lame", "-q:a", "8", "-ab", "128k", `${filename}.mp3`], { cwd: directory });
		let timedOut = false;
		let otherClosed = false;
		const timeout = setTimeout(() => {
			timidify.kill();
			ffmpeg.kill();
			timedOut = true;
		}, timeoutMs);
		timidify.stdout.pipe(ffmpeg.stdin);
		const closeCallback = (code: number) => {
			if (otherClosed) {
				resolve();
			}
			else {
				otherClosed = true;
			}
			if (!timedOut) {
				clearTimeout(timeout);
			}
		};
		timidify.on("close", closeCallback);
		ffmpeg.on("close", closeCallback);
	});
}
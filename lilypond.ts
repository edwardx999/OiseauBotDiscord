import { createTempDir, pathSeparator, spawnTimeout, SpawnResult, makeCallOnce } from "./util";
import * as fs from "fs";
import * as glob from "glob";
import * as path from "path";

export { render, cleanup, OutputFormats };

const versionRegex = /GNU LilyPond ([0-9]+\.[0-9]+\.[0-9]+)/
const version = makeCallOnce<string>(async (resolve, reject) => {
	try {
		const lilypond = await spawnTimeout("lilypond", ["--version"], 20000);
		const versionString = versionRegex.exec(lilypond.stdout);
		if (versionString) {
			resolve(versionString[1]);
		}
		else {
			reject("Failed to find lilypond version");
		}
	} catch {
		reject("Failed to find lilypond");
	}
});

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
	const checkIllegal = (badCharacter: string) => {
		if (lilyCode.includes(badCharacter)) {
			throw `Illegal character ${badCharacter}`;
		}
	};
	checkIllegal("#");
	checkIllegal("$");
	const versionNumber = await version();
	const directory = await createTempDir();
	timeoutMs = timeoutMs || 60000;
	try {
		const lilyData =
			`\\version "${versionNumber}"
\\header {
	tagline = ""
	title = ""
	composer = ""
}
\\paper {
  #(define fonts
    (set-global-fonts
     #:music "BMusicFont"
     #:brace "profondo"
     #:roman "Academico"
    ))
}
${lilyCode}
`;
		const args = (() => {
			const ret = ["--loglevel=ERROR"];
			if (formats[OutputFormats.IMAGES]) {
				ret.push("-fpng");
				ret.push("-dresolution=240");
			}
			if (formats[OutputFormats.PDF]) {
				ret.push("-fpdf");
			}
			ret.push("-omusic")
			ret.push("-");
			return ret;
		})();
		const result = await spawnTimeout("lilypond", args, timeoutMs, { cwd: directory }, (child) => {
			child.stdin.write(lilyData);
			child.stdin.end();
		});
		if (result.exitCode === undefined) {
			throw "Timeout";
		}
		if (result.exitCode != 0) {
			throw result.stderr;
		}
		const globExtensions: string[] = [];
		if (formats[OutputFormats.IMAGES]) {
			const sproc = await spawnTimeout("sproc", ["*.png", "-hp", "1", "tol:1", "bg:254", "-vp", "1", "tol:1", "bg:254"], timeoutMs, { cwd: directory });
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
	return fs.promises.rm(result.folder, { recursive: true, force: true });
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
	const inputFile = directory.replace("C:\\", "/mnt/c/").replace(/\\/g, "/") + "/" + filename;
	return spawnTimeout("wsl", ["bash", "timidity_convert.sh", inputFile, `${inputFile}.mp3`], timeoutMs);
	// there are problems with piped input being corrupt
	/*
	return new Promise<void>((resolve, reject) => {
		try {
			const timidify = cp.spawn("wsl", ["timidity", filename, "-Ow", "-o", "-"], { cwd: directory });
			const ffmpeg = cp.spawn("ffmpeg", ["-i", "-", "-acodec", "libmp3lame", "-q:a", "8", "-ab", "128k", `${filename}.mp3`], { cwd: directory });
			let timedOut = false;
			let otherClosed = false;
			const timeout = setTimeout(() => {
				timidify.kill();
				ffmpeg.kill();
				timedOut = true;
			}, timeoutMs);
			ffmpeg.stderr.on("data", data => console.log(data.toString()));
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
		} catch (err) {
			reject(err);
		}
	});
	*/
}
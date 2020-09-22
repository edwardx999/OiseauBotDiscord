export { Hangman, cleanCharacters }

function cleanCharacters(input: string) {
	return input.replace(/[\u{0080}-\u{FFFF}]/gu, "?").toUpperCase().replace(/[^? A-Z]/g, "");
}

function countCharacterOccurences(str: string, chars: string) {
	let count = 0;
	for (const charFind of chars) {
		for (const char of str) {
			if (char == charFind) {
				++count;
			}
		}
	}
	return count;
}

class Hangman {
	readonly answer: string;
	readonly totalLives: number;
	readonly locationCorrect: boolean[];
	readonly charactersGuessed: Set<string>;
	correctCharactersCount: number;
	currentLives: number;
	constructor(answer: string, totalLives: number, whitespaceChars?: string) {
		this.answer = answer;
		this.totalLives = totalLives;
		this.locationCorrect = [];
		for (let i = 0; i < answer.length; ++i) {
			this.locationCorrect.push(false);
		}
		this.charactersGuessed = new Set<string>();
		if (whitespaceChars) {
			this.correctCharactersCount = countCharacterOccurences(answer, whitespaceChars);
		}
		else {
			this.correctCharactersCount = 0;
		}
		this.currentLives = totalLives;
	}

	guess(letter: string) {
		if (letter.length != 1) {
			return "you must guess a single letter";
		}
		if (this.charactersGuessed.has(letter)) {
			return `"${letter}" has already been guessed`;
		}
		this.charactersGuessed.add(letter);
		let count = 0;
		for (let i = 0; i < this.answer.length; ++i) {
			if (this.answer.substring(i, i + 1) == letter) {
				this.locationCorrect[i] = true;
				++count;
			}
		}
		if (count == 0) {
			--this.currentLives;
		}
		else {
			this.correctCharactersCount += count;
		}
		return count;
	}

	solve(guess: string, wildcards?: string) {
		if (wildcards) {
			if (guess.length != this.answer.length) {
				--this.currentLives;
				return false;
			}
			for (let i = 0; i < guess.length; ++i) {
				const a = this.answer.substring(i, i + 1);
				if (wildcards.indexOf(a) < 0) {
					const b = guess.substring(i, i + 1);
					if (a !== b) {
						--this.currentLives;
						return false;
					}
				}
			}
			this.locationCorrect.fill(true);
			this.correctCharactersCount = this.answer.length;
			return true;
		}
		else {
			if (guess !== this.answer) {
				--this.currentLives;
				return false;
			}
			this.locationCorrect.fill(true);
			this.correctCharactersCount = this.answer.length;
			return true;
		}
	}

	victory() {
		return this.correctCharactersCount === this.answer.length;
	}

	loss() {
		return this.currentLives === 0;
	}

}
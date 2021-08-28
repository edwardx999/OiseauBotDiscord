export { installHandlers, getComposer, Difficulty }
import * as Discord from "discord.js";
import * as StringSimilarity from "string-similarity";
import { Hangman, cleanCharacters } from "./hangman";
import * as Wiki from "./wiki_composer";
import * as Sproc from "./sproc";
import { CircularBuffer } from "./circular_buffer";
import { sep as pathSeparator } from "path";
import * as Cache from "cacache";
import * as Lily from "./lilypond";
import * as Godbolt from "./godbolt";
import * as fetch from "node-fetch";
import { setInterval } from "timers";

type CommandFunction = (message: Discord.Message, commandToken: string, bot: Discord.Client) => any;

const catchHandler = (err: any) => {
	console.error(new Date());
	console.error(err);
}

interface Command {
	command: CommandFunction;
	explanation: string;
	usage: string;
	hidden?: boolean;
}

type GuildId = string;
type UserId = string;

let commandFlags: Record<GuildId, string> = {};
const commandFlagPlaceholder = "!";
const commandFlag = (message: Discord.Message) => {
	return commandFlags[message.guild.id] || commandFlagPlaceholder;
}
function removeCommandFlag(token: string, message: Discord.Message) {
	return token.substring(commandFlag(message).length);
}

function capitalizeFirstLetter(str: string) {
	if (str.length > 0) {
		str = str.substring(0, 1).toUpperCase() + str.substring(1);
	}
	return str;
}

function pastFirstToken(str: string, token: string) {
	return str.substring(token.length);
}

function firstToken(words: string) {
	const whiteSpaceRegex = /\s/;
	const whiteSpaceLoc = whiteSpaceRegex.exec(words);
	if (whiteSpaceLoc) {
		return words.substring(0, whiteSpaceLoc.index);
	}
	else {
		return words;
	}
}

function tokenize(words: string) {
	const whiteSpaceRegex = /\s+/;
	return words.split(whiteSpaceRegex).filter(value => value.length > 0);
}

function quoteTokenize(words: string) {
	const regex = /[^\s"]+|"(\\"|[^"]*)"/gi;
	const tokens: string[] = [];
	while (true) {
		var match = regex.exec(words);
		if (match != null) {
			//index 1 is the quoted group, otherwise the whole group
			tokens.push(match[1] ? match[1] : match[0]);
		}
		else {
			break;
		}
	}
	return tokens;
}

const sayHi: CommandFunction = (message, commandToken) => {
	const greeting = capitalizeFirstLetter(removeCommandFlag(commandToken, message));
	message.channel.send({ content: `${greeting} <@${message.author.id}>` }).catch(catchHandler);
};

const newRolesDeleteTimeout = 10000;

type MessageId = string;
const toBeDeleted: Record<MessageId, NodeJS.Timeout> = {};

const deleteExtraneous = (message: Discord.Message) => {
	const id = message.id;
	const channel = message.channel;
	const timeout = setTimeout(() => {
		channel.messages.delete(id).catch(catchHandler);
		delete toBeDeleted[id];
	}, newRolesDeleteTimeout);
	toBeDeleted[id] = timeout;
	return timeout;
};

function noRoleArgumentResponse(message: Discord.Message) {
	deleteExtraneous(message);
	return message.channel.send(`<@${message.author.id}>, you must provide a role argument`).catch(catchHandler);
}

function normalizeUppercase(str: string) {
	return str.normalize("NFC").toUpperCase();
}

function noRoleExistReponse(message: Discord.Message, roleName: string) {
	const rank = message.guild.me.roles.highest.position;
	const roles = message.guild.roles.cache.array().filter(role => role.position < rank && !role.name.startsWith("@"));
	const rolesNormalized = roles.map(role => normalizeUppercase(role.name));
	const desiredNormalized = normalizeUppercase(roleName);
	const nearest = StringSimilarity.findBestMatch(desiredNormalized, rolesNormalized);
	deleteExtraneous(message);
	const response = nearest.bestMatchIndex < rolesNormalized.length && nearest.bestMatch.rating > 0 ?
		`<@${message.author.id}>, the role ${roleName} does not exist. Did you mean ${roles[nearest.bestMatchIndex].name}?` :
		`<@${message.author.id}>, the role ${roleName} does not exist`;
	return message.channel.send(response).catch(catchHandler).then(message => { if (message) { deleteExtraneous(message); } });
}

function findRole(roles: Discord.RoleManager, roleName: string) {
	roleName = normalizeUppercase(roleName);
	return roles.cache.find(role => (normalizeUppercase(role.name) == roleName));
}

function findRoleId(roles: Discord.GuildMemberRoleManager, roleId: string) {
	return roles.cache.get(roleId);
}

type RoleId = string;
const roleBlacklists: Record<GuildId, Record<RoleId, any>> = {};

const guildBlacklistName = (guildId: GuildId) => `blacklist+${guildId}`;

const initBlacklist = async (guildId: GuildId) => {
	const loadedBlacklist = roleBlacklists[guildId];
	if (loadedBlacklist) {
		return loadedBlacklist;
	}
	try {
		const blacklist = JSON.parse((await Cache.get(storagePath, guildBlacklistName(guildId))).data.toString()) as Record<RoleId, any>;
		if (typeof blacklist === "object") {
			roleBlacklists[guildId] = blacklist;
			return blacklist;
		}
	} catch (err) {
		catchHandler(err);
	}
	return (roleBlacklists[guildId] = {});
};

const addToBlacklist = async (guildId: GuildId, roleId: RoleId) => {
	const blacklist = await initBlacklist(guildId);
	if (!blacklist[roleId]) {
		blacklist[roleId] = true;
		Cache.put(storagePath, guildBlacklistName(guildId), JSON.stringify(blacklist)).catch(catchHandler);
	}
};

const removeFromBlacklist = async (guildId: GuildId, roleId: RoleId) => {
	const blacklist = await initBlacklist(guildId);
	if (blacklist[roleId]) {
		delete blacklist[roleId];
		Cache.put(storagePath, guildBlacklistName(guildId), JSON.stringify(blacklist)).catch(catchHandler);
	}
};

const roleCommandHelper = (message: Discord.Message, commandToken: string, doWithRole: (role: Discord.Role) => any) => {
	const guild = message.guild;
	const roles = guild.roles;
	const desiredRoleName = pastFirstToken(message.content, commandToken).trim();
	if (desiredRoleName.length == 0) {
		return noRoleArgumentResponse(message);
	}
	const role = findRole(roles, desiredRoleName);
	if (role) {
		doWithRole(role);
	}
	else {
		noRoleExistReponse(message, desiredRoleName);
	}
};

const giveRole: CommandFunction = async (message, commandToken) => {
	const guild = message.guild;
	roleCommandHelper(message, commandToken, async (role) => {
		const userRoles = guild.member(message.author.id).roles;
		if (findRoleId(userRoles, role.id)) {
			message.channel.send(`<@${message.author.id}>, you already have role ${role.name}`).catch(catchHandler);
		}
		else {
			const forbiddenCallback = () => {
				message.channel.send(`<@${message.author.id}>, I cannot give you role ${role.name}`).catch(catchHandler);
			};
			const blacklist = await initBlacklist(guild.id);
			if (!(blacklist[role.id])) {
				userRoles.add(role).then(
					() => {
						message.channel.send(`<@${message.author.id}>, you have been given role ${role.name}`).catch(catchHandler);
					}, forbiddenCallback);
			}
			else {
				forbiddenCallback();
			}
		}
	});
};

const takeRole: CommandFunction = (message, commandToken) => {
	const guild = message.guild;
	roleCommandHelper(message, commandToken, (role) => {
		const userRoles = guild.member(message.author.id).roles;
		if (!findRoleId(userRoles, role.id)) {
			message.channel.send(`<@${message.author.id}>, you do not have role ${role.name}`).catch(catchHandler);
		}
		else {
			userRoles.remove(role).then(
				() => {
					message.channel.send(`<@${message.author.id}>, you have lost role ${role.name}`).catch(catchHandler);
				},
				() => {
					message.channel.send(`<@${message.author.id}>, I cannot remove role ${role.name}`).catch(catchHandler);
				});
		}
	});
};

const givemeUnblacklist: CommandFunction = (message, commandToken) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		roleCommandHelper(message, commandToken, (role) => {
			removeFromBlacklist(message.guild.id, role.id).then(
				() => { message.channel.send(`Role ${role.name} has been unblacklisted`).catch(catchHandler); },
				catchHandler);
		});
	}
};

const givemeBlacklist: CommandFunction = (message, commandToken) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		roleCommandHelper(message, commandToken, (role) => {
			addToBlacklist(message.guild.id, role.id).then(
				() => { message.channel.send(`Role ${role.name} has been blacklisted`).catch(catchHandler); },
				catchHandler);
		});
	}
};

class ComposerHangman extends Hangman {
	readonly realName: string;
	readonly dates: string;
	readonly url: string;
	public lastGuess: string;
	private categories?: string[];
	private dateHintUsed: boolean;
	private hintsUsed: string[];
	constructor(realname: string, dates: string, lives: number, url: string) {
		super(cleanCharacters(realname), lives, " ?");
		this.realName = realname;
		this.dates = dates;
		this.url = url;
		this.lastGuess = "";
		this.dateHintUsed = false;
		this.hintsUsed = [];
	}

	async getHint() {
		if (!this.dateHintUsed) {
			this.dateHintUsed = true;
			return this.dates;
		}
		if (this.categories === undefined) {
			const list = await Wiki.fetchComposerCategories(this.url);
			this.categories = list.filter(name => name.indexOf(this.realName) < 0 && name.indexOf("Wikipedia") < 0);
		}
		if (this.categories.length === 0) {
			const temp = this.categories;
			this.categories = this.hintsUsed;
			this.hintsUsed = temp;
			return this.dates;
		}
		const index = Math.floor(Math.random() * this.categories.length);
		const hint = this.categories[index];
		this.categories[index] = this.categories[this.categories.length - 1];
		this.categories.splice(this.categories.length - 1, 1);
		this.hintsUsed.push(hint);
		return hint;
	}
}

const hangmanGames: Record<string, ComposerHangman> = {};

function hangmanMessage(game: Hangman, message: string, player: Discord.User, pastTense: boolean) {
	const getReplacementChar = (guessed: boolean, i: number) => {
		const letter = game.answer.substring(i, i + 1);
		if (guessed) {
			return letter;
		}
		else {
			if (letter === " " || letter === "?") {
				return letter;
			}
			return "◇";
		}
	};
	const livesMessage = () => {
		if (game.currentLives === 0) {
			return `<@${player.id}>, you ran out of lives!`;
		}
		else {
			const have = pastTense ? "had" : "have";
			const plural = game.currentLives == 1 ? "life" : "lives";
			if (game.victory()) {
				return `<@${player.id}>, you ${have} ${game.currentLives} ${plural} left.`;
			}
			else {
				return `<@${player.id}>, you ${have} ${game.currentLives} ${plural} left.`;
			}
		}
	};
	const charactersGuessedMsg = (() => {
		if (game.charactersGuessed.size == 0) {
			return "";
		}
		let chars = [];
		for (const character of game.charactersGuessed) {
			chars.push(character);
		}
		chars.sort();
		return " Characters guessed: " + chars.join("");
	})();
	return `${message}${charactersGuessedMsg}\n\`\`${game.locationCorrect.map(getReplacementChar).join("")}\`\`\n${livesMessage()}`
}

function hangmanCompleteMessage(game: ComposerHangman) {
	let ret = `The answer was ${game.answer} (${game.realName}) (${game.dates})`;
	if (game.url) {
		ret += ` (<https://en.wikipedia.org${game.url}>)`;
	}
	return ret;
}

type Difficulty = "easiest" | "easy" | "medium" | "hard" | "hardest";

type SampleSize = number;
const difficultyMap: Record<Difficulty, SampleSize> = {
	easiest: 25,
	easy: 16,
	medium: 9,
	hard: 4,
	hardest: 1,
};

async function getComposer(composerData: Wiki.ComposerData[], difficult: Difficulty) {
	const candidatesToConsider = difficultyMap[difficult];
	const candidates: Wiki.ComposerData[] = [];
	{
		const queryTitles: string[] = [];
		const queryComposers: Wiki.ComposerData[] = [];
		{
			const found = {};
			for (let i = 0; i < candidatesToConsider; ++i) {
				const index = Math.floor(Math.random() * composerData.length);
				if (found[index] === undefined) {
					found[index] = true;
					const composer = composerData[index];
					if (composer.pageSize === undefined) {
						queryTitles.push(composer.pageUrl);
						queryComposers.push(composer);
					}
					candidates.push(composer);
				}
			}
		}
		const pageSizes = await Wiki.fetchComposerPageSize(queryTitles);
		pageSizes.forEach((size, index) => {
			if (size !== undefined) {
				const composer = queryComposers[index];
				composer.pageSize = size;
			}
		});
	}
	const best = candidates.reduce((currentBest, candidate) => {
		if (candidate.pageSize > currentBest.pageSize || currentBest.pageSize === undefined) {
			return candidate;
		}
		return currentBest;
	});
	return best;
}

function startGame(message: Discord.Message, difficult: Difficulty) {
	const authorId = message.author.id;
	if (hangmanGames[authorId]) {
		message.channel.send(`<@${authorId}>, you already have a game ongoing`).catch(catchHandler);
		return;
	}
	Wiki.fetchComposerList().then(async (composerData) => {
		if (composerData && composerData.length > 0) {
			const composer = await getComposer(composerData, difficult);
			const game = hangmanGames[authorId] = new ComposerHangman(composer.name, composer.dates, 7, composer.pageUrl);
			message.channel.send(hangmanMessage(game, `Game start. Difficulty: ${difficult}`, message.author, false));
		}
		else {
			message.channel.send("Could not retrieve composer database").catch(catchHandler);
		}
	}, () => message.channel.send("Could not retrieve composer database").catch(catchHandler));
}

function hangmanGuess(message: Discord.Message, game: ComposerHangman, guess: string) {
	if (game.lastGuess === guess) {
		return;
	}
	game.lastGuess = guess;
	const authorId = message.author.id;
	const guessed = game.guess(guess);
	if (typeof guessed === "string") {
		initAlreadyGuessedBanList().then(banList => {
			if (!banList.has(message.author.id)) {
				message.channel.send(`<@${authorId}>, ${guessed}`).catch(catchHandler);
			}
		});
	}
	else {
		if (guessed == 0) {
			if (game.loss()) {
				message.channel.send(hangmanMessage(game, `"${guess}" not found, you lost!`, message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
				delete hangmanGames[authorId];
			}
			else {
				message.channel.send(hangmanMessage(game, `"${guess}" not found.`, message.author, false)).catch(catchHandler);
			}
		}
		else {
			const plural = guessed == 1 ? "1 occurence" : `${guessed} occurences`;
			if (game.victory()) {
				message.channel.send(hangmanMessage(game, `${plural} found of "${guess}". You win!`, message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
				delete hangmanGames[authorId];
			}
			else {
				message.channel.send(hangmanMessage(game, `${plural} found of "${guess}."`, message.author, false)).catch(catchHandler);
			}
		}
	}
}

const hangman: CommandFunction = (message, commandToken) => {
	const args = tokenize(pastFirstToken(message.content, commandToken));
	const authorId = message.author.id;
	if (args.length == 0) {
		startGame(message, "easy");
	}
	else {
		const command = args[0];
		const findGame = () => {
			const game = hangmanGames[authorId];
			if (game) {
				return game;
			}
			message.channel.send(`<@${authorId}>, you do not have a game in progress`).catch(catchHandler);
		}
		switch (command) {
			case "g":
			case "guess":
				{
					const game = findGame();
					if (game) {
						const whatToGuess = args[1]?.toUpperCase();
						if (whatToGuess && whatToGuess.match(/[A-Z]/)) {
							hangmanGuess(message, game, whatToGuess);
						}
						else {
							message.channel.send(`<@${authorId}>, you need to guess a letter`).catch(catchHandler);
						}
					}
				}
				break;
			case "s":
			case "solve":
				{
					const game = findGame();
					if (game) {
						const whatToGuess = args.slice(1).join(" ").toUpperCase();
						if (whatToGuess.length > 0) {
							const success = game.solve(whatToGuess);
							if (success) {
								message.channel.send(hangmanMessage(game, `You win!`, message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
								delete hangmanGames[authorId];
							}
							else {
								if (game.loss()) {
									message.channel.send(hangmanMessage(game, "That is wrong! You lose.", message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
									delete hangmanGames[authorId];
								}
								else {
									message.channel.send(hangmanMessage(game, "That is wrong!", message.author, false)).catch(catchHandler);
								}
							}
						}
						else {
							message.channel.send(`<@${authorId}>, you need to guess something`).catch(catchHandler);
						}
					}
				}
				break;
			case "hint":
				{
					const game = findGame();
					if (game) {
						game.getHint().then(hint => message.channel.send(`<@${authorId}> hint: ${hint}`).catch(catchHandler));
					}
				}
				break;
			case "giveup":
				{
					const game = findGame();
					if (game) {
						message.channel.send(hangmanMessage(game, "You lost!", message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
						delete hangmanGames[authorId];
					}
				}
				break;
			case "help":
				{
					message.channel.send(new Discord.MessageEmbed()
						.setTitle("Hangman Help").setColor("#654321")
						.addField("Commands", `Start Game: ${commandToken} [difficulty: easiest, easy, medium, hard, hardest]\nGuess: ${commandToken} guess <letter>\nGuess(shorthand): <single letter>\nSolve: ${commandToken} solve <answer>\nHint: ${commandToken} hint\nGive Up: ${commandToken} giveup`)).catch(catchHandler);
				}
				break;
			case "easiest":
			case "easy":
			case "medium":
			case "hard":
			case "hardest":
				startGame(message, command);
				break;
			default:
				message.channel.send(`<@${authorId}>, ${command} is not a hangman command`).catch(catchHandler);
		}
	}
};

function hasGuildPermission(message: Discord.Message, permission: Discord.BitFieldResolvable<Discord.PermissionString>) {
	const permissions = message.guild.me.permissions;
	return permissions.has(permission);
}

function hasChannelPermission(message: Discord.Message, permission: Discord.BitFieldResolvable<Discord.PermissionString>) {
	const permissions = message.guild.me.permissionsIn(message.channel);
	return permissions.has(permission);
}

type Urls = string[];
type LastBuffer = { buffer: CircularBuffer<Urls>, array: Urls[] };
const lastSprocRequests: Record<GuildId, Record<UserId, LastBuffer>> = {};

const sprocRequestKey = (message: Discord.Message) => {
	return `${message.guild.id}+${message.author.id}$`;
}

const createLastBuffer = (init?: Urls[]): LastBuffer => {
	const capacity = 16;
	const array: Urls[] = Array.from({ length: capacity });
	return { buffer: new CircularBuffer<Urls>(capacity, init), array };
};

const storagePath = `.${pathSeparator}data`;
const cacheGet = async (key: string) => {
	try {
		return JSON.parse((await Cache.get(storagePath, key)).data.toString());
	} catch {
		return undefined;
	}
};

const cachePut = async (key: string, data: any) => {
	return Cache.put(storagePath, key, JSON.stringify(data));
}

const lastFromPersistent = async (message: Discord.Message) => {
	const key = sprocRequestKey(message);
	try {
		const cached = await Cache.get(storagePath, key);
		const result = JSON.parse(cached.data.toString());
		if (Array.isArray(result) && result.every(el => Array.isArray(el) && el.every(el => typeof el === "string"))) {
			return lastSprocRequests[message.guild.id][message.author.id] = createLastBuffer(result as Urls[]);
		}
	} catch {
	}
	lastSprocRequests[message.guild.id][message.author.id] = createLastBuffer();
	return null;
};

const getLast = async (addTo: string[], message: Discord.Message, index: number) => {
	let lastRequest: Urls;
	const lastRequestGuild = lastSprocRequests[message.guild.id];
	if (!lastRequestGuild) {
		lastSprocRequests[message.guild.id] = {};
		lastRequest = (await lastFromPersistent(message))?.buffer.last(index);
	}
	else {
		const lastRequestUser = lastRequestGuild[message.author.id];
		if (!lastRequestUser) {
			lastRequest = (await lastFromPersistent(message))?.buffer.last(index);
		}
		else {
			lastRequest = lastRequestUser.buffer.last(index);
		}
	}
	if (!lastRequest) {
		return false;
	}
	for (const attachment of lastRequest) {
		addTo.push(attachment);
	}
	return true;
};


const lastRegex = /^\$LAST([-~]([0-9]+))?$/;

const execSproc: CommandFunction = async (message, commandToken) => {
	if (!hasChannelPermission(message, ["ATTACH_FILES", "SEND_MESSAGES"])) {
		if (hasChannelPermission(message, "SEND_MESSAGES")) {
			message.channel.send("I lack proper permissions in this channel").catch(catchHandler);
		}
		return;
	}
	const args = quoteTokenize(pastFirstToken(message.content, commandToken));
	const attachments: string[] = [];
	for (const attachment of message.attachments) {
		attachments.push(attachment[1].url);
	}
	{
		let foundCommands = false;
		for (let i = 0; i < args.length; ++i) {
			const arg = args[i] as string;
			if (arg.startsWith("-")) {
				args.splice(0, i);
				foundCommands = true;
				break;
			}
			const match = lastRegex.exec(arg.toUpperCase());
			if (match) {
				const index = match[2] ? +match[2] : 0;
				if (!(await getLast(attachments, message, index))) {
					message.channel.send("Failed to retrieve last request").catch(catchHandler);
					return;
				}
			}
			else {
				if (arg.startsWith("<") && arg.endsWith(">")) {
					attachments.push(arg.substring(1, arg.length - 1));
				}
				else {
					attachments.push(arg);
				}
			}
		}
		if (!foundCommands) {
			message.channel.send("No commands given").catch(catchHandler);
			return;
		}
	}
	if (attachments.length == 0) {
		message.channel.send("You have nothing to process").catch(catchHandler);
		return;
	}
	try {
		const result = await Sproc.execute(attachments, args);
		const output = result.sprocOutput.trim();
		if (output.length != 0) {
			try {
				await message.channel.send(output);
			} catch (ex) {
				catchHandler(ex);
			}
		}
		const responses = [];
		for (let i = 0; i < result.filePaths.length; ++i) {
			try {
				const attachment = new Discord.MessageAttachment(result.filePaths[i]);
				const sent = await message.channel.send(attachment);
				for (const attachment of sent.attachments) {
					responses.push(attachment[1].url);
				}
			}
			catch (error) {
				if (error instanceof Discord.DiscordAPIError) {
					try {
						const attachmentTooLarge = 40005;
						const errorMessage = error.code === attachmentTooLarge ? "(Result too large)" : `Error: ${error.message}`;
						await message.channel.send(errorMessage);
					} catch (ex) {
						catchHandler(ex);
					}
				}
			}
		}
		Sproc.cleanup(result).catch(catchHandler);
		const lastRequestGuild = lastSprocRequests[message.guild.id] || (lastSprocRequests[message.guild.id] = {});
		const lastRequestList = lastRequestGuild[message.author.id] || (lastRequestGuild[message.author.id] = createLastBuffer());
		if (responses.length > 0) {
			lastRequestList.buffer.push(responses);
			const key = sprocRequestKey(message);
			Cache.put(storagePath, key, JSON.stringify(lastRequestList.buffer.toArray(lastRequestList.array))).catch(catchHandler);
		}
	} catch (error) {
		message.channel.send(`Error: ${error}`).catch(catchHandler);
	}
};

const outputTypes = [
	[Lily.OutputFormats.IMAGES, "png", "\\layout"],
	[Lily.OutputFormats.PDF, "pdf", "\\layout"],
	[Lily.OutputFormats.MIDI, "mid", "\\midi"],
	[Lily.OutputFormats.MP3, "mp3", "\\midi"]
];
const endCodeBlockRegex = /```([\s\S]*)```\s*$/;
const endCodeBlockRegex2 = /`([\s\S]*)`\s*$/;
const addTrashCan = (message: Discord.Message, userId: UserId) => {
	message.react("🗑️").catch(catchHandler);
	const filter = (reaction: Discord.MessageReaction, user: Discord.User) => {
		return reaction.emoji.name === "🗑️" && user.id === userId;
	};
	message.awaitReactions(filter, { max: 1, time: 300000 }).then((collected) => {
		if (collected.size >= 1) {
			message.delete().catch(catchHandler);
		}
	}, () => { });
};

const execLilyHelp = async (message: Discord.Message, commandToken: string, codeWrapper?: (code: string) => string) => {
	if (!hasChannelPermission(message, ["ATTACH_FILES", "SEND_MESSAGES"])) {
		if (hasChannelPermission(message, "SEND_MESSAGES")) {
			message.channel.send("I lack proper permissions in this channel").catch(catchHandler);
		}
		return;
	}
	const userTrashcan = (output: Discord.Message) => addTrashCan(output, message.author.id);
	const past = pastFirstToken(message.content, commandToken);
	const codeBlock = endCodeBlockRegex.exec(past) || endCodeBlockRegex2.exec(past);
	if (codeBlock) {
		const codeText = codeBlock[1];
		const args = tokenize(past.substring(0, codeBlock.index));
		try {
			const options = (args.length == 0) ? { images: true } : (() => {
				let ret = {};
				for (const arg of args) {
					switch (arg) {
						case "images":
						case "pdf":
						case "midi":
						case "mp3":
							ret[arg] = true;
							break;
						case "png":
						case "image":
							ret["images"] = true;
							break;
						case "mid":
							ret["midi"] = true;
							break;
						default:
							throw `Invalid format "${arg}"`;
					}
				}
				return ret;
			})();
			const result = await Lily.render(codeWrapper ? codeWrapper(codeText) : codeText, options);
			try {
				const warningMessage = (() => {
					let message = "";
					for (const [type, extension, required] of outputTypes) {
						if (options[type]) {
							const matchFound = result.filePaths.some(name => name.endsWith(extension));
							if (!matchFound) {
								message += `Warning: You requested ${type}, but none were found. Did you forget a ${required} block?\n`;
							}
						}
					}
					return message;
				})();
				if (warningMessage.length > 0 && result.filePaths.length == 0) {
					message.channel.send(warningMessage).catch(catchHandler);
				}
				else {
					for (let i = 0; i < result.filePaths.length; ++i) {
						try {
							const attachment = new Discord.MessageAttachment(result.filePaths[i]);
							if (i == 0 && warningMessage.length > 0) {
								userTrashcan(await message.channel.send(warningMessage, attachment));
							}
							else {
								userTrashcan(await message.channel.send(attachment));
							}
						}
						catch (error) {
							if (error instanceof Discord.DiscordAPIError) {
								try {
									const attachmentTooLarge = 40005;
									const errorMessage = error.code === attachmentTooLarge ? "(Result too large)" : `Error: ${error.message}`;
									userTrashcan(await message.channel.send(errorMessage));
								} catch (ex) {
									catchHandler(ex);
								}
							}
						}
					}
				}
			}
			finally {
				Lily.cleanup(result).catch(catchHandler);
			}
		}
		catch (error) {
			if (hasChannelPermission(message, "SEND_MESSAGES")) {
				const errorMessage = `${error}`;
				if (errorMessage.length > 1800) {
					message.channel.send(`Error (Truncated): \`\`\`${errorMessage.substring(0, 1800)}\`\`\``).then(userTrashcan, catchHandler);
				}
				else {
					message.channel.send(`Error: \`\`\`${errorMessage}\`\`\``).then(userTrashcan, catchHandler);
				}
			}
		}
	}
	else {
		message.channel.send("No lilypond code found. Please put lilypond code inside \\`\\`\\`").then(userTrashcan, catchHandler);
	}
};

const execLily: CommandFunction = (message, commandToken) => {
	return execLilyHelp(message, commandToken);
};

const execLilyBasic: CommandFunction = (message, commandToken) => {
	return execLilyHelp(message, commandToken, (code) => {
		return `\\score { << \\new Staff { ${code} } >> \\layout { } \\midi { }}`;
	});
};

const noRolesMessage = "I can give you no roles";

const listRoles: CommandFunction = async (message) => {
	if (!hasGuildPermission(message, "MANAGE_ROLES")) {
		message.channel.send(noRolesMessage).catch(catchHandler);
		return;
	}
	const guild = message.guild;
	const roles = guild.roles;
	const botRole = guild.me.roles.highest;
	const blacklist = await initBlacklist(guild.id);
	const list = roles.cache.array()
		.sort((role1, role2) => role2.position - role1.position)
		.map((role) => {
			if (role.position < botRole.position && role.name != "@everyone" && role.id && !blacklist[role.id]) {
				return role.name;
			}
			return null;
		}).filter(v => v != null).join("\n");
	const response = list.length > 0 ?
		(hasChannelPermission(message, "EMBED_LINKS") ?
			new Discord.MessageEmbed().setColor("#FEDCBA").addField("Roles I Can Give You", list) :
			"**Roles I Can Give You**\n" + list) :
		noRolesMessage;
	message.channel.send(response).catch(catchHandler);
}

const fitsEmojiNamePattern = (text: string) => {
	return text.length > 2 && text.startsWith(":") && text.endsWith(":");
};

const emojiSpec = /^<:(.+):([0-9]+)>$/;
const parseEmojiSpec = (text: string) => {
	return emojiSpec.exec(text);
};

const extractEmojiName = (text: string) => {
	return text.substring(1, text.length - 1);
};

interface MessageMatch {
	guild: string,
	channel: string,
	message: string
};
const messageRegex = /^(?:https?:\/\/)?discord.com\/channels\/([0-9]+)\/([0-9]+)\/([0-9]+)$/;
const parseMessageLink = (link: string): MessageMatch => {
	const match = messageRegex.exec(link);
	if (match) {
		return {
			guild: match[1],
			channel: match[2],
			message: match[3]
		};
	}
	return null;
};

const reactParser = (message: Discord.Message, commandToken: string, bot: Discord.Client) => {
	const args = quoteTokenize(pastFirstToken(message.content, commandToken));
	if (args.length >= 2) {
		const emojis: Discord.EmojiIdentifierResolvable[] = [];
		const messages: MessageMatch[] = [];
		for (let i = 0; i < args.length; ++i) {
			const arg = args[i];
			if (fitsEmojiNamePattern(arg)) {
				const emoji = findEmoji(extractEmojiName(arg), bot);
				if (emoji) {
					emojis.push(emoji);
				}
			}
			else {
				const match = parseEmojiSpec(arg);
				if (match) {
					emojis.push(match[2]);
				}
				else {
					const messageMatch = parseMessageLink(arg);
					if (messageMatch) {
						messages.push(messageMatch);
					}
				}
			}
		}
		return { emojis, messages };
	}
	return null;
}
const react: CommandFunction = async (message, commandToken, bot) => {
	const parsed = reactParser(message, commandToken, bot);
	if (parsed) {
		const emojis = parsed.emojis;
		const messages = parsed.messages;
		for (const emoji of emojis) {
			for (const messageInfo of messages) {
				const guild = bot.guilds.cache.get(messageInfo.guild);
				if (guild) {
					const channel = guild.channels.cache.get(messageInfo.channel);
					if (channel && channel.type === "text" && guild.me.permissionsIn(channel).has("ADD_REACTIONS")) {
						try {
							const message = await (channel as Discord.TextChannel).messages.fetch(messageInfo.message);
							message.react(emoji).catch(catchHandler);
						} catch (err) {
							catchHandler(err);
						}
					}
				}
			}
		}
	}
};

const unreact: CommandFunction = async (message, commandToken, bot) => {
	const parsed = reactParser(message, commandToken, bot);
	if (parsed) {
		const emojis = parsed.emojis;
		const messages = parsed.messages;
		for (const messageInfo of messages) {
			const guild = bot.guilds.cache.get(messageInfo.guild);
			if (guild) {
				const channel = guild.channels.cache.get(messageInfo.channel);
				if (channel && channel.type === "text") {
					try {
						const message = await (channel as Discord.TextChannel).messages.fetch(messageInfo.message);
						for (const emoji of emojis) {
							const reaction = message.reactions.cache.get(emoji.toString());
							if (reaction && reaction.me) {
								reaction.users.remove(bot.user).catch(catchHandler);
							}
						}
					} catch (err) {
						catchHandler(err);
					}
				}
			}
		}
	}
};

const execGodbolt: CommandFunction = async (message, commandToken) => {
	const past = pastFirstToken(message.content, commandToken);
	const codeBlock = endCodeBlockRegex.exec(past);
	if (codeBlock) {
		const codeText = codeBlock[1];
		const resp = await Godbolt.cppExec(codeText);
		message.channel.send("```" + resp + "```").catch(catchHandler);
	}
};

const commandTokenVar = "$COMMAND_TOKEN$";

const helpMessageCache: Record<string, Discord.MessageEmbed> = {};
const helpMessage = (respondTo: Discord.Message) => {
	const prefix = commandFlag(respondTo);
	let message = helpMessageCache[prefix];
	if (message === undefined) {
		message = new Discord.MessageEmbed()
			.setColor("#ABCDEF")
			.setTitle("OiseauBot Help");
		function createCommandList(list: Record<string, Command>) {
			return Object.entries(list)
				.filter(([_, command]) => !command.hidden)
				.map(([commandName, command]) => command.usage.replace(commandTokenVar, prefix + commandName))
				.join("\n");
		}
		for (const channelName in commands) {
			message.addField(channelName.length == 0 ? `Commands in all channels` : `Commands in channel #${channelName}`, createCommandList(commands[channelName]));
		}
		helpMessageCache[prefix] = message;
	}
	return message;
};

const prefixesCacheKey = "prefixes";
const setPrefix: CommandFunction = (message, commandToken) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		const args = pastFirstToken(message.content, commandToken).trim();
		if (args.indexOf(" ") >= 0) {
			message.channel.send("Prefix cannot have spaces.").catch(catchHandler);
		}
		else if (args.length === 0) {
			message.channel.send("Must provide prefix").catch(catchHandler);
		}
		else {
			commandFlags[message.guild.id] = args;
			message.channel.send(`Prefix has been set to \`${args}\``).catch(catchHandler);
			Cache.put(storagePath, prefixesCacheKey, JSON.stringify(commandFlags)).catch(catchHandler);
		}
	}
};
const resetPrefix: CommandFunction = (message, commandToken) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		delete commandFlags[message.guild.id];
		message.channel.send(`Prefix has been reset to \`${commandFlagPlaceholder}\``).catch(catchHandler);
		Cache.put(storagePath, prefixesCacheKey, JSON.stringify(commandFlags)).catch(catchHandler);
	}
};

const guessScoreRole: Record<GuildId, RoleId> = {};
const getGuessScoreRole = async (guildId: GuildId) => {
	{
		const roleId = guessScoreRole[guildId];
		if (roleId === "") {
			return undefined;
		}
		if (roleId !== undefined) {
			return roleId;
		}
	}
	try {
		const storageKey = `guessScoreRole+${guildId}`;
		const role = await Cache.get(storagePath, storageKey);
		return role.data.toString();
	} catch { /*ignore*/ }
	guessScoreRole[guildId] = "";
	return undefined;
};

const setGuessScoreRole: CommandFunction = (message, commandToken, bot) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		roleCommandHelper(message, commandToken, role => {
			const guildId = message.guild.id;
			guessScoreRole[guildId] = role.id;
			const storageKey = `guessScoreRole+${guildId}`;
			Cache.put(storagePath, storageKey, role.id);
			message.channel.send(`${role.name} set as guess-the-score host`).catch(catchHandler);
		});
	}
};
const resetGuessScoreRole: CommandFunction = (message, commandToken, bot) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		const guildId = message.guild.id;
		delete guessScoreRole[guildId];
		const storageKey = `guessScoreRole+${guildId}`;
		Cache.rm(storagePath, storageKey).catch(catchHandler);
	}
};

const guessScoreHandler = async (message: Discord.Message, useRole: boolean) => {
	if (message.channel.type == "text") {
		const guessHostRole = useRole ? await getGuessScoreRole(message.guild.id) : undefined;
		if (guessHostRole === undefined || message.guild.member(message.author).roles.cache.has(guessHostRole)) {
			const attachments = message.attachments;
			try {
				if (attachments.size > 0) {
					const attached = attachments.first();
					const url = attached.url;
					const result = await fetch.default(url, { method: "HEAD" });
					const type = result.headers.get("content-type");
					switch (type) {
						case "image/png":
						case "image/jpeg":
						case "image/webp":
							break;
						default:
							return;
					}
					(message.channel as Discord.TextChannel).messages.fetchPinned().then(pinned => {
						pinned.forEach(value => value.unpin().catch(catchHandler));
						message.pin().catch(catchHandler);
					}, catchHandler);
				}
			} catch (err) {
				catchHandler(err);
			}
		}
	}
};

const setOwner: CommandFunction = (message, token, bot) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		const pastToken = pastFirstToken(message.content, token);
		const users = [...pastToken.matchAll(/<@[!&]([0-9]+)>/g)].map(v => v[1]);
		const permissions: Discord.OverwriteResolvable[] = users.map(id => {
			return { id, allow: ["EMBED_LINKS", "ATTACH_FILES", "MANAGE_MESSAGES", "MANAGE_CHANNELS", "MANAGE_ROLES"] };
		});
		const channels = [...pastToken.matchAll(/<#([0-9]+)>/g)].map(v => v[1]);
		const guild = message.guild;
		for (const channelId of channels) {
			const channel = guild.channels.cache.get(channelId);
			if (channel) {
				channel.lockPermissions().then((channel) => {
					channel.overwritePermissions(permissions).catch(catchHandler);
				}).catch(catchHandler);
			}
		}
	}
};

const stealScoreGuessHost: CommandFunction = async (message, token, bot) => {
	const guild = message.guild;
	const guildId = guild.id;
	const guessHostRole = await getGuessScoreRole(guildId);
	if (guessHostRole) {
		const users = guild.roles.resolve(guessHostRole);
		let alert = "";
		for (const [_, user] of users.members) {
			try {
				await guild.member(user).roles.remove(guessHostRole);
			} catch (err) {
				catchHandler(err);
			}
			alert += user.toString();
		}
		guild.member(message.author).roles.add(guessHostRole).catch(catchHandler);
		alert += `\n${message.author} has taken score guess host role`;
		message.channel.send(alert).catch(catchHandler);
	}
};

let alreadyGuessedBanList: Set<UserId> = undefined;
const alreadyGuessedBanStorageKey = "alreadyGuessedBan";
const initAlreadyGuessedBanList = async () => {
	if (alreadyGuessedBanList === undefined) {
		try {
			const storedList = JSON.parse((await Cache.get(storagePath, alreadyGuessedBanStorageKey)).data.toString());
			if (Array.isArray(storedList)) {
				alreadyGuessedBanList = new Set<UserId>(storedList);
			} else {
				alreadyGuessedBanList = new Set<UserId>();
			}
		} catch {
			alreadyGuessedBanList = new Set<UserId>();
		}
	}
	return alreadyGuessedBanList;
};

const alreadyGuessedBan: CommandFunction = async (message, token, bot) => {
	if (message.member.hasPermission("ADMINISTRATOR")) {
		const args = tokenize(pastFirstToken(message.content, token));
		if (args.length > 0) {
			const banList = await initAlreadyGuessedBanList();
			for (const arg of args) {
				banList.add(arg);
			}
			const banArray = JSON.stringify(Array.from(banList.values()));
			Cache.put(storagePath, alreadyGuessedBanStorageKey, banArray.toString()).catch(catchHandler);
		}
	}
};

const timestampRegex = /.*?(\d+)$/;
const getMessageDate = (message: Discord.Message, token: string) => {
	const args = tokenize(pastFirstToken(message.content, token));
	if (args.length == 1) {
		const id = timestampRegex.exec(args[0]);
		if (id) {
			return Discord.SnowflakeUtil.deconstruct(id[1]).date;
		}
	}
	return undefined;
};

const getTimestamp: CommandFunction = async (message, token, bot) => {
	const date = getMessageDate(message, token);
	if (date) {
		message.channel.send(date.toUTCString()).catch(catchHandler);
	}
};

const getTimeSince: CommandFunction = async (message, token, bot) => {
	const date = getMessageDate(message, token);
	if (date) {
		const time = (new Date()).getTime() - date.getTime();
		message.channel.send(toHms(time)).catch(catchHandler);
	}
};

const commands: Record<string, Record<string, Command>> = {
	"": {
		"sproc": {
			command: execSproc,
			explanation: "Uses sproc on given images.\nYou can either attach files, or use links and the special variable $LAST (last result) before the list of commands",
			usage: "[Attach files], $COMMAND_TOKEN$ [links] ... [sproc_commands]"
		},
		"react": {
			command: react,
			explanation: "Reacts to given messages with given emojis",
			usage: "$COMMAND_TOKEN$ [emoji | message_link] ..."
		},
		"unreact": {
			command: unreact,
			explanation: "Unreacts from given messages with given emojis",
			usage: "$COMMAND_TOKEN$ [emoji | message_link] ..."
		},
		"oiseau-prefix": {
			command: setPrefix,
			explanation: "Sets the prefix for the bot in this server (requires admin)",
			usage: "$COMMAND_TOKEN$ <prefix>"
		},
		"oiseau-prefix-reset": {
			command: resetPrefix,
			explanation: "Resets the prefix for the bot in this server (requires admin)",
			usage: "$COMMAND_TOKEN$"
		},
		"lily": {
			command: execLily,
			explanation: "Make a lilypond score/audio given lilypond code in code block. If no formats are specified, will give images. If requesting midi or mp3, you must specify a \\midi block. If requesting images or pdf, you must specify a \\layout block.",
			usage: "$COMMAND_TOKEN$ [images|pdf|midi|mp3] ... <code block with lilypond code>"
		},
		"lily-basic": {
			command: execLilyBasic,
			explanation: "Make a basic melody using lilypond syntax. If no formats are specified, will give images.",
			usage: "$COMMAND_TOKEN$ [images|pdf|midi|mp3] ... <code block with lilypond melody>"
		},
		"cpp": {
			command: execGodbolt,
			explanation: "todo",
			usage: "todo",
			hidden: true
		},
		"giveme-blacklist": {
			command: givemeBlacklist,
			explanation: "Prevents a user from using giveme for a role (requires admin)",
			usage: "$COMMAND_TOKEN$ role"
		},
		"giveme-unblacklist": {
			command: givemeUnblacklist,
			explanation: "Prevents a user from using giveme for a role (requires admin)",
			usage: "$COMMAND_TOKEN$ role"
		},
		"set-score-guess-role": {
			command: setGuessScoreRole,
			explanation: "Sets a role to be the one given to the person hosting the guess the score game",
			usage: "$COMMAND_TOKEN$ role"
		},
		"reset-score-guess-role": {
			command: resetGuessScoreRole,
			explanation: "A role will no longer be assigned to the score guess host",
			usage: "$COMMAND_TOKEN$"
		},
		"timestamp": {
			command: getTimestamp,
			explanation: "Get the timestamp for a message",
			usage: "$COMMAND_TOKEN <message url or id>"
		},
		"timesince": {
			command: getTimeSince,
			explanation: "Get the time since a message",
			usage: "$COMMAND_TOKEN <message url or id>"
		},
		"already-guessed-ban": {
			command: alreadyGuessedBan,
			explanation: "",
			usage: "",
			hidden: true
		}
	},
	"bot-spam": {
		"hi": { command: sayHi, explanation: "Says hello", usage: "$COMMAND_TOKEN$" },
		"hello": { command: sayHi, explanation: "Says hello", usage: "$COMMAND_TOKEN$" },
		"help": { command: help, explanation: "Gives help, in general or for the specified command", usage: "$COMMAND_TOKEN$ [command_name]" },
		"hangman": { command: hangman, explanation: "Play composer hangman!", usage: "$COMMAND_TOKEN$ [help]" },
		"hm": { command: hangman, explanation: "Play composer hangman!", usage: "$COMMAND_TOKEN$ [help]" }
	},
	"new-roles": {
		"giveme": { command: giveRole, explanation: "Gives you a role", usage: "$COMMAND_TOKEN$ <role>" },
		"takeaway": { command: takeRole, explanation: "Takes a role from you", usage: "$COMMAND_TOKEN$ <role>" },
		"roles": { command: listRoles, explanation: "List the roles I can give", usage: "$COMMAND_TOKEN$" }
	},
	"guess-the-score": {
		"steal": {
			command: stealScoreGuessHost,
			explanation: "Take score guess host role by force",
			usage: "$COMMAND_TOKEN$"
		}
	}
};

function help(message: Discord.Message, commandToken: string) {
	const args = tokenize(pastFirstToken(message.content, commandToken));
	if (args.length == 0) {
		message.channel.send(helpMessage(message)).catch(catchHandler);
	}
	else {
		const commandName = args[0];
		const flag = commandFlag(message);
		const lookupName = (() => {
			if (commandName.startsWith(flag)) {
				return commandName.substring(flag.length);
			}
			return commandName;
		})();
		for (const channelName in commands) {
			const channelCommands = commands[channelName];
			const command = channelCommands[lookupName];
			if (command) {
				const fixedName = flag + lookupName;
				const commandHelpMessage = new Discord.MessageEmbed()
					.setColor("#123456")
					.setTitle("OiseauBot Help")
					.addField(`Help for ${fixedName}` + (channelName.length == 0 ? " in all channels" : ` in channel ${channelName}`),
						`${command.usage.replace(commandTokenVar, fixedName)} \n${command.explanation}`);
				message.channel.send(commandHelpMessage).catch(catchHandler);
				return;
			}
		}
		message.channel.send(`Command ${commandName} does not exist`).catch(catchHandler);
	}
};

const findEmoji = (emojiName: string, bot: Discord.Client) => {
	for (const [id, guild] of bot.guilds.cache) {
		const emojis = guild.emojis.cache;
		for (const [emoji_id, emoji] of emojis) {
			if (emojiName === emoji.name) {
				return emoji;
			}
		}
	}
	return undefined;
};

const sendEmoji = (message: Discord.Message, bot: Discord.Client) => {
	const text = message.content;
	if (fitsEmojiNamePattern(text) && hasChannelPermission(message, "USE_EXTERNAL_EMOJIS")) {
		const emojiName = extractEmojiName(text);
		const emoji = findEmoji(emojiName, bot);
		if (emoji) {
			message.channel.send(`${emoji}`).catch(catchHandler);
			return true;
		}
	}
	return false;
};

type Deletable = Discord.Message | Discord.PartialMessage;
const findAtted = async (message: Deletable) => {
	const pingRegex = /<@([!&])[0-9]+>/g;
	const matches = message.content.match(pingRegex);
	if (!matches || matches.length === 0) {
		return undefined;
	}
	const ret: (Discord.User | Discord.Role)[] = [];
	for (const match of matches) {
		const isRolePing = (match[2] == '&');
		const id = match.substring(3, match.length - 1);
		const pinged = isRolePing ? (await message.guild.roles.fetch(id)) : (await message.guild.members.fetch(id))?.user;
		if (pinged) {
			ret.push(pinged);
		}
	}
	return ret;
};
const enumerateUsers = (authors: any[]) => {
	if (authors.length === 0) {
		return "<Failed to find target user>";
	}
	return authors.join("\n");
};
const toHms = (millis: number) => {
	let seconds = millis / 1000;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	seconds = Math.floor(seconds);
	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${(millis % 1000).toString().padStart(3, "0")}`;
	}
	if (minutes > 0) {
		return `${minutes}:${seconds.toString().padStart(2, "0")}.${(millis % 1000).toString().padStart(3, "0")}`;
	}
	return `${seconds}.${(millis % 1000).toString().padStart(3, "0")}s`;
};

const msSince = (date: Date) => {
	const now = new Date();
	return now.getTime() - date.getTime();
};

const installHandlers = async (bot: Discord.Client) => {
	try {
		const prefixData = await Cache.get(storagePath, prefixesCacheKey);
		commandFlags = JSON.parse(prefixData.data.toString());
	} catch (err) {
		catchHandler(err);
	}
	const messageHandler = (message: Discord.Message) => {
		if (message.author.id === bot.user.id) {
			return;
		}
		if (message.channel.type === "text" && hasChannelPermission(message, "SEND_MESSAGES")) {
			const channel = message.channel as Discord.TextChannel;
			const flag = commandFlag(message);
			const firstWord = firstToken(message.content);
			let commandFound = false;
			if (firstWord.startsWith(flag)) {
				const commandName = firstWord.substring(flag.length);
				const findCommand = (commands: Record<string, Command>) => {
					if (commands) {
						const command = commands[commandName];
						if (command) {
							command.command(message, firstWord, bot);
							return true;
						}
					}
					return false;
				};
				commandFound = findCommand(commands[channel.name]) || findCommand(commands[""]);
			}
			if (!commandFound) {
				if (channel.name !== "new-roles") {
					sendEmoji(message, bot);
				}
				switch (channel.name) {
					case "bot-spam": {
						if (message.content.length === 1 && message.content.match(/[A-Z]/i)) {
							const game = hangmanGames[message.author.id];
							if (game) {
								const whatToGuess = message.content.toUpperCase();
								hangmanGuess(message, game, whatToGuess);
							}
						}
					} break;
					case "new-roles": {
						deleteExtraneous(message);
					} break;
					case "guess-the-score": {
						guessScoreHandler(message, true);
					} break;
					case "guess-the-score-for-idiots": {
						guessScoreHandler(message, false);
					} break;
				}
			}
		}
	};

	const findReferenced = async (message: Deletable) => {
		const ref = message.reference;
		if (ref) {
			try {
				const reffedChannel = bot.guilds.cache.get(ref.guildID)?.channels.cache.get(ref.channelID);
				if (reffedChannel?.type === "text") {
					const reffedMessage = await (reffedChannel as Discord.TextChannel).messages.fetch(ref.messageID);
					if (reffedMessage) {
						return [reffedMessage.author];
					}
				}
			} catch (err) { catchHandler(err); }
			return [];
		}
		return undefined;
	};

	const deleteHandler = async (deleted: Deletable) => {
		{
			const toDelete = toBeDeleted[deleted.id];
			if (toDelete) {
				clearTimeout(toDelete);
				delete toBeDeleted[deleted.id];
			}
		}
		if (deleted.author.id === bot.user.id || deleted.system) {
			return;
		}
		try {
			const pinged = await Promise.all([findReferenced(deleted), findAtted(deleted)]);
			const referenced = pinged[0];
			const atted = pinged[1];
			if (referenced !== undefined || atted != undefined) {
				const logChannel = deleted.guild.channels.cache.find(channel => channel.name === "ghost-pings");
				if (logChannel.type === "text") {
					const now = new Date();
					const alert = new Discord.MessageEmbed()
						.setTitle("Ghost Ping")
						.addFields(
							{ name: "User", value: deleted.author || "<Failed to find author>" },
							{ name: "Message", value: deleted.content || "<Empty Message>" },
							{ name: "Channel", value: deleted.channel || "<Failed to find channel>" })
						.setTimestamp(now);
					if (referenced != undefined) {
						alert.addField("Replied To", enumerateUsers(referenced), true);
					}
					if (atted != undefined) {
						alert.addField("@ed", enumerateUsers(atted), true);
					}
					alert.addField("Time Before Deletion", toHms(now.getTime() - deleted.createdAt.getTime()));
					(logChannel as Discord.TextChannel).send(alert).catch(err => console.error(err));
				}
			}
		} catch (err) {
			console.error(err);
		}
	};

	//for (const [guildId, guild] of bot.guilds.cache) {
	//	const guessHostRole = await getGuessScoreRole(guildId);
	//	if (guessHostRole !== undefined) {
	//		const channel = guild.channels.cache.find((cn) => cn.name === "guess-the-score" && cn.type === "text") as Discord.TextChannel;
	//		if (channel) {
	//			channel.messages.fetchPinned().then(pinned => {
	//				if (pinned.size) {
	//					let latest = Number.NEGATIVE_INFINITY;
	//					let latestMsgId: string = null;
	//					for (const [_, message] of pinned.entries()) {
	//						if (message.createdTimestamp > latest) {
	//							latest = message.createdTimestamp;
	//							latestMsgId = message.id;
	//						}
	//					}
	//					channel.messages.fetch({ after: latestMsgId }).catch(catchHandler);
	//				}
	//			}, catchHandler);
	//		}
	//	}

	//}

	const messageReactionHandler = async (reaction: Discord.MessageReaction, user: Discord.User) => {
		if (reaction.emoji.name === "🍪") {
			const message = reaction.message;
			if (message.channel.type === "text" && (message.channel as Discord.TextChannel).name === "guess-the-score") {
				const guild = message.guild;
				const guildId = guild.id;
				const guessHostRole = await getGuessScoreRole(guildId);
				if (guessHostRole && guild.member(user).roles.cache.has(guessHostRole)) {
					guild.member(user).roles.remove(guessHostRole).catch(catchHandler);
					guild.member(message.author).roles.add(guessHostRole).catch(catchHandler);
					// message.channel.messages.cache.clear();
				}
			}
		}
	};

	const active = "ACTIVE SCORE CHANNELS";
	const inactive = "NOT REALLY ACTIVE SCORE CHANNELS";

	const findCategoryIds = (guild: Discord.Guild) => {
		let activeCategoryId: string = null;
		let inactiveCategoryId: string = null;
		for (const [channelId, channel] of guild.channels.cache) {
			if (channel.type === "category") {
				const name = channel.name.toUpperCase();
				if (name === active) {
					activeCategoryId = channel.id;
				}
				else if (name === inactive) {
					inactiveCategoryId = channel.id;
				}
			}
		}
		return [activeCategoryId, inactiveCategoryId];
	};
	let activeChannelMoves = 0;
	const pollInterval = 5 * 60000; // race condition-heavy but okay
	const pollActivity = () => {
		// assumes category names are unique
		for (const [guildId, guild] of bot.guilds.cache) {
			const moveToInactive: Discord.GuildChannel[] = [];
			const moveToActive: Discord.GuildChannel[] = [];
			const [activeCategoryId, inactiveCategoryId] = findCategoryIds(guild);
			for (const [channelId, channel] of guild.channels.cache) {
				if (channel.type === "text") {
					const timeLimit = 1000 * 60 * 60 * 24 * 7 * 2; // 2 weeks
					const id = channel.parent?.id;
					if (id === activeCategoryId) {
						const ch = channel as Discord.TextChannel;
						ch.messages.fetch({ limit: 1 }).then((messages) => {
							if (!messages.first() || msSince(messages.first().createdAt) > timeLimit) {
								++activeChannelMoves;
								ch.setParent(inactiveCategoryId, { lockPermissions: false }).catch(catchHandler).finally(() => {
									--activeChannelMoves;
								});
							}
						}, () => { });
					}
					else if (id === inactiveCategoryId) {
						const ch = channel as Discord.TextChannel;
						ch.messages.fetch({ limit: 1 }).then((messages) => {
							if (messages.first() && msSince(messages.first().createdAt) <= timeLimit) {
								++activeChannelMoves;
								ch.setParent(activeCategoryId, { lockPermissions: false }).catch(catchHandler).finally(() => {
									--activeChannelMoves;
								});
							}
						}, () => { });
					}
				}
			}
		}
		setTimeout(() => {
			if (activeChannelMoves > 0) {
				return;
			}
			const nameCmp = (a: Discord.GuildChannel, b: Discord.GuildChannel) => {
				return a.name.localeCompare(b.name);
			};
			for (const [guildId, guild] of bot.guilds.cache) {
				const active: Discord.GuildChannel[] = [];
				const inactive: Discord.GuildChannel[] = [];
				const [activeCategoryId, inactiveCategoryId] = findCategoryIds(guild);
				if (!activeCategoryId || !inactiveCategoryId) {
					continue;
				}
				for (const [channelId, channel] of guild.channels.cache) {
					const id = channel.parent?.id;
					if (id === activeCategoryId) {
						active.push(channel);
					}
					else if (id === inactiveCategoryId) {
						inactive.push(channel);
					}
				}
				const sortGroup = (group: Discord.GuildChannel[]) => {
					group.sort(nameCmp);
					if (group.some((channel, index) => channel.position != index)) {
						console.log(`${new Date()} Sorting channels`);
						let i = 0;
						const callback = () => {
							++i;
							if (i < group.length) {
								group[i].setPosition(i).then(callback, catchHandler);
							}
						};
						group[0].setPosition(0).then(callback, catchHandler);
					}
				};
				sortGroup(active);
				sortGroup(inactive);
			}
		}, pollInterval / 2);
	};
	setTimeout(pollActivity, 5000);
	setInterval(pollActivity, pollInterval);

	bot.on("message", messageHandler);
	bot.on("messageDelete", deleteHandler);
	bot.on("messageReactionAdd", messageReactionHandler);
	return { message: messageHandler, messageDelete: deleteHandler, messageReactionAdd: messageReactionHandler };
};


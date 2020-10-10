export { messageHandler }
import * as Discord from "discord.js";
import * as StringSimilarity from "string-similarity";
import { Hangman, cleanCharacters } from "./hangman";
import { fetchComposerList, ComposerData, fetchComposerPageSize, fetchComposerCategories } from "./wiki_composer";
import { executeSproc, cleanupSproc } from "./sproc";

type CommandFunction = (message: Discord.Message, commandToken: string) => any;

const catchHandler = (err: any) => {
	console.error(err);
}

interface Command {
	command: CommandFunction;
	explanation: string;
	usage: string;
}

const commandFlag = "!";

function removeCommandFlag(token: string) {
	return token.substring(commandFlag.length);
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
	var regex = /[^\s"]+|"(\\"|[^"]*)"/gi;
	var tokens: string[] = [];
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
	const greeting = capitalizeFirstLetter(removeCommandFlag(commandToken));
	message.channel.send({ content: `${greeting} <@${message.author.id}>` }).catch(catchHandler);
};

function noRoleArgumentResponse(message: Discord.Message) {
	return message.channel.send(`<@${message.author.id}>, you must provide a role argument`).catch(catchHandler);
}

function noRoleExistReponse(message: Discord.Message, roleName: string) {
	const roles = message.guild.roles.cache;
	const rolesArray = roles.map(role => role.name);
	const nearest = StringSimilarity.findBestMatch(roleName, rolesArray);
	if (nearest.bestMatchIndex < rolesArray.length && nearest.bestMatch.rating > 0 && nearest.bestMatch.target.substring(0, 1) !== "@") {
		return message.channel.send(`<@${message.author.id}>, the role ${roleName} does not exist. Did you mean ${rolesArray[nearest.bestMatchIndex]}?`).catch(catchHandler);
	}
	return message.channel.send(`<@${message.author.id}>, the role ${roleName} does not exist`).catch(catchHandler);
}

function findRole(roles: Discord.RoleManager, roleName: string) {
	return roles.cache.find(role => role.name == roleName);
}

function findRoleId(roles: Discord.GuildMemberRoleManager, roleId: string) {
	return roles.cache.get(roleId);
}

const giveRole: CommandFunction = (message, commandToken) => {
	const guild = message.guild;
	const roles = guild.roles;
	const text = message.content;
	const desiredRoleName = pastFirstToken(message.content, commandToken).trim();
	if (desiredRoleName.length == 0) {
		noRoleArgumentResponse(message);
	}
	const role = findRole(roles, desiredRoleName);
	if (role) {
		const userRoles = guild.member(message.author.id).roles;
		if (findRoleId(userRoles, role.id)) {
			message.channel.send(`<@${message.author.id}>, you already have role ${desiredRoleName}`).catch(catchHandler);
		}
		else {
			userRoles.add(role).then(
				() => {
					message.channel.send(`<@${message.author.id}>, you have been given role ${desiredRoleName}`).catch(catchHandler);
				},
				() => {
					message.channel.send(`<@${message.author.id}>, I cannot give you role ${desiredRoleName}`).catch(catchHandler);
				});
		}
	}
	else {
		noRoleExistReponse(message, desiredRoleName);
	}
};

const takeRole: CommandFunction = (message, commandToken) => {
	const guild = message.guild;
	const roles = guild.roles;
	const desiredRoleName = pastFirstToken(message.content, commandToken).trim();
	if (desiredRoleName.length == 0) {
		noRoleArgumentResponse(message);
	}
	const role = findRole(roles, desiredRoleName);
	if (role) {
		const userRoles = guild.member(message.author.id).roles;
		if (!findRoleId(userRoles, role.id)) {
			message.channel.send(`<@${message.author.id}>, you do not have role ${desiredRoleName}`).catch(catchHandler);
		}
		else {
			userRoles.remove(role).then(
				() => {
					message.channel.send(`<@${message.author.id}>, you have lost role ${desiredRoleName}`).catch(catchHandler);
				},
				() => {
					message.channel.send(`<@${message.author.id}>, I cannot remove role ${desiredRoleName}`).catch(catchHandler);
				});
		}
	}
	else {
		noRoleExistReponse(message, desiredRoleName);
	}
};

class ComposerHangman extends Hangman {
	readonly realName: string;
	readonly dates: string;
	readonly url: string;
	private categories?: string[];
	private dateHintUsed: boolean;
	private hintsUsed: string[];
	constructor(realname: string, dates: string, lives: number, url: string) {
		super(cleanCharacters(realname), lives, " ?");
		this.realName = realname;
		this.dates = dates;
		this.url = url;
		this.dateHintUsed = false;
		this.hintsUsed = [];
	}

	async getHint() {
		if (!this.dateHintUsed) {
			this.dateHintUsed = true;
			return this.dates;
		}
		if (this.categories === undefined) {
			const list = await fetchComposerCategories(this.url);
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
	return `${message}\n\`\`${game.locationCorrect.map(getReplacementChar).join("")}\`\`\n${livesMessage()}`
}

function hangmanCompleteMessage(game: ComposerHangman) {
	return `The answer was ${game.answer} (${game.realName}) (${game.dates})`;
}

type difficulty = "easiest" | "easy" | "medium" | "hard" | "hardest";

function startGame(message: Discord.Message, difficult: difficulty) {
	const authorId = message.author.id;
	if (hangmanGames[authorId]) {
		message.channel.send(`<@${authorId}>, you already have a game ongoing`).catch(catchHandler);
		return;
	}
	fetchComposerList().then(async (composerData) => {
		if (composerData && composerData.length > 0) {
			const candidatesToConsider = Math.min(30, composerData.length);
			const candidates: number[] = [];
			const queries: (Promise<number> | undefined)[] = [];
			for (let i = 0; i < candidatesToConsider; ++i) {
				const index = Math.floor(Math.random() * composerData.length);
				const composer = composerData[index];
				candidates.push(index);
				if (!composer.pageSize) {
					queries.push(fetchComposerPageSize(composer.pageUrl));
				}
				else {
					queries.push(undefined);
				}
			}
			for (let i = 0; i < candidatesToConsider; ++i) {
				if (queries[i]) {
					const pageSize = await queries[i];
					composerData[candidates[i]].pageSize = pageSize;
				}
			}
			// could use nth_element, but meh
			candidates.sort((index1, index2) => {
				return composerData[index1].pageSize - composerData[index2].pageSize;
			});
			const debugCandidatesInfo = candidates.map(index => composerData[index]);
			const choice = (() => {
				switch (difficult) {
					case "easiest":
						return candidatesToConsider - 1;
					case "easy":
						return Math.floor(3 * candidatesToConsider / 4);
					case "medium":
						return Math.floor(candidatesToConsider / 2);
					case "hard":
						return Math.floor(candidatesToConsider / 4);
					case "hardest":
						return 0;
				}
			})();
			const composer = composerData[candidates[choice]];
			const game = hangmanGames[authorId] = new ComposerHangman(composer.name, composer.dates, 7, composer.pageUrl);
			message.channel.send(hangmanMessage(game, `Game start. Difficulty: ${difficult}`, message.author, false));
		}
		else {
			message.channel.send("Could not retrieve composer database");
		}
	});
}

function hangmanGuess(message: Discord.Message, game: ComposerHangman, guess: string) {
	const authorId = message.author.id;
	const guessed = game.guess(guess);
	if (typeof guessed === "string") {
		message.channel.send(`<@${authorId}>, ${guessed}`);
	}
	else {
		if (guessed == 0) {
			if (game.loss()) {
				message.channel.send(hangmanMessage(game, `"${guess}" not found, you lost!`, message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
				delete hangmanGames[authorId]
			}
			else {
				message.channel.send(hangmanMessage(game, `"${guess}" not found`, message.author, false)).catch(catchHandler);
			}
		}
		else {
			const plural = guessed == 1 ? "1 occurence" : `${guessed} occurences`;
			if (game.victory()) {
				message.channel.send(hangmanMessage(game, `${plural} found of "${guess}". You win!`, message.author, true) + "\n" + hangmanCompleteMessage(game)).catch(catchHandler);
				delete hangmanGames[authorId];
			}
			else {
				message.channel.send(hangmanMessage(game, `${plural} found of "${guess}"`, message.author, false)).catch(catchHandler);
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
						.addField("Commands", "Start Game: !hangman [difficulty: easiest, easy, medium, hard, hardest]\nGuess: !hangman guess <letter>\nGuess (shorthand): <single letter>\nSolve: !hangman solve <answer>\nHint: !hangman hint\nGive Up: !hangman giveup")).catch(catchHandler);
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

function hasGuildPermission(message: Discord.Message, permission: Discord.PermissionString) {
	const permissions = message.guild.me.permissions;
	return permissions.has(permission);
}

function hasChannelPermission(message: Discord.Message, permission: Discord.PermissionString) {
	const permissions = message.guild.me.permissionsIn(message.channel);
	return permissions.has(permission);
}

type GuildId = string;
type UserId = string;
const lastSprocRequests: Record<GuildId, Record<UserId, { channel: string, messages: string[] }>> = {}

const getLast = async (addTo: string[], message: Discord.Message) => {
	const lastRequestGuild = lastSprocRequests[message.guild.id];
	if (!lastRequestGuild) {
		return false;
	}
	const lastRequest = lastRequestGuild && lastRequestGuild[message.member.id];
	if (!lastRequest) {
		return false;
	}
	const channel = message.guild.channels.cache.get(lastRequest.channel) as Discord.TextChannel;
	if (!channel) {
		return false;
	}
	for (const responseId of lastRequest.messages) {
		try {
			const resp = await channel.messages.fetch(responseId);
			for (const attachment of resp.attachments) {
				addTo.push(attachment[1].url);
			}
		}
		catch{
			return false;
		}
	}
	return true;
};

const execSproc: CommandFunction = async (message, commandToken) => {
	if (!hasChannelPermission(message, "ATTACH_FILES")) {
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
			if (arg.toUpperCase() === "$LAST") {
				if (!(await getLast(attachments, message))) {
					message.channel.send("Failed to retrieve last request").catch(catchHandler);
					return;
				}
			}
			else {
				attachments.push(arg);
			}
		}
		if (!foundCommands) {
			message.channel.send("No commands given").catch(catchHandler);
			return;
		}
	}
	if (attachments.length == 0) {
		message.channel.send("You have nothing to process").catch(catchHandler);
	}
	executeSproc(attachments, args.map(arg => arg.toString())).then(async (result) => {
		const output = result.sprocOutput.trim();
		if (output.length != 0) {
			try {
				await message.channel.send(output);
			} catch (ex) {
				catchHandler(ex);
			}
		}
		const lastRequestGuild = lastSprocRequests[message.guild.id] || (lastSprocRequests[message.guild.id] = {});
		lastRequestGuild[message.author.id] = {
			channel: message.channel.id,
			messages: []
		};
		const responses = lastRequestGuild[message.author.id].messages;
		for (let i = 0; i < result.filePaths.length; ++i) {
			try {
				const attachment = new Discord.MessageAttachment(result.filePaths[i]);
				const sent = await message.channel.send(attachment);
				responses.push(sent.id);
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
		cleanupSproc(result);
	}).catch(error => {
		message.channel.send(`Error: ${error}`).catch(catchHandler);
	});
};

const noRolesMessage = "I can give you no roles";

const listRoles: CommandFunction = (message, commandToken) => {
	if (!hasGuildPermission(message, "MANAGE_ROLES")) {
		message.channel.send(noRolesMessage).catch(catchHandler);
		return;
	}
	const guild = message.guild;
	const roles = guild.roles;
	const bot = message.client.user;
	const botRole = guild.me.roles.highest;
	const list = roles.cache.array()
		.sort((role1, role2) => role2.position - role1.position)
		.map((role) => {
			if (role.position < botRole.position && role.name != "@everyone") {
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

const commands: Record<string, Record<string, Command>> = {
	"": {
		"!sproc": { command: execSproc, explanation: "Uses sproc on given images", usage: "[Attach files], !sproc [links] [sproc_commands]" }
	},
	"bot-spam": {
		"!hi": { command: sayHi, explanation: "Says hello", usage: "!hi" },
		"!hello": { command: sayHi, explanation: "Says hello", usage: "!hello" },
		"!help": { command: help, explanation: "Gives help, in general or for the specified command", usage: "!help [command_name]" },
		"!hangman": { command: hangman, explanation: "Play composer hangman!", usage: "!hangman [help]" },
		"!hm": { command: hangman, explanation: "Play composer hangman!", usage: "!hm [help]" }
	},
	"new-roles":
	{
		"!giveme": { command: giveRole, explanation: "Gives you a role", usage: "!giveme <role>" },
		"!takeaway": { command: takeRole, explanation: "Takes a role from you", usage: "!takeaway <role>" },
		"!roles": { command: listRoles, explanation: "List the roles I can give", usage: "!roles" }
	}
};

const helpMessage = (() => {
	const message = new Discord.MessageEmbed()
		.setColor("#ABCDEF")
		.setTitle("OiseauBot Help");
	function createCommandList(list: Record<string, Command>) {
		return Object.values(list).map(command => command.usage).join("\n");
	}
	for (const channelName in commands) {
		message.addField(channelName.length == 0 ? `Commands in all channels` : `Commands in channel #${channelName}`, createCommandList(commands[channelName]));
	}
	return message;
})();

function help(message: Discord.Message, commandToken: string) {
	const args = tokenize(pastFirstToken(message.content, commandToken));
	if (args.length == 0) {
		message.channel.send(helpMessage).catch(catchHandler);
	}
	else {
		const commandName = args[0];
		const lookupName = (() => {
			if (commandName.startsWith(commandFlag)) {
				return commandName;
			}
			return "!" + commandName;
		})();
		for (const channelName in commands) {
			const channelCommands = commands[channelName];
			const command = channelCommands[lookupName];
			if (command) {
				const commandHelpMessage = new Discord.MessageEmbed()
					.setColor("#123456")
					.setTitle("OiseauBot Help")
					.addField(`Help for ${lookupName} in channel ${channelName}`, `${command.usage}\n${command.explanation}`);
				message.channel.send(commandHelpMessage).catch(catchHandler);
				return;
			}
		}
		message.channel.send(`Command ${commandName} does not exist`).catch(catchHandler);
	}
};

const messageHandler = (message: Discord.Message) => {
	if (message.channel.type === "text" && hasChannelPermission(message, "SEND_MESSAGES")) {
		const channel = message.channel as Discord.TextChannel;
		const findCommand = (commands: Record<string, Command>) => {
			if (commands) {
				const firstWord = firstToken(message.content);
				if (firstWord.startsWith(commandFlag)) {
					const command = commands[firstWord];
					if (command) {
						command.command(message, firstWord);
						return true;
					}
				}
			}
			return false;
		};
		findCommand(commands[channel.name]) || findCommand(commands[""]);
		if (channel.name === "bot-spam" && message.content.length === 1 && message.content.match(/[A-Z]/i)) {
			const game = hangmanGames[message.author.id];
			if (game) {
				const whatToGuess = message.content.toUpperCase();
				hangmanGuess(message, game, whatToGuess);
			}
		}
	}
};
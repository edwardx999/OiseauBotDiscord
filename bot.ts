import * as Discord from "discord.js";
import * as fs from "fs";
import { createMessageHandler } from "./message_handler";
const args = process.argv;

if (args.length != 3) {
	process.stderr.write("must give file containing token\n");
	process.exit(1);
}

const filename = args[2];
const token = fs.readFileSync(filename).toString();

const client = new Discord.Client();

// doesn't work
client.on("ready", () => {
	client.user.setActivity({
		type: "LISTENING",
		name: "Use !help in #bot-spam for help"
	}).catch(err => console.error(err));
	console.log("Connected");
});

client.on("message", createMessageHandler(client));

{
	type Deletable = Discord.Message | Discord.PartialMessage;
	const findReferenced = async (message: Deletable) => {
		const ref = message.reference;
		if (ref) {
			try {
				const reffedChannel = client.guilds.cache.get(ref.guildID)?.channels.cache.get(ref.channelID);
				if (reffedChannel?.type === "text") {
					const reffedMessage = await (reffedChannel as Discord.TextChannel).messages.fetch(ref.messageID);
					if (reffedMessage) {
						return [reffedMessage.author];
					}
				}
			} catch { }
			return [];
		}
		return undefined;
	};
	const findAtted = (message: Deletable) => {
		const pingRegex = /<@![0-9]+>/g;
		const matches = message.content.match(pingRegex);
		if (!matches || matches.length === 0) {
			return undefined;
		}
		const ret: Discord.User[] = [];
		for (const match of matches) {
			const id = match.substr(3, match.length - 4);
			const author = message.guild.members.cache.get(id).user;
			if (author) {
				ret.push(author);
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
	client.on("messageDelete", async (deleted) => {
		if (deleted.author.id === client.user.id) {
			return;
		}
		try {
			const referenced = (await findReferenced(deleted));
			const atted = findAtted(deleted);
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
	});
}

client.login(token);

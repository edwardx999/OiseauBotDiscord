import * as Discord from "discord.js";
import * as fs from "fs";
import { installHandlers } from "./handlers";
const args = process.argv;

if (args.length != 3) {
	process.stderr.write("must give file containing token\n");
	process.exit(1);
}

const filename = args[2];
const token = fs.readFileSync(filename).toString();

const client = new Discord.Client({ intents: ["GUILDS", "GUILD_MESSAGES", "GUILD_MESSAGE_REACTIONS", "GUILD_MEMBERS"] });

client.on("ready", () => {
	const setActivity = () => client.user.setActivity("VogelBot will vö­geln", { type: "PLAYING" });
	setActivity();
	setInterval(setActivity, 1000 * 60 * 60);
	console.log("Connected");
});

installHandlers(client).then(handlers => {
	client.login(token);
});



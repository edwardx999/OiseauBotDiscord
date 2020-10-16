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
});

client.on("message", createMessageHandler(client));

client.login(token);

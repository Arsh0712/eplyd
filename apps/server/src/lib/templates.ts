import fs from 'node:fs';
import path from 'node:path';

export type TemplateKind = 'empty' | 'discordpy' | 'discordjs';

/** Write starter files for a new project. All templates are runnable bots. */
export function writeTemplate(dir: string, kind: TemplateKind): void {
  fs.mkdirSync(dir, { recursive: true });
  switch (kind) {
    case 'discordpy': {
      fs.writeFileSync(
        path.join(dir, 'main.py'),
        `import os
import discord

intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)


@client.event
async def on_ready():
    print(f"Logged in as {client.user} (ID: {client.user.id})")


@client.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if message.content.strip() == "!ping":
        await message.reply("Pong!")


if __name__ == "__main__":
    token = os.environ.get("DISCORD_TOKEN")
    if not token:
        raise SystemExit("DISCORD_TOKEN environment variable is not set")
    client.run(token)
`,
        { mode: 0o644 }
      );
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'discord.py>=2.3.2\n', { mode: 0o644 });
      break;
    }
    case 'discordjs': {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(
          {
            name: 'discord-bot',
            version: '1.0.0',
            private: true,
            main: 'index.js',
            scripts: { start: 'node index.js' },
            dependencies: {
              'discord.js': '^14.16.3'
            }
          },
          null,
          2
        ) + '\n',
        { mode: 0o644 }
      );
      fs.writeFileSync(
        path.join(dir, 'index.js'),
        `const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(\`Logged in as \${client.user.tag}\`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim() === '!ping') {
    await message.reply('Pong!');
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN environment variable is not set');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
`,
        { mode: 0o644 }
      );
      break;
    }
    case 'empty':
    default: {
      fs.writeFileSync(
        path.join(dir, 'README.md'),
        '# My bot\n\nUpload a ZIP, import from Git, or add files in the Files tab.\nSet the start command in Settings if auto-detection does not find one.\n',
        { mode: 0o644 }
      );
      break;
    }
  }
  fs.mkdirSync(path.join(dir, '.eplyd', 'tmp'), { recursive: true });
}

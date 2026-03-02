![ModMail SVG Icon][/static/modmail.svg]

# ModMail for Overwatch

*Forked from Dragory/modmailbot to whom we am eternally grateful!*

## Running

You will need a MySQL 8 database running for the bot to connect to. This is
most easily done with Docker Compose and the compose.dev.yml file. After that,
it's a simple `bun run dev` to get the bot (including the logs webserver) going.

There are **two** files you need to be aware of - config.toml and secrets.toml - 
the secrets file is explicitly *not* to be committed into the repository as it 
contains discord credentials. The rest of the config is fine enough to share.

## Contributing

Although this is a pretty closed project, if there's something you want to add, 
either from a user point of view or a moderator point of view, there's no harm
in starting a pull request. much appreciation and love

## Forking, or using elsewhere

All yours. Do whatever you'd like to with it. Keep in mind we cannot provide 
support, and neither can Dragory, as this is *heavily* modified. Please do not
go spamming anyone, *especially not Dragory*, for help.

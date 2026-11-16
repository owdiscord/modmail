export const PrivacyPolicy = () => <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <title>ModMail Privacy Policy</title>
    <style>
      {`
        body {
          font-family: -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, Adwaita Sans, Cantarell, Ubuntu, roboto, noto, helvetica, arial, sans-serif;
          margin: 0;
          background-color: #fff;
          color: #0d1117;
        }

        @media (prefers-color-scheme: dark) {
          body {
            background-color: #0d1117;
            color: #fff;
          }
        }

        a {
          color: #f06414;
        }

        article {
          margin: 0 auto;
          max-width: 80ch;
          padding: 2rem 0;
        }
`}
    </style>
  </head>
  <body>
    <article>
      <h1>ModMail Privacy Policy</h1>
      <h2>Bot overview</h2>
      <p>Modmail is a ticketing system that lets users contact server staff through the bot instead of messaging staff members individually or pinging them publicly in the server.</p>
      <p>The bot's source code is available on <a href="https://github.com/owdiscord/modmail">GitHub</a></p>

      <h2>Stored personal data</h2>
      <p>The bot stores full transcripts of modmail threads. These transcripts include:</p>
      <ul>
        <li>User ID, username, nickname, and display name of the contacting or contacted user</li>
        <li>User ID, username, nickname, and display name of any moderators participating in the thread</li>
      </ul>

      <p>In addition, the bot stores:</p>
      <ul>
        <li>User ID and username of users blocked from contacting the bot</li>
        <li>User ID of author and target user of notes saved in the bot</li>
        <li>User ID of the author of snippets saved in the bot</li>
      </ul>

      <h2>Data retention</h2>
      <p>The bot stores full transcripts of modmail threads. These transcripts include:</p>
      <ul>
        <li>Thread transcripts are stored until manually deleted</li>
        <li>User IDs tied to notes are stored until the note is deleted</li>
        <li>User IDs tied to snippets are stored until the snippet is deleted</li>
      </ul>

      <h2>Data access and deletion requests</h2>
      <p>To request access to your data or for your data to be deleted, please contact any member of the <a href="https://owdiscord.com/invite">Overwatch Server</a> Admin team, either via direct message or by messaging the ModMail instance. Alternatively, you can email the maintainer by reversing "caasi", followed by "@grphcrtv.com". This has been obscured to prevent botting; not to discourage regular contact.</p>
      <p style="font-size:.9rem"><em>Last updated 2026-01-06</em></p>
    </article>
  </body>
</html>

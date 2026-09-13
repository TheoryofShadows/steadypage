'use strict';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout({ title, user, body, flash }) {
  const nav = user
    ? `<a href="/dashboard">Dashboard</a>
       <a href="/s/${escapeHtml(user.status_slug)}" target="_blank" rel="noopener">Status page</a>
       <form method="post" action="/logout" style="display:inline"><button type="submit" class="linkish">Log out</button></form>`
    : `<a href="/login">Log in</a> <a href="/signup" class="btn">Sign up</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · SteadyPage</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="top">
    <a class="logo" href="/">SteadyPage</a>
    <nav>${nav}</nav>
  </header>
  ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ''}
  <main>${body}</main>
  <footer>
    <p>SteadyPage — uptime checks + public status pages for indie apps.</p>
    <p><a href="https://github.com/TheoryofShadows/steadypage">Source on GitHub</a></p>
  </footer>
</body>
</html>`;
}

module.exports = { escapeHtml, layout };

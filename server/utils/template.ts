import type { Link } from '#shared/schemas/link'
import { escape } from 'es-toolkit/string'
import { parseURL } from 'ufo'

function buildMetaTags(link: Link, baseUrl: string) {
  const { host: hostname } = parseURL(link.url)
  const title = link.title || hostname || 'Link'
  const hasImage = !!link.image
  const imageUrl = hasImage && link.image!.startsWith('/')
    ? `${baseUrl}${link.image}`
    : link.image
  const twitterCard = hasImage ? 'summary_large_image' : 'summary'

  const tags = [
    link.description ? `<meta name="description" content="${escape(link.description)}">` : '',
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escape(baseUrl)}/${escape(link.slug)}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    link.description ? `<meta property="og:description" content="${escape(link.description)}">` : '',
    hasImage ? `<meta property="og:image" content="${escape(imageUrl!)}">` : '',
    `<meta name="twitter:card" content="${twitterCard}">`,
    `<meta name="twitter:title" content="${escape(title)}">`,
    link.description ? `<meta name="twitter:description" content="${escape(link.description)}">` : '',
    hasImage ? `<meta name="twitter:image" content="${escape(imageUrl!)}">` : '',
  ].filter(Boolean).join('\n    ')

  return { title, tags }
}

export function generateCloakingHtml(link: Link, targetUrl: string, baseUrl: string): string {
  const { title, tags } = buildMetaTags(link, baseUrl)

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escape(title)}</title>
    ${tags}
    <style>body{margin:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none}</style>
</head>
<body>
    <iframe src="${escape(targetUrl)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" allowfullscreen referrerpolicy="no-referrer"></iframe>
    <noscript><meta http-equiv="refresh" content="0;url=${escape(targetUrl)}"></noscript>
</body>
</html>`
}

export function generatePasswordHtml(slug: string, hasError: boolean = false): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Password Required</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:-apple-system,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa}
      .card{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:2rem;width:100%;max-width:360px;margin:1rem}
      h1{font-size:1.125rem;font-weight:600;margin-bottom:1.5rem;text-align:center}
      .error{color:#dc2626;font-size:.875rem;margin-bottom:1rem;text-align:center}
      label{display:block;font-size:.875rem;font-weight:500;margin-bottom:.5rem}
      input[type=password]{width:100%;padding:.5rem .75rem;border:1px solid #d4d4d4;border-radius:6px;font-size:.875rem;outline:none}
      input[type=password]:focus{border-color:#a3a3a3;box-shadow:0 0 0 2px rgba(163,163,163,.2)}
      button{width:100%;margin-top:1rem;padding:.5rem;background:#171717;color:#fff;border:none;border-radius:6px;font-size:.875rem;font-weight:500;cursor:pointer}
      button:hover{background:#404040}
    </style>
</head>
<body>
    <div class="card">
        <h1>Password Required</h1>${hasError ? '\n        <p class="error">Incorrect password</p>' : ''}
        <form method="POST" action="/${escape(slug)}">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required autofocus placeholder="Enter password">
            <button type="submit">Continue</button>
        </form>
    </div>
</body>
</html>`
}

export function generateUnsafeWarningHtml(slug: string, targetUrl: string, password?: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Warning: Potentially Unsafe Link</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:-apple-system,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa}
      .card{background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:2rem;width:100%;max-width:420px;margin:1rem}
      .warning{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-bottom:1rem}
      .warning svg{width:1.5rem;height:1.5rem;color:#dc2626;flex-shrink:0}
      h1{font-size:1.125rem;font-weight:600;color:#dc2626}
      .desc{font-size:.875rem;color:#525252;margin-bottom:1rem;line-height:1.5}
      .url{font-size:.8125rem;color:#737373;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:6px;padding:.5rem .75rem;word-break:break-all;margin-bottom:1.5rem}
      .actions{display:flex;gap:.75rem}
      .btn{flex:1;padding:.5rem;border-radius:6px;font-size:.875rem;font-weight:500;cursor:pointer;text-align:center;text-decoration:none;border:none}
      .btn-back{background:#f5f5f5;color:#525252;border:1px solid #d4d4d4}
      .btn-back:hover{background:#e5e5e5}
      .btn-continue{background:#171717;color:#fff}
      .btn-continue:hover{background:#404040}
    </style>
</head>
<body>
    <div class="card">
        <div class="warning">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
            <h1>Potentially Unsafe Link</h1>
        </div>
        <p class="desc">This link has been flagged as potentially unsafe. Proceed with caution.</p>
        <div class="url">${escape(targetUrl)}</div>
        <div class="actions">
            <a href="javascript:history.back()" class="btn btn-back">Go Back</a>
            <form method="POST" action="/${escape(slug)}" style="flex:1;display:flex">
                <input type="hidden" name="confirm" value="true">${password ? `\n                <input type="hidden" name="password" value="${escape(password)}">` : ''}
                <button type="submit" class="btn btn-continue" style="width:100%">Continue</button>
            </form>
        </div>
    </div>
</body>
</html>`
}

export function generateOgHtml(link: Link, targetUrl: string, baseUrl: string): string {
  const { title, tags } = buildMetaTags(link, baseUrl)

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escape(title)}</title>
    ${tags}
    <meta http-equiv="refresh" content="1;url=${escape(targetUrl)}">
</head>
<body>
    <p>Redirecting to <a href="${escape(targetUrl)}">${escape(targetUrl)}</a>...</p>
</body>
</html>`
}

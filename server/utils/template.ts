import type { Link } from '#shared/schemas/link'
import { escape } from 'es-toolkit/string'
import { parseURL } from 'ufo'

export function generateCloakingHtml(link: Link, targetUrl: string, baseUrl: string): string {
  const { host: hostname } = parseURL(link.url)
  const title = link.title || hostname || 'Link'
  const hasImage = !!link.image
  const imageUrl = hasImage && link.image!.startsWith('/') ? `${baseUrl}${link.image}` : link.image

  const metaTags = [
    link.description ? `<meta name="description" content="${escape(link.description)}">` : '',
    `<meta property="og:title" content="${escape(title)}">`,
    link.description ? `<meta property="og:description" content="${escape(link.description)}">` : '',
    hasImage ? `<meta property="og:image" content="${escape(imageUrl!)}">` : '',
  ].filter(Boolean).join('\n    ')

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escape(title)}</title>
    ${metaTags}
    <style>body{margin:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none}</style>
</head>
<body>
    <iframe src="${escape(targetUrl)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" allowfullscreen referrerpolicy="no-referrer"></iframe>
    <noscript><meta http-equiv="refresh" content="0;url=${escape(targetUrl)}"></noscript>
</body>
</html>`
}

export function generateOgHtml(link: Link, targetUrl: string, baseUrl: string): string {
  const { host: hostname } = parseURL(link.url)
  const title = link.title || hostname || 'Link'
  const hasImage = !!link.image
  const twitterCard = hasImage ? 'summary_large_image' : 'summary'
  const imageUrl = hasImage && link.image!.startsWith('/') ? `${baseUrl}${link.image}` : link.image

  const metaTags = [
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

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escape(title)}</title>
    ${metaTags}
    <meta http-equiv="refresh" content="1;url=${escape(targetUrl)}">
</head>
<body>
    <p>Redirecting to <a href="${escape(targetUrl)}">${escape(targetUrl)}</a>...</p>
</body>
</html>`
}

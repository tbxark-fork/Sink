import type { Link } from '@/types'
import { escape } from 'es-toolkit/string'
import { parseURL } from 'ufo'

export function generateOgHtml(link: Link, targetUrl: string, baseUrl: string): string {
  const { host: hostname } = parseURL(link.url)
  const title = link.title || hostname || 'Link'
  const hasImage = !!link.image
  const twitterCard = hasImage ? 'summary_large_image' : 'summary'
  const imageUrl = hasImage && link.image!.startsWith('/') ? `${baseUrl}${link.image}` : link.image

  const metaTags = [
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:url" content="${escape(link.url)}">`,
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
    <meta http-equiv="refresh" content="0;url=${escape(targetUrl)}">
    <title>${escape(title)}</title>
    ${metaTags}
</head>
<body>
    <p>Redirecting to <a href="${escape(targetUrl)}">${escape(targetUrl)}</a>...</p>
</body>
</html>`
}

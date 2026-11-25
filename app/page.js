import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Script from 'next/script';

export default async function HomePage() {
  const document = await readFile(path.join(process.cwd(), 'index.html'), 'utf8');
  const body = document.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/i);

  if (!body) {
    throw new Error('The existing interface HTML must contain a body element.');
  }

  const markup = body[1].replace(
    /<script\b[^>]*src=["']\/?app\.js["'][^>]*>\s*<\/script>/i,
    '',
  );

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: markup }} />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}

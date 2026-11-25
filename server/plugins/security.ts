import { randomBytes } from 'node:crypto';
export default defineNitroPlugin((nitro) => {
  // Run before routing so HTML, API, assets and errors share the protection.
  nitro.hooks.hook("request", (event) => {
    setResponseHeader(event, "Content-Security-Policy", "frame-ancestors 'none'");
    setResponseHeader(event, "X-Frame-Options", "DENY");
    const path=getRequestURL(event).pathname;
    if (/(?:^|\/)(?:s\/[^/]+|api\/shared\/[^/]+(?:\/(?:download|cover))?)\/?$/.test(path)) {
      setResponseHeader(event,'Cache-Control','private, no-store, max-age=0');
      setResponseHeader(event,'Referrer-Policy','no-referrer');
      setResponseHeader(event,'X-Content-Type-Options','nosniff');
      setResponseHeader(event,'X-Robots-Tag','noindex, nofollow, noarchive');
      setResponseHeader(event,'Cross-Origin-Resource-Policy','same-origin');
      const nonce=randomBytes(18).toString('base64');event.context.shareCspNonce=nonce;
      setResponseHeader(event,'Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    }
    if (getRequestProtocol(event) === "https") {
      setResponseHeader(event, "Strict-Transport-Security", "max-age=31536000");
    }
  });
  nitro.hooks.hook('render:html',(html,{event})=>{
    const nonce=event.context.shareCspNonce;
    if(!nonce)return;
    for(const section of [html.head,html.body,html.bodyPrepend,html.bodyAppend])
      section.forEach((value,index)=>{section[index]=value.replace(/<script\b(?![^>]*\bnonce=)/g,`<script nonce="${nonce}"`);});
  });
});

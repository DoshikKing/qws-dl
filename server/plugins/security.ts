export default defineNitroPlugin((nitro) => {
  // Run before routing so HTML, API, assets and errors share the protection.
  nitro.hooks.hook("request", (event) => {
    setResponseHeader(event, "Content-Security-Policy", "frame-ancestors 'none'");
    setResponseHeader(event, "X-Frame-Options", "DENY");
    if (getRequestProtocol(event) === "https") {
      setResponseHeader(event, "Strict-Transport-Security", "max-age=31536000");
    }
  });
});

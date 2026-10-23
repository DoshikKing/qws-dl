import type { H3Event } from "h3";
import { requireCurrentUser } from "./account";

const maximumBytes = 64 * 1024;

export async function readJsonBody(event: H3Event) {
  const request = event.node.req;
  const tooLarge = () => {
    event.node.res.shouldKeepAlive = false;
    request.pause();
    return createError({ statusCode: 413, statusMessage: "Запрос слишком большой." });
  };
  if (Number(request.headers["content-length"]) > maximumBytes) throw tooLarge();
  if (!(getHeader(event, "content-type") || "").match(/^application\/json(?:\s*;|$)/i))
    throw createError({ statusCode: 415, statusMessage: "Ожидается JSON." });
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", data);
      request.off("end", end);
      request.off("error", error);
      request.off("aborted", aborted);
    };
    const error = (cause: Error) => { cleanup(); reject(cause); };
    const aborted = () => error(createError({ statusCode: 400, statusMessage: "Запрос прерван." }));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximumBytes) { cleanup(); reject(tooLarge()); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    request.on("data", data).once("end", end).once("error", error).once("aborted", aborted);
  });
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Некорректный JSON." });
  }
  // A slow body must not retain permissions revoked while it was being read.
  if (event.context.user) {
    requireCurrentUser(event);
  }
  return body;
}

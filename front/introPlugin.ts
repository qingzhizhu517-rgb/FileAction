import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Connect, Plugin, ResolvedConfig } from "vite";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

// 仅托管宣传页的平级 Web 文件；文档、隐藏文件和符号链接均不进入服务或构建。
async function assets(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:html|css|js|svg|mp4)$/.test(entry.name),
    )
    .map((entry) => entry.name);
}

function introMiddleware(directory: string): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const rawPath = (request.url ?? "").split("?")[0];
    const homeAlias = rawPath === "/" || rawPath === "/index.html";
    if (!homeAlias && rawPath !== "/intro" && !rawPath.startsWith("/intro/"))
      return next();
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (homeAlias || rawPath === "/intro") {
      const query = (request.url ?? "").slice(rawPath.length);
      response.writeHead(308, { Location: "/intro/" + query }).end();
      return;
    }
    let filename: string;
    try {
      filename =
        decodeURIComponent(rawPath.slice("/intro/".length)) || "index.html";
    } catch {
      response.writeHead(404).end();
      return;
    }
    try {
      // 查找已枚举的名称，不把用户路径用于目录解析。
      if (!(await assets(directory)).includes(filename)) {
        response.writeHead(404).end();
        return;
      }
      const path = resolve(directory, filename);
      if (extname(filename) === ".mp4") {
        const { size } = await stat(path);
        const headers = {
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff",
        };
        let start = 0;
        let end = size - 1;
        const range = request.method === "GET" ? request.headers.range : undefined;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (match && (match[1] || match[2])) {
            start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
            end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          } else {
            start = size;
          }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
            response.writeHead(416, { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": 0 }).end();
            return;
          }
        }
        response.writeHead(range ? 206 : 200, {
          ...headers, "Content-Length": end - start + 1,
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
        });
        if (request.method === "HEAD" || size === 0) {
          response.end();
          return;
        }
        const stream = createReadStream(path, { start, end });
        response.on("close", () => stream.destroy());
        stream.on("error", () => response.destroy());
        stream.pipe(response);
        return;
      }
      const content = await readFile(path);
      response.writeHead(200, {
        "Content-Type": contentTypes[extname(filename)],
        "Content-Length": content.byteLength,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      next(error);
    }
  };
}

export function introPage(sourceDirectory: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: "fileaction-intro",
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use(introMiddleware(sourceDirectory));
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        introMiddleware(resolve(config.root, config.build.outDir, "intro")),
      );
    },
    async generateBundle() {
      for (const name of await assets(sourceDirectory)) {
        this.emitFile({
          type: "asset",
          fileName: `intro/${name}`,
          source: await readFile(resolve(sourceDirectory, name)),
        });
      }
    },
  };
}

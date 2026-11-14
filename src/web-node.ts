import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import web from "./web";

const staticPath = join(import.meta.dirname, "../", "static");

web.use(
  "/static/*",
  serveStatic({
    root: staticPath,
    rewriteRequestPath: (path) => path.replace(/^\/static/, "/"),
  }),
);

serve(web);

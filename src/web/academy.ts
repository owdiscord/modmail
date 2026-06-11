import { Hono } from "hono";

const app = new Hono();

app.get("/api/trainees", (c) => {
  return c.json([]);
});

app.get("/api/auth/redirect", (c) => {
  return c.json([]);
});

app.get("/api/auth/callback", (c) => {
  return c.json([]);
});

app.get("/threads", (c) => {
  return c.json([]);
});

export default app;

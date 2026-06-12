import { Hono } from "hono";

const app = new Hono();

app.get("/api/trainees", (c) => {
  return c.json([]);
});

app.get("/api/config", (c) => {
  return c.json({});
});

app.get("/api/questions", (c) => {
  return c.json([]);
});

app.get("/api/auth/redirect", (c) => {
  return c.json([]);
});

app.get("/api/auth/callback", (c) => {
  return c.json([]);
});

app.get("/api/threads", (c) => {
  return c.json([]);
});

app.get("/api/threads/:id", (c) => {
  return c.json({});
});

app.get("/api/cases", (c) => {
  return c.json([]);
});

app.get("/api/cases/:id", (c) => {
  return c.json({});
});

app.get("/api/issues", (c) => {
  return c.json([]);
});

export default app;

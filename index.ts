import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import fund from "@/routes/fund.ts";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
    "*",
    cors({
        origin: ["http://localhost:3000", "https://your-frontend.vercel.app"],
        allowMethods: ["GET", "POST", "OPTIONS"],
    })
);

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "Fund Explorer API" }));

// Routes
app.route("/api/fund", fund);

// 404 handler
app.notFound((c) => c.json({ error: "Route not found" }, 404));

// Error handler
app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.PORT) || 3000;
Bun.serve({
    port,
    fetch: app.fetch,
});

console.log(`🚀 Fund Explorer API running on http://localhost:${port}`);
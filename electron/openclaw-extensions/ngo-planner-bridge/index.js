import { Type } from "@sinclair/typebox";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

function json(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

const NgoPlannerBridgeSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  body: Type.Optional(Type.Unknown()),
});

const NgoPlannerCapabilityGetSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  path: Type.Optional(Type.String({ minLength: 1 })),
});

const requestJson = async (url, token, body) => {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  const client = isHttps ? https : http;

  return await new Promise((resolve) => {
    const req = client.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port ? Number(u.port) : isHttps ? 443 : 80,
        path: `${u.pathname}${u.search}`,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => {
          raw += String(c || "");
          if (raw.length > 2_000_000) res.destroy();
        });
        res.on("end", () => {
          let parsed = raw;
          try {
            parsed = JSON.parse(raw || "{}");
          } catch (e) {}
          resolve({
            ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
            status: Number(res.statusCode || 0),
            data: parsed,
          });
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, data: { error: e instanceof Error ? e.message : String(e) } }));
    try {
      req.write(JSON.stringify(body || {}));
    } catch (e) {}
    req.end();
  });
};

const plugin = {
  id: "ngo-planner-bridge",
  name: "NGO Planner Bridge",
  description: "Secure tools for managing NGO Planner data via local bridge",
  configSchema: { jsonSchema: {} },
  register(api) {
    api.registerTool(
      (ctx) => {
        return {
          name: "ngo_planner",
          label: "NGO Planner",
          description: "Call NGO Planner local bridge endpoints under /skills/*. Call /skills/capabilities/catalog first.",
          parameters: NgoPlannerBridgeSchema,
          async execute(_toolCallId, params) {
            const p = params || {};
            const base = String(process.env.NGOPLANNER_BRIDGE_URL || "").trim();
            const token = String(process.env.NGOPLANNER_BRIDGE_TOKEN || "").trim();
            if (!base || !token) return json({ success: false, error: "bridge_not_configured" });

            let url = "";
            try {
              const rawPath = String(p.path || "").trim();
              if (!rawPath.startsWith("/skills/")) return json({ success: false, error: "path_must_start_with_/skills/" });
              url = new URL(rawPath, base).toString();
            } catch (e) {
              return json({ success: false, error: "invalid_bridge_url" });
            }

            const actor = {
              messageChannel: String(ctx?.messageChannel || ""),
              sessionKey: String(ctx?.sessionKey || ""),
              agentId: String(ctx?.agentId || ""),
            };

            const body = p.body && typeof p.body === "object" ? { ...p.body, actor } : { value: p.body, actor };
            const r = await requestJson(url, token, body);
            return json({ success: true, ok: r.ok, status: r.status, result: r.data });
          },
        };
      },
      { name: "ngo_planner" },
    );

    api.registerTool(
      () => {
        return {
          name: "ngo_planner_capabilities",
          label: "NGO Planner Capabilities",
          description: "List or get NGO Planner bridge capabilities for reliable tool routing.",
          parameters: NgoPlannerCapabilityGetSchema,
          async execute(_toolCallId, params) {
            const p = params || {};
            const base = String(process.env.NGOPLANNER_BRIDGE_URL || "").trim();
            const token = String(process.env.NGOPLANNER_BRIDGE_TOKEN || "").trim();
            if (!base || !token) return json({ success: false, error: "bridge_not_configured" });
            const hasQuery = Boolean(String(p.id || "").trim() || String(p.path || "").trim());
            const path = hasQuery ? "/skills/capabilities/get" : "/skills/capabilities/catalog";
            const body = hasQuery
              ? { id: String(p.id || "").trim() || undefined, path: String(p.path || "").trim() || undefined }
              : {};
            const url = new URL(path, base).toString();
            const r = await requestJson(url, token, body);
            return json({ success: true, ok: r.ok, status: r.status, result: r.data });
          },
        };
      },
      { name: "ngo_planner_capabilities" },
    );

    api.logger?.info?.("[plugins] ngo-planner-bridge: Registered ngo_planner tool");
  },
};

export default plugin;

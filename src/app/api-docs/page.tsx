"use client";

import { useEffect } from "react";

/**
 * Swagger UI for the Provision API.
 *
 * Loads Swagger UI from a CDN and points it at `GET /api/openapi`. No npm
 * dependency and no build step — open http://localhost:3000/api-docs while the
 * dev server runs and use "Try it out" to hit the live routes.
 */

const SWAGGER_VERSION = "5.17.14";

export default function ApiDocs() {
  useEffect(() => {
    const cssId = "swagger-ui-css";
    if (!document.getElementById(cssId)) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`;
      document.head.appendChild(link);
    }

    const scriptId = "swagger-ui-bundle";
    const render = () => {
      const ui = (window as unknown as { SwaggerUIBundle?: unknown })
        .SwaggerUIBundle as
        | ((config: Record<string, unknown>) => void)
        | undefined;
      if (ui) {
        ui({
          url: "/api/openapi",
          dom_id: "#swagger-ui",
          deepLinking: true,
          tryItOutEnabled: true,
        });
      }
    };

    const existing = document.getElementById(scriptId);
    if (existing) {
      render();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`;
    script.crossOrigin = "anonymous";
    script.onload = render;
    document.body.appendChild(script);
  }, []);

  return (
    <main>
      <div id="swagger-ui" />
    </main>
  );
}

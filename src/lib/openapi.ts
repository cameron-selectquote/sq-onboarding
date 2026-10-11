/**
 * OpenAPI 3.0 spec for the Provision API.
 *
 * Hand-maintained to mirror the route handlers under `src/app/api`. It's served
 * raw by `GET /api/openapi` and rendered by the Swagger UI page at `/api-docs`,
 * so you can exercise every endpoint without a UI.
 *
 * Example ids come from the seed dataset (`src/data/seed.ts`) so the "Try it
 * out" buttons work against a freshly started dev server.
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Provision API",
    version: "0.1.0",
    description:
      "Onboarding + spend ledger. Every endpoint delegates to a `src/lib` " +
      "service over a seeded in-memory store. Example ids come from the seed " +
      "dataset, so Try-it-out works right after `npm run dev`.",
  },
  servers: [{ url: "/", description: "This dev server" }],
  tags: [
    { name: "Hires", description: "Import and read hires" },
    { name: "Tasks", description: "Onboarding task status" },
    { name: "Licenses", description: "Grant / revoke software seats" },
    { name: "Assets", description: "POs, inventory, returns" },
    { name: "Finance", description: "Cost-per-hire, burn, budgets" },
    { name: "Reclaim", description: "Recoverable spend report" },
    { name: "AI", description: "Template matching + welcome-brief drafting" },
    {
      name: "Dev",
      description: "Dev-only tooling. Not available in production builds.",
    },
  ],
  paths: {
    "/api/hires": {
      get: {
        tags: ["Hires"],
        summary: "List all hires",
        responses: {
          "200": {
            description: "All hires",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    hires: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Hire" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/hires/import": {
      post: {
        tags: ["Hires"],
        summary: "Bulk import hires",
        description:
          "Creates hires and auto-instantiates tasks + licenses from the role " +
          "template matched by `roleName`. Seed templates: Software Engineer, " +
          "Designer, Operations.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ImportRequest" },
              example: {
                rows: [
                  {
                    name: "Alex Rivera",
                    email: "alex@acme.test",
                    roleName: "Software Engineer",
                    startDate: "2026-03-02",
                    cohort: "2026-Mar",
                    appIds: ["github", "slack"],
                  },
                ],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Hires created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    created: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          hire: { $ref: "#/components/schemas/Hire" },
                          taskCount: { type: "integer" },
                          licenseCount: { type: "integer" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/hires/{id}": {
      get: {
        tags: ["Hires"],
        summary: "Hire detail with tasks, licenses, and total spend",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "hire_1",
          },
        ],
        responses: {
          "200": {
            description: "Hire detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    hire: { $ref: "#/components/schemas/Hire" },
                    tasks: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Task" },
                    },
                    licenses: {
                      type: "array",
                      items: { $ref: "#/components/schemas/License" },
                    },
                    totalSpend: { type: "number" },
                  },
                },
              },
            },
          },
          "404": {
            description: "Hire not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/tasks/{id}": {
      patch: {
        tags: ["Tasks"],
        summary: "Update task status",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Task id (fetch one from GET /api/hires/{id})",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: {
                    type: "string",
                    enum: ["todo", "in_progress", "review", "blocked", "done"],
                  },
                },
              },
              example: { status: "in_progress" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated task",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { task: { $ref: "#/components/schemas/Task" } },
                },
              },
            },
          },
          "400": {
            description: "Invalid status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "404": {
            description: "Task not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/licenses/{id}/grant": {
      post: {
        tags: ["Licenses"],
        summary: "Grant a seat (writes a ledger entry, bumps budget)",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "lic_idle_1",
          },
        ],
        responses: {
          "200": {
            description: "Granted license",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    license: { $ref: "#/components/schemas/License" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Transition error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/licenses/{id}/revoke": {
      post: {
        tags: ["Licenses"],
        summary: "Revoke a seat (credits the ledger, drops burn)",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "lic_dup_1b",
          },
        ],
        responses: {
          "200": {
            description: "Revoked license",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    license: { $ref: "#/components/schemas/License" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Transition error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/pos": {
      post: {
        tags: ["Assets"],
        summary: "Raise a PO (one-time ledger entry + provision an asset)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["assetCatalogId", "hireId", "serialTag"],
                properties: {
                  assetCatalogId: { type: "string" },
                  hireId: { type: "string" },
                  serialTag: { type: "string" },
                },
              },
              example: {
                assetCatalogId: "mbp16",
                hireId: "hire_1",
                serialTag: "MBP-0100",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Asset provisioned",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { asset: { $ref: "#/components/schemas/Asset" } },
                },
              },
            },
          },
          "400": {
            description: "Validation / transition error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/assets": {
      get: {
        tags: ["Assets"],
        summary: "Inventory list + on-hand count",
        responses: {
          "200": {
            description: "Assets",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    assets: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Asset" },
                    },
                    onHand: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/assets/{id}/return": {
      post: {
        tags: ["Assets"],
        summary: "Return an asset (credits residual value)",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            example: "asset_mbp_3",
          },
        ],
        responses: {
          "200": {
            description: "Returned asset",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { asset: { $ref: "#/components/schemas/Asset" } },
                },
              },
            },
          },
          "400": {
            description: "Transition error",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/finance/summary": {
      get: {
        tags: ["Finance"],
        summary: "Cost-per-hire inputs, burn, reclaimable, budgets",
        responses: {
          "200": {
            description: "Finance summary",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    summary: { type: "object" },
                    budgets: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Budget" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/reclaim": {
      get: {
        tags: ["Reclaim"],
        summary: "Reclaimable license + asset flags with a dollar total",
        responses: {
          "200": {
            description: "Reclaim report",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/api/ai/match-template": {
      post: {
        tags: ["AI"],
        summary: "Suggest a template + stack from a title / offer text",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  offerText: { type: "string" },
                },
              },
              example: {
                title: "Senior Software Engineer",
                offerText: "Backend-leaning, works in the platform team.",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Match",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { match: { type: "object" } },
                },
              },
            },
          },
          "400": {
            description: "title is required",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/ai/draft-brief": {
      post: {
        tags: ["AI"],
        summary: "Draft welcome-brief blurbs from a hire's granted tools",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["hireId"],
                properties: {
                  hireId: { type: "string" },
                },
              },
              example: { hireId: "hire_1" },
            },
          },
        },
        responses: {
          "200": {
            description: "Brief blurbs for the hire's active licenses",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    blurbs: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "400": {
            description: "hireId is required",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "404": {
            description: "Hire not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/dev/reset": {
      post: {
        tags: ["Dev"],
        summary: "Reset the store to the seeded baseline (dev only)",
        description:
          "Wipes every collection and reloads the committed seed, returning " +
          "the data to its first-boot baseline (red reclaim banner). Handy for " +
          "re-running the demo from a clean slate without restarting the " +
          "server. Refused with 404 when `NODE_ENV=production`, so it can't " +
          "touch real data.",
        responses: {
          "200": {
            description: "Store reset and reseeded",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    reseeded: { type: "boolean" },
                    counts: {
                      type: "object",
                      additionalProperties: { type: "integer" },
                      description: "Row count per collection after reseed",
                    },
                  },
                },
                example: {
                  ok: true,
                  reseeded: true,
                  counts: {
                    companies: 1,
                    hires: 6,
                    licenses: 11,
                    assets: 7,
                  },
                },
              },
            },
          },
          "404": {
            description: "Not available (production build)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
      Hire: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          roleName: { type: "string" },
          managerId: { type: "string", nullable: true },
          startDate: { type: "string" },
          cohort: { type: "string", nullable: true },
        },
      },
      Task: {
        type: "object",
        properties: {
          id: { type: "string" },
          hireId: { type: "string" },
          title: { type: "string" },
          ownerTeam: {
            type: "string",
            enum: ["hr", "it", "vendor", "facilities", "finance"],
          },
          status: {
            type: "string",
            enum: ["todo", "in_progress", "review", "blocked", "done"],
          },
          cost: { type: "number" },
          costType: {
            type: "string",
            enum: ["none", "one_time", "recurring"],
          },
        },
      },
      License: {
        type: "object",
        properties: {
          id: { type: "string" },
          hireId: { type: "string" },
          appId: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "idle", "reclaim", "revoked"],
          },
          grantedAt: { type: "string", nullable: true },
          lastUsedAt: { type: "string", nullable: true },
        },
      },
      Asset: {
        type: "object",
        properties: {
          id: { type: "string" },
          catalogId: { type: "string" },
          serialTag: { type: "string" },
          status: {
            type: "string",
            enum: ["in_stock", "assigned", "in_repair", "returned", "retired"],
          },
          assignedToHireId: { type: "string", nullable: true },
          acquiredAt: { type: "string", nullable: true },
          returnedAt: { type: "string", nullable: true },
        },
      },
      Budget: {
        type: "object",
        properties: {
          id: { type: "string" },
          team: {
            type: "string",
            enum: ["hr", "it", "vendor", "facilities", "finance"],
          },
          period: { type: "string" },
          limit: { type: "number" },
          spent: { type: "number" },
        },
      },
      ImportRequest: {
        type: "object",
        required: ["rows"],
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "email", "roleName", "startDate"],
              properties: {
                name: { type: "string" },
                email: { type: "string" },
                roleName: { type: "string" },
                startDate: { type: "string" },
                managerId: { type: "string", nullable: true },
                cohort: { type: "string", nullable: true },
                appIds: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
} as const;

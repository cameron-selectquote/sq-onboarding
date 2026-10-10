import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi";

/** GET /api/openapi — the OpenAPI 3.0 spec that drives the Swagger UI. */
export async function GET() {
  return NextResponse.json(openApiSpec);
}

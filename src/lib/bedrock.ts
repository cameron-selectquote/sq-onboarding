/**
 * Bedrock credential detection — the one check that decides whether the live
 * Strands agents run (Genie + the StrandsAiClient) or the deterministic
 * offline fallbacks do. Kept dependency-free so any module can import it
 * without pulling in the Strands SDK.
 */

/** True when Bedrock credentials are available in the environment. */
export function hasBedrockCreds(): boolean {
  return Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE ||
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );
}

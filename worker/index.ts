import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NOTE_IMAGES: R2Bucket;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  fetch(request: Request, env: Env, context: ExecutionContext) {
    return handler.fetch(request, env, context);
  },
};

export default worker;

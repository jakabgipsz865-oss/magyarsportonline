const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID ?? "magyarsportonline";

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
}

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai-gateway/gateways/${gatewayId}`;

async function cloudflareRequest(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();

  if (!response.ok || payload.success !== true) {
    const details = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.message).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare AI Gateway request failed: ${details}`);
  }

  return payload.result;
}

const gateway = await cloudflareRequest("GET");
const spendLimits = gateway.spend_limits;
const rules = Array.isArray(spendLimits?.rules) ? spendLimits.rules : [];

const ruleIndex = rules.findIndex((rule) => {
  const providerValues = rule.provider?.values ?? [];
  const modelValues = rule.model?.values ?? [];

  return (
    providerValues.includes("google-ai-studio") ||
    modelValues.includes("google/gemini-3.5-flash") ||
    (rule.limitType === "cost" && rule.limit === 5 && rule.technique === "fixed")
  );
});

if (ruleIndex === -1) {
  throw new Error(
    "The existing $5 monthly AI Gateway spend-limit rule was not found; refusing to create a potentially duplicate rule",
  );
}

const updatedRule = {
  ...rules[ruleIndex],
  enabled: true,
  limit: 5,
  limitType: "cost",
  technique: "fixed",
};

// A gateway-wide rule cannot be bypassed by provider or model naming changes.
delete updatedRule.provider;
delete updatedRule.model;
delete updatedRule.metadata;

const updatedRules = [...rules];
updatedRules[ruleIndex] = updatedRule;

const updateBody = {
  cache_invalidate_on_update: gateway.cache_invalidate_on_update,
  cache_ttl: gateway.cache_ttl,
  collect_logs: gateway.collect_logs,
  rate_limiting_interval: gateway.rate_limiting_interval,
  rate_limiting_limit: gateway.rate_limiting_limit,
  authentication: gateway.authentication,
  spend_limits: {
    enabled: true,
    rules: updatedRules,
  },
};

const updatedGateway = await cloudflareRequest("PUT", updateBody);
const verifiedRule = updatedGateway.spend_limits?.rules?.find(
  (rule) =>
    rule.limitType === "cost" &&
    rule.limit === 5 &&
    rule.technique === "fixed" &&
    rule.enabled === true &&
    !rule.provider &&
    !rule.model &&
    !rule.metadata,
);

if (updatedGateway.spend_limits?.enabled !== true || !verifiedRule) {
  throw new Error("Cloudflare did not return the expected gateway-wide $5 limit");
}

console.log(
  `AI Gateway spend limit verified: $5 per ${verifiedRule.window}s fixed window for all gateway traffic.`,
);

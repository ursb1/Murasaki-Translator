type GenericRecord = Record<string, unknown>;

const toRecord = (value: unknown): GenericRecord =>
  value && typeof value === "object" ? (value as GenericRecord) : {};

const pickTrimmedString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
};

const pickApiKey = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) return trimmed;
  }
  return "";
};

const resolveApiKeyField = (source: GenericRecord): string =>
  pickApiKey(
    source.api_key ?? source.apiKey ?? source.api_keys ?? source.apiKeys ?? "",
  );

export const resolveProviderMonitorUrl = (providerData: unknown): string => {
  const provider = toRecord(providerData);
  const directUrl = pickTrimmedString(
    provider.base_url,
    provider.baseUrl,
    provider.url,
  );
  if (directUrl) return directUrl;

  const endpoints = provider.endpoints;
  if (!Array.isArray(endpoints)) return "";
  for (const endpoint of endpoints) {
    const endpointData = toRecord(endpoint);
    const endpointUrl = pickTrimmedString(
      endpointData.base_url,
      endpointData.baseUrl,
      endpointData.url,
    );
    if (endpointUrl) return endpointUrl;
  }
  return "";
};

export const resolveProviderMonitorApiKey = (providerData: unknown): string => {
  const provider = toRecord(providerData);
  const directApiKey = resolveApiKeyField(provider);
  if (directApiKey) return directApiKey;

  const endpoints = provider.endpoints;
  if (!Array.isArray(endpoints)) return "";
  for (const endpoint of endpoints) {
    const endpointData = toRecord(endpoint);
    const endpointApiKey = resolveApiKeyField(endpointData);
    if (endpointApiKey) return endpointApiKey;
  }
  return "";
};

/** Deployment model catalog shared by the Host catalog, settings defaults and status. */

/** One routable model the Workers-native Host can execute. */
export interface DeploymentModel {
  readonly id: string;
  readonly label: string;
  readonly contextWindow: number;
}

/** Actual model catalog served by this deployment (shared by all consumers). */
export const DEPLOYMENT_MODELS: readonly DeploymentModel[] = [
  { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash", contextWindow: 1_048_576 },
  { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro", contextWindow: 1_048_576 },
];

const DEEPSEEK_MODEL_SCHEMA = {
  type: "object",
  meta: {},
  dict: {
    id: { type: "string", meta: { required: true } },
    name: { type: "string", meta: {} },
    contextWindow: { type: "number", meta: {} },
  },
} as const;
export const DEEPSEEK_SETTINGS_SCHEMA = {
  type: "object",
  dict: {
    apiKeyEnv: { type: "string", meta: { default: "DEEPSEEK_OFFICIAL_API_KEY", role: "credential-ref", volatile: true } },
    baseURL: { type: "string", meta: { default: "https://api.deepseek.com/v1" } },
    // The official editor renders the control. Think exposes no owner-selectable retry mode.
    retryPolicy: { type: "union", list: [] as never[], meta: {} },
    models: { type: "array", inner: DEEPSEEK_MODEL_SCHEMA, meta: { default: DEPLOYMENT_MODELS.map(model => ({ id: model.id, name: model.label, contextWindow: model.contextWindow })) } },
  },
  meta: { default: {} },
} as const;

/** Deployment defaults, not an owner configuration or credential status. */
export const DEEPSEEK_SETTINGS_DEFAULTS = {
  apiKeyEnv: "DEEPSEEK_OFFICIAL_API_KEY",
  baseURL: "https://api.deepseek.com/v1",
  models: DEPLOYMENT_MODELS.map(model => ({ id: model.id, name: model.label, contextWindow: model.contextWindow })),
};

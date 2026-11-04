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

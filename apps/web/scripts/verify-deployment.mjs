import { readDeploymentConfig, requireDeployableConfig } from "./deployment-config.mjs";
const config = requireDeployableConfig(readDeploymentConfig());
console.log(`Deployment target: ${config.workerName} (${config.authBaseUrl}); signup ${config.signupEnabled ? "open" : "closed"}; platform AI ${config.platformAiEnabled ? "enabled" : "disabled"}`);

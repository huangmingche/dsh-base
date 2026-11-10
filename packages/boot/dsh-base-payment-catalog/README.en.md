# Public plan contract

Platform-neutral pure parsing shared by deployment configuration and the payment Worker. This library has no composition entry or independent feature behavior and imports no Worker, browser, React or Node runtime.

`parsePlans` and `parseFeatures` strictly validate deployment declarations. `publicCatalogFromDeployment` provides a secret-free projection with `priceSource:"deployment"`. Missing prices remain unknown, subscription prices require explicit periods, and currency precision cannot silently round. Readiness defaults to false. Payment and entitlement plugins retain responsibility for actual payments, amounts and authorization.

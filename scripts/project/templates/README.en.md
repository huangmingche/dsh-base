# __PRODUCT_NAMESPACE__

[简体中文](README.md) | English

This product consumes Dsh-base through a pinned Git submodule. Business capabilities are DSH plugins in this repository.

- Base path: `__BASE_PATH__`.
- Product namespace: `__PRODUCT_NAMESPACE__`.
- `dsh.project.json` records the current path and namespace.
- `dsh.apps.json` declares Web applications and the default application; see the [base contract](__BASE_PATH__/AGENTS.md#multi-application) for supported scope and operations.

After cloning, run `git submodule update --init --recursive` if submodules are not initialized.
Follow the [pinned base AGENTS.md](__BASE_PATH__/AGENTS.md#downstream-products) for initialization, development, configuration, validation, deployment, manual or scheduled updates and rollback.
Keep product-specific requirements in this repository's [AGENTS.md](AGENTS.md); maintain shared procedures only in the base.

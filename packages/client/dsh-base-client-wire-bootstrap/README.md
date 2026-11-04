# 已停用的 Connection 启动接缝

此包保留为禁用库存，不进入浏览器 bundle。当前 session-adapter 内部直接挂载原样官方 Gateway，统一负责真实 Connection generation、事件 ready、恢复和销毁。旧实现曾提供真实 generation，不再与官方实现并行运行。没有 UI 差异。

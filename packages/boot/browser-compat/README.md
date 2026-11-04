# 浏览器 Loader 兼容

纯浏览器兼容模块，不导入 Node 或 Workers。静态官方模块加载流程绕过 Node resolver；文件写入、require 和 loader hooks 明确拒绝。构建包仅在 `client` 环境映射这些模块，Worker 使用真实 Node 兼容能力。

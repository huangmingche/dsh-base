# Think 附件读取

官方上传界面和 HTTP 协议由 Host seam 复用。本插件通过当前会话的 Host 读取已提交文件；R2 内容按 SHA-256 校验，凭据绑定会话和消息。`read_uploaded_file` 每次最多读取 64 KiB，返回 UTF-8 或原始字节的 base64 和下一偏移。它不能读取其他会话或尚未提交的上传。

官方 `tool-fs` 和 `attachment-local` 依赖 Node 文件系统及官方执行运行时，不能作为 Think 插件直接挂载或仅修改 Host 层后复用，因此此插件仅适配 Think 工具协议。二进制文件未配置 PDF、Office 或图像解析器，不宣称内容理解能力。

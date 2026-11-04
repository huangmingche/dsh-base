import { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-client-web/src/base.css";
import { apply as applyLogin } from "../../../client/dsh-base-client-auth-login/src/client/index.tsx";
import { openPdf } from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/runtime.ts";
import { renderPdfPage } from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/document.ts";
import { createPdfBinaryDataFactory } from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/pdf/assets.ts";
import { parseExcel } from "@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/parse.ts";
import sheetCss from "@fortune-sheet/react/dist/index.css?inline";

const output = window as any;
if (new URL(location.href).searchParams.get("surface") === "login") {
  const url = new URL(location.href);
  url.pathname = "/login";
  url.searchParams.set("next", "/signed-in-fixture");
  history.replaceState(null, "", url);
  const ctx = new Context();
  applyLogin(ctx);
  output.disposeLogin = () => ctx.fiber.dispose();
} else {
  output.checkPreview = async (pdfBytes: number[], xlsxBytes: number[]) => {
    const failures: string[] = [];
    const controller = new AbortController();
    const session = openPdf(new Uint8Array(pdfBytes), controller.signal, error => failures.push(error.message));
    const document = await session.document;
    const canvas = window.document.createElement("canvas");
    window.document.body.append(canvas);
    const size = await renderPdfPage(document, 1, canvas, controller.signal, 1);
    const pixel = [...canvas.getContext("2d")!.getImageData(20, 20, 1, 1).data];
    await session.dispose();
    const assets = new (createPdfBinaryDataFactory())();
    const font = await assets.fetch({ kind: "standardFontDataUrl", filename: "LiberationSans-Regular.ttf" });
    const limits = { maxBytes: 4_000_000, maxCells: 50_000, timeoutMs: 15000 };
    const csv = await parseExcel(new TextEncoder().encode("Name,Count\nDsh-base,42\n"), "csv", limits, controller.signal);
    const xlsx = await parseExcel(new Uint8Array(xlsxBytes), "xlsx", limits, controller.signal);
    let invalid = false;
    try { await parseExcel(new TextEncoder().encode("invalid zip"), "xlsx", limits, controller.signal); } catch { invalid = true; }
    return { pages: document.numPages, size, pixel, fontBytes: font.byteLength, stylesheetBytes: sheetCss.length, csv, xlsx, invalid, failures };
  };
}

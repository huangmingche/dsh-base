/** Application entry: hand the generated composition to the official Web boot seam. */
import { startClient } from "@dsh-base/client-core/src/client/boot.ts";
import { clientComposition } from "virtual:dsh-composition";

const container = document.getElementById("root");
if (!container) throw new Error("dsh-base: #root is missing");
void startClient(clientComposition, container);

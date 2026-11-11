import { fileURLToPath } from "node:url";

// Both src/shared and dist/shared are two levels below the installed package root.
export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [html, styles, billing, app, data] = await Promise.all([
  readFile(path.join(ROOT, "index.html"), "utf8"),
  readFile(path.join(ROOT, "styles.css"), "utf8"),
  readFile(path.join(ROOT, "billing.js"), "utf8"),
  readFile(path.join(ROOT, "app.js"), "utf8"),
  readFile(path.join(ROOT, "data", "carparks.json"), "utf8"),
]);

const localStyles = '<link rel="stylesheet" href="./styles.css" />';
const moduleScript = '<script type="module" src="./app.js"></script>';
if (!html.includes(localStyles) || !html.includes(moduleScript)) {
  throw new Error("Could not find the local styles or module entry in index.html.");
}

const billingClassic = billing.replace(
  /\bexport\s+(?=(?:const|function|class)\b)/g,
  "",
);
const appClassic = app.replace(
  /^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/billing\.js["'];\s*/m,
  "",
);
const embeddedData = JSON.parse(data);
const serializedData = JSON.stringify({
  ...embeddedData,
  meta: {
    ...embeddedData.meta,
    standalone: true,
  },
}).replace(/</g, "\\u003c");

const inlineBundle = `<script>
window.__CARPARK_DATA__ = ${serializedData};
(() => {
${billingClassic}
${appClassic}
})();
</script>`;

const standalone = html
  .replace(localStyles, `<style>\n${styles}\n</style>`)
  .replace(moduleScript, inlineBundle);

await writeFile(path.join(ROOT, "standalone.html"), standalone, "utf8");
console.log("Built standalone.html for direct local opening.");

import { writeFile } from "node:fs/promises";
import { tabloidSourcePreflight } from "../apps/web/lib/tabloid-preflight";
const report = await tabloidSourcePreflight(undefined, true);
await writeFile("docs/tabloid-source-preflight-v2.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
// rss-parser may leave third-party keep-alive sockets open after all work is complete.
process.exit(0);

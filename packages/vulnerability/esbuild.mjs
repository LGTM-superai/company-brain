import * as esbuild from "esbuild";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { execSync } from "child_process";
import path from "path";

await mkdir("dist", { recursive: true });

const handlers = ["registerRepo", "exaWebhook", "worker"];

for (const handler of handlers) {
  await esbuild.build({
    entryPoints: [`src/handlers/${handler}.ts`],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: `dist/${handler}.mjs`,
    // AWS SDK v3 is provided by the Lambda runtime (nodejs20.x)
    external: [
      "@aws-sdk/*",
    ],
    banner: {
      js: `
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
`,
    },
    minify: false,
    sourcemap: false,
  });

  // Zip for Terraform
  if (process.platform === "win32") {
    execSync(
      `powershell -Command "Compress-Archive -Force -Path dist\\${handler}.mjs -DestinationPath dist\\${handler}.zip"`
    );
  } else {
    execSync(`zip -q dist/${handler}.zip dist/${handler}.mjs`);
  }

  console.log(`✓ dist/${handler}.mjs + ${handler}.zip`);
}

// Check sizes
for (const handler of handlers) {
  try {
    const stat = await import("fs").then((m) =>
      m.statSync(`dist/${handler}.zip`)
    );
    const mb = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`  ${handler}.zip: ${mb} MB`);
    if (stat.size > 100 * 1024 * 1024) {
      console.warn(`  ⚠ ${handler}.zip exceeds 100 MB — consider Lambda Layer`);
    }
  } catch {}
}

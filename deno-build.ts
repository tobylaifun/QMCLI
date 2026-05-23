import AdmZip from "adm-zip";

const mode = Deno.args[0] || "build";
const tag = Deno.args[1];

async function runDeno(args: string[]) {
  const cmd = new Deno.Command("deno", { args, stdout: "inherit", stderr: "inherit" });
  const r = await cmd.output();
  if (!r.success) Deno.exit(1);
}

async function buildBundle() {
  console.log("Building CJS bundle (minified)...");
  Deno.mkdirSync("./dist", { recursive: true });

  await runDeno([
    "bundle", "--format", "cjs", "--minify",
    "cli.ts", "-o", "dist/qmcli.cjs",
  ]);

  const content = Deno.readTextFileSync("dist/qmcli.cjs");
  Deno.writeTextFileSync("dist/qmcli.cjs", "#!/usr/bin/env node\n" + content);
  console.log("CJS bundle -> dist/qmcli.cjs (minified + shebang)");
}

const targets: Record<string, { target: string; ext: string }> = {
  "windows-x64": { target: "x86_64-pc-windows-msvc", ext: ".exe" },
  "linux-x64": { target: "x86_64-unknown-linux-gnu", ext: "" },
  "linux-arm64": { target: "aarch64-unknown-linux-gnu", ext: "" },
  "darwin-x64": { target: "x86_64-apple-darwin", ext: "" },
  "darwin-arm64": { target: "aarch64-apple-darwin", ext: "" },
};

Deno.mkdirSync("./dist/build", { recursive: true });
Deno.mkdirSync("./dist/buildexe", { recursive: true });

async function compileForTarget(key: string, target: string, ext: string) {
  const outDir = `./dist/buildexe/qmcli-${key}`;
  Deno.mkdirSync(outDir, { recursive: true });
  const outFile = `${outDir}/qmcli${ext}`;

  console.log(`Building for ${key} (${target})...`);

  await runDeno([
    "compile", "--target", target, "--allow-all",
    "--output", outFile, "cli.ts",
  ]);

  const tagSuffix = tag ? `-${tag.split("/").pop()}` : "";
  const zipName = `qmcli-${key}${tagSuffix}.zip`;
  const zipPath = `./dist/build/${zipName}`;

  const zip = new AdmZip();
  zip.addLocalFile(outFile);
  zip.writeZip(zipPath);
  console.log(`${key} zipped -> ${zipPath}`);
}

async function buildExe() {
  for (const [key, { target, ext }] of Object.entries(targets)) {
    await compileForTarget(key, target, ext);
  }
  console.log("All builds completed");
}

async function buildSingleExe() {
  console.log("Building for current platform...");
  Deno.mkdirSync("./dist", { recursive: true });

  await runDeno([
    "compile", "--allow-all",
    "--output", "dist/qmcli", "cli.ts",
  ]);
  console.log("Build success -> dist/qmcli");
}

switch (mode) {
  case "build":
    await buildBundle();
    break;
  case "exe":
    await buildExe();
    break;
  case "exe-single":
    await buildSingleExe();
    break;
  default:
    console.error(`Unknown mode: ${mode}. Use "build" or "exe".`);
    Deno.exit(1);
}

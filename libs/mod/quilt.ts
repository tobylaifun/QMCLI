import { FabricInstaller } from "./fabric.ts";

export class QuiltInstaller extends FabricInstaller {
  static override loader = "quilt";
  static override fabricapi = "https://meta.quiltmc.org/v3";
}

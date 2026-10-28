interface ProjectSummary {
  name: string;
  projectId: string;
  revision: string;
  root: string;
  nativeStatus: string;
  nativeSyncStatus: 'IN_SYNC' | 'UNSYNCHRONIZED' | 'EXTERNAL_CONFLICT' | 'NOT_IMPORTED' | 'UNSUPPORTED' | 'NOT_TESTED';
  nativeSchematicSha256: string | null;
  editorRevision: string | null;
  nativeSyncReason: string;
  components: Array<{ ref: string; value: string; kind?: string }>;
  libraries: Array<{ name: string; path: string; count: number }>;
  capabilities: { esphome: boolean };
  files: { schematic?: string; pcb?: string };
}

interface OperationResult {
  status: "PASS" | "FAIL" | "NOT TESTED" | "CANCELLED";
  title: string;
  message: string;
  output?: string;
  reportPaths?: string[];
}

interface CircuitApi {
  getEnvironment(): Promise<NativeToolsSummary>;
  getNativeTools(): Promise<NativeToolsSummary>;
  selectKiCadInstall(): Promise<NativeToolsSummary>;
  selectEsphomeExecutable(): Promise<NativeToolsSummary>;
  newProject(): Promise<ProjectSummary | null>;
  openProject(): Promise<ProjectSummary | null>;
  getRecentProjects(): Promise<Array<{ projectId: string; name: string; root: string }>>;
  openRecentProject(projectId: string): Promise<ProjectSummary>;
  inspectProject(): Promise<ProjectSummary | null>;
  loadSchematicModel(): Promise<unknown | null>;
  saveSchematicModel(model: unknown): Promise<{ revision: string; path: string; message: string }>;
  stageNativeSchematic(model: unknown): Promise<OperationResult & { stageId?: string; sourceSha256?: string; candidateSha256?: string; validation?: unknown }>;
  openStagedSchematic(stageId: string): Promise<OperationResult>;
  commitNativeSchematic(stageId: string, approved: boolean): Promise<OperationResult & { stageId?: string; backupPath?: string; sourceSha256?: string }>;
  rollbackNativeSchematic(stageId: string, approved: boolean): Promise<OperationResult>;
  openNative(kind: "schematic" | "pcb"): Promise<OperationResult>;
  checkCircuit(): Promise<OperationResult>;
  prepareManufacturing(): Promise<OperationResult>;
  previewEsphome(): Promise<OperationResult & { yaml?: string }>;
  saveEsphome(yaml: string, replaceApproved?: boolean, destination?: string): Promise<OperationResult & { existingText?: string; destination?: string; backupPath?: string }>;
  setTheme(theme: "dark" | "light"): Promise<void>;
  getTheme(): Promise<"dark" | "light">;
  onProjectChanged(callback: (project: ProjectSummary | null) => void): void;
  onDevRendererUpdate(callback: (changedFile: string) => void): void;
}

interface NativeToolsSummary {
  kicadInstallDir: string | null;
  kicadCli: string | null;
  kicadVersion: string | null;
  kicadCliError: string | null;
  kicadEditor: string | null;
  kicadEditorVersion: string | null;
  eeschema: string | null;
  pcbnew: string | null;
  compatible: boolean;
  compatibilityMessage: string | null;
  esphome: string | null;
  esphomeVersion: string | null;
  esphomeError: string | null;
  version: string;
  development?: { branch: string; commit: string; tree: string; logPath: string | null } | null;
}

interface Window { circuit: CircuitApi; }

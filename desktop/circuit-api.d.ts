interface ProjectSummary {
  name: string;
  projectId: string;
  revision: string;
  root: string;
  nativeStatus: string;
  components: Array<{ ref: string; value: string; kind?: string }>;
  libraries: Array<{ name: string; path: string; count: number }>;
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
  getEnvironment(): Promise<{ kicad: string | null; esphome: string | null; version: string }>;
  newProject(): Promise<ProjectSummary | null>;
  openProject(): Promise<ProjectSummary | null>;
  inspectProject(): Promise<ProjectSummary | null>;
  openNative(kind: "schematic" | "pcb"): Promise<OperationResult>;
  checkCircuit(): Promise<OperationResult>;
  prepareManufacturing(): Promise<OperationResult>;
  previewEsphome(): Promise<OperationResult & { yaml?: string }>;
  saveEsphome(yaml: string, replaceApproved?: boolean, destination?: string): Promise<OperationResult & { existingText?: string; destination?: string; backupPath?: string }>;
  setTheme(theme: "dark" | "light"): Promise<void>;
  onProjectChanged(callback: (project: ProjectSummary | null) => void): void;
}

interface Window { circuit: CircuitApi; }

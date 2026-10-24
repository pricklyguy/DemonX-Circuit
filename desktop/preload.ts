export interface ProjectSummary {
  name: string;
  projectId: string;
  revision: string;
  root: string;
  nativeStatus: string;
  components: Array<{ ref: string; value: string; kind?: string }>;
  libraries: Array<{ name: string; path: string; count: number }>;
  files: { schematic?: string; pcb?: string };
}

export interface OperationResult {
  status: "PASS" | "FAIL" | "NOT TESTED" | "CANCELLED";
  title: string;
  message: string;
  output?: string;
  reportPaths?: string[];
}

export interface CircuitApi {
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

declare global { interface Window { circuit: CircuitApi } }

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("circuit", {
  getEnvironment: () => ipcRenderer.invoke("env:get"),
  newProject: () => ipcRenderer.invoke("project:new"),
  openProject: () => ipcRenderer.invoke("project:open"),
  inspectProject: () => ipcRenderer.invoke("project:inspect"),
  openNative: (kind: "schematic" | "pcb") => ipcRenderer.invoke("native:open", kind),
  checkCircuit: () => ipcRenderer.invoke("circuit:check"),
  prepareManufacturing: () => ipcRenderer.invoke("manufacturing:prepare"),
  previewEsphome: () => ipcRenderer.invoke("esphome:preview"),
  saveEsphome: (yaml: string, replaceApproved = false, destination?: string) => ipcRenderer.invoke("esphome:save", yaml, replaceApproved, destination),
  setTheme: (theme: "dark" | "light") => ipcRenderer.invoke("theme:set", theme),
  onProjectChanged: (callback: (project: ProjectSummary | null) => void) => ipcRenderer.on("project:changed", (_event: unknown, project: ProjectSummary | null) => callback(project))
} satisfies CircuitApi);

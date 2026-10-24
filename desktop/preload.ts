const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("circuit", {
  getEnvironment: () => ipcRenderer.invoke("env:get"),
  getNativeTools: () => ipcRenderer.invoke("native-tools:get"),
  selectKiCadInstall: () => ipcRenderer.invoke("native-tools:select-kicad"),
  selectEsphomeExecutable: () => ipcRenderer.invoke("native-tools:select-esphome"),
  newProject: () => ipcRenderer.invoke("project:new"),
  openProject: () => ipcRenderer.invoke("project:open"),
  getRecentProjects: () => ipcRenderer.invoke("project:recent"),
  openRecentProject: (projectId: string) => ipcRenderer.invoke("project:open-recent", projectId),
  inspectProject: () => ipcRenderer.invoke("project:inspect"),
  openNative: (kind: "schematic" | "pcb") => ipcRenderer.invoke("native:open", kind),
  checkCircuit: () => ipcRenderer.invoke("circuit:check"),
  prepareManufacturing: () => ipcRenderer.invoke("manufacturing:prepare"),
  previewEsphome: () => ipcRenderer.invoke("esphome:preview"),
  saveEsphome: (yaml: string, replaceApproved = false, destination?: string) => ipcRenderer.invoke("esphome:save", yaml, replaceApproved, destination),
  setTheme: (theme: "dark" | "light") => ipcRenderer.invoke("theme:set", theme),
  getTheme: () => ipcRenderer.invoke("theme:get"),
  onProjectChanged: (callback: (project: ProjectSummary | null) => void) => ipcRenderer.on("project:changed", (_event: unknown, project: ProjectSummary | null) => callback(project))
} satisfies CircuitApi);

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

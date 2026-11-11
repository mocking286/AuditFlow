// Keep optional reference-model globals available when a model script is unavailable.
window.AuditFlowProcessModel = window.AuditFlowProcessModel || {};
window.AuditFlowReference = window.AuditFlowReference || {
  graphs: {},
  gp: {},
  canvas: () => "",
  info: () => "",
  review: () => {},
  workbench: () => ""
};

/* JEAuditFlow 6.1 SQE / PPAP reference model.
 * This is a reusable checklist definition only. It never creates an assessor
 * conclusion from a filename or from a blank template.
 */
(function (root) {
  "use strict";

  const LEVELS = Object.freeze(["1", "2", "3", "4", "5"]);
  const ITEMS = Object.freeze([
    ["1", "设计记录", "Design Records", "AIAG PPAP §2.2.1", ["2", "3", "5"], "图纸、CAD/数模、材料报告、聚合物标示与当前零件一致，版本受控。"],
    ["2", "工程变更文件", "Engineering Change Documents", "AIAG PPAP §2.2.2", ["2", "3", "5"], "未合并到设计记录但已实施的工程变更须经授权、批准且与当前实物一致。"],
    ["3", "顾客工程批准", "Customer Engineering Approval", "AIAG PPAP §2.2.3", ["3", "5"], "设计记录要求时，保留有效期内的顾客书面工程批准或临时偏差许可。"],
    ["4", "设计失效模式及后果分析（DFMEA）", "Design FMEA", "AIAG PPAP §2.2.4", ["3", "5"], "设计责任方提供 DFMEA，覆盖特殊/关键特性并对高风险项保留改善措施。"],
    ["5", "过程流程图", "Process Flow Diagram", "AIAG PPAP §2.2.5", ["3", "5"], "从原材料到出货的流程完整，含检验/返工点并与 PFMEA、控制计划一致。"],
    ["6", "过程失效模式及后果分析（PFMEA）", "Process FMEA", "AIAG PPAP §2.2.6", ["3", "5"], "逐工序识别失效模式、特殊特性和高风险改善措施，并与流程图/控制计划对应。"],
    ["7", "控制计划", "Control Plan", "AIAG PPAP §2.2.7", ["3", "5"], "逐工序列出控制项、特殊特性、测量方法、频次、样本量和反应计划。"],
    ["8", "测量系统分析（MSA）", "Measurement System Analysis", "AIAG PPAP §2.2.8", ["3", "5"], "控制计划涉及的新/改进量具具备 MSA 结果，结论满足适用接受准则。"],
    ["9", "全尺寸测量结果", "Dimensional Results", "AIAG PPAP §2.2.9", ["2", "3", "5"], "按设计记录和控制计划记录全部尺寸、特性、实测值、结果、版本和样件信息。"],
    ["10", "材料/性能试验结果记录", "Material / Performance Test Results", "AIAG PPAP §2.2.10", ["2", "3", "5"], "材料和性能试验保留规范版本、日期、数量、实测结果、供方和批准来源。"],
    ["11", "初始过程研究（SPC）", "Initial Process Studies", "AIAG PPAP §2.2.11", ["3", "5"], "特殊特性有能力/性能研究、稳定性判断、指数和不满足时的纠正措施。"],
    ["12", "合格实验室文件", "Qualified Laboratory Documentation", "AIAG PPAP §2.2.12", ["3", "5"], "内部/外部实验室具备适用资质，报告含试验名称、日期、标准和正式抬头。"],
    ["13", "外观批准报告（AAR）", "Appearance Approval Report", "AIAG PPAP §2.2.13", ["1", "2", "3", "5"], "有颜色、纹理或外观要求时，AAR 完整、签署有效并与提交样品一致。"],
    ["14", "生产件样品", "Sample Production Parts", "AIAG PPAP §2.2.14", ["3", "5"], "样品来自代表量产的工装、过程和操作者，数量、标识和可追溯性符合要求。"],
    ["15", "标准样件", "Master Sample", "AIAG PPAP §2.2.15", ["4", "5"], "保留经批准的标准样件、识别信息、保存位置和变更控制记录。"],
    ["16", "检查辅具", "Checking Aids", "AIAG PPAP §2.2.16", ["4", "5"], "量具/检具/工装辅具受控、校准、维护并与检验结果和控制计划对应。"],
    ["17", "顾客特定要求符合性记录", "Customer-Specific Requirements", "AIAG PPAP §2.2.17", ["3", "5"], "识别适用 CSR 并逐条提供符合性、偏差批准和交付记录。"],
    ["18", "零件提交保证书（PSW）", "Part Submission Warrant", "AIAG PPAP §2.2.18", ["1", "2", "3", "4", "5"], "PSW 汇总零件、提交原因、等级、重量、模具/型腔、过程和授权签署，且与支撑数据一致。"]
  ].map(([number, name, nameEn, clause, levels, checkpoint]) => Object.freeze({
    id: `PPAP-${number.padStart(2, "0")}`,
    number,
    code: `SQE.${number.padStart(2, "0")}`,
    name,
    nameEn,
    clause,
    applicableLevels: Object.freeze(levels),
    category: "PPAP Submission",
    checkpoint,
    expectedEvidence: Object.freeze([
      `${name} 受控版本或记录`,
      "项目/供应商样本定位（页码、表格行或工单）",
      "评审/批准状态和责任人",
      "不符合项、措施与验证记录（如适用）"
    ])
  })));

  function normalizeLevel(level) {
    const value = String(level || "3").replace(/^Level\s*/i, "").trim();
    return LEVELS.includes(value) ? value : "3";
  }

  function applicableItems(level) {
    const normalized = normalizeLevel(level);
    return ITEMS.filter(item => item.applicableLevels.includes(normalized));
  }

  function summary(level) {
    const normalized = normalizeLevel(level);
    return {
      level: normalized,
      label: `Level ${normalized}`,
      total: ITEMS.length,
      required: applicableItems(normalized).length,
      excluded: ITEMS.length - applicableItems(normalized).length
    };
  }

  root.AuditFlowSqePpap = Object.freeze({
    version: "1.0",
    standard: "AIAG PPAP 4th Edition / customer-specific requirements",
    levels: LEVELS,
    items: ITEMS,
    normalizeLevel,
    applicableItems,
    summary
  });
})(window);
